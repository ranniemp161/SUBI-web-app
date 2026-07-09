import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { db } from "@repo/db";
import { projects } from "@repo/db/schema";
import { eq } from "drizzle-orm";
import { getOwnedProject, claimAiCutSlot, releaseAiCutClaim } from "@/lib/projects";
import { rateLimit } from "@/lib/rate-limit";
import { runAiRoughCut, isAiRoughCutConfigured } from "@/lib/ai-rough-cut";
import { chargeAiCut, costSecondsForDurationMs, refundAiCut } from "@/lib/credits";
import { reportError } from "@/lib/observability";
import type { Transcript } from "@/lib/edl";
import type { AiCuts } from "@/lib/ai-cuts";

// Gemini legitimately takes minutes on a long transcript with thinking enabled
// (capped at 240s in ai-rough-cut.ts) — don't let the platform cut it off first.
export const maxDuration = 300;

// Each run is a real Gemini call the account pays for; 10/hour is plenty for
// "re-run it on a project or three", not enough to matter if a client loops.
const AI_CUT_LIMIT = 10;
const AI_CUT_WINDOW_SECONDS = 3600;

/** Best-effort refund — a credits hiccup must never mask the real Gemini error. */
async function refundAiCutQuietly(
  userId: string,
  projectId: string,
  costSeconds: number,
  idempotencyKey?: string
) {
  try {
    await refundAiCut(userId, projectId, costSeconds, idempotencyKey);
  } catch (error) {
    reportError("Failed to refund AI cut charge", error, { projectId });
  }
}

/**
 * POST /api/projects/:id/ai-cut — run (or re-run) the AI mistake-detection
 * pass over the project's transcript, store the result, and return it.
 *
 * This is the only path that runs the AI pass: it's strictly opt-in behind
 * the studio's "AI Cut" button (no automatic pass at transcription time).
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { userId: clerkId } = await auth();

  if (!clerkId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const limit = await rateLimit(`ai-cut:${clerkId}`, AI_CUT_LIMIT, AI_CUT_WINDOW_SECONDS);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Too many AI cut runs — try again in a bit." },
      { status: 429 }
    );
  }

  const idempotencyKey = _request.headers.get("Idempotency-Key") ?? undefined;
  if (idempotencyKey) {
    // Treat the rate limit bucket as a distributed lock/idempotency guard (24
    // hours). This is the only guard against a retried request re-charging a
    // paid Gemini call, so a Redis error here must fail closed (refuse) —
    // failing open would silently disable the sole double-charge protection.
    const idempotency = await rateLimit(`idempotency:${idempotencyKey}`, 1, 86400, {
      failClosed: true,
    });
    if (!idempotency.allowed) {
      return NextResponse.json(
        { error: "This AI pass was already requested." },
        { status: 409 }
      );
    }
  }

  try {
    const { id } = await params;
    const project = await getOwnedProject(id, clerkId);

    if (!project) {
      return NextResponse.json({ error: "Project not found." }, { status: 404 });
    }

    if (!isAiRoughCutConfigured()) {
      return NextResponse.json(
        { error: "AI rough cut isn't configured on this server." },
        { status: 503 }
      );
    }

    const transcript = project.transcript as Transcript | null;
    if (project.transcriptStatus !== "ready" || !transcript?.words?.length) {
      return NextResponse.json(
        { error: "The transcript isn't ready yet." },
        { status: 409 }
      );
    }

    // The pass is deterministic over the same transcript, so a second run can
    // never produce a different result — refuse before any charge is taken.
    // The UI hiding the button is not a guard (a direct call or client retry
    // bypasses it). This snapshot check just gives the common case a fast,
    // friendly error — the real safety boundary is the atomic claim below,
    // which closes the concurrent-request window a plain read like this
    // can't (two requests reading the same empty aiCuts a moment apart would
    // otherwise both pass this check and both charge).
    if (((project.aiCuts as AiCuts | null)?.ranges?.length ?? 0) > 0) {
      return NextResponse.json(
        {
          error: "AI Cut has already run for this project. Clear it first to run again.",
          code: "AI_CUT_ALREADY_RUN",
        },
        { status: 409 }
      );
    }

    // Atomically claim the run: only one concurrent POST can flip aiCuts from
    // "empty" to "pending". A losing concurrent request matches zero rows and
    // is rejected here, before either one charges — see claimAiCutSlot.
    const claimed = await claimAiCutSlot(id, project.userId);
    if (!claimed) {
      const current = await getOwnedProject(id, clerkId);
      const currentRanges = (current?.aiCuts as AiCuts | null)?.ranges?.length ?? 0;
      if (currentRanges > 0) {
        return NextResponse.json(
          {
            error: "AI Cut has already run for this project. Clear it first to run again.",
            code: "AI_CUT_ALREADY_RUN",
          },
          { status: 409 }
        );
      }
      return NextResponse.json(
        {
          error: "An AI pass is already running for this project — try again shortly.",
          code: "AI_CUT_IN_PROGRESS",
        },
        { status: 409 }
      );
    }

    try {
      // Each run is a real Gemini call the account pays for, and this opt-in
      // route is the only place the pass ever runs — so every run is charged.
      const costSeconds = costSecondsForDurationMs(project.durationMs);
      const charge = await chargeAiCut(project.userId, id, costSeconds, idempotencyKey);
      if (charge.status === "insufficient") {
        await releaseAiCutClaim(id);
        return NextResponse.json(
          {
            error: "Not enough credits to run the AI pass.",
            code: "INSUFFICIENT_CREDITS",
            requiredSeconds: costSeconds,
          },
          { status: 402 }
        );
      }

      let aiCuts;
      try {
        aiCuts = await runAiRoughCut(transcript.words);
      } catch (error) {
        await refundAiCutQuietly(project.userId, id, costSeconds, idempotencyKey);
        throw error;
      }

      // Configured + non-empty words were checked above, so null here means
      // the transcript tripped the size guard — no usable result was delivered.
      if (!aiCuts) {
        await refundAiCutQuietly(project.userId, id, costSeconds, idempotencyKey);
        await releaseAiCutClaim(id);
        return NextResponse.json(
          { error: "This transcript is too long for the AI pass." },
          { status: 422 }
        );
      }

      await db
        .update(projects)
        .set({ aiCuts, updatedAt: new Date() })
        .where(eq(projects.id, id));

      return NextResponse.json(aiCuts);
    } catch (error) {
      // Any failure after a successful claim must release it — otherwise the
      // project is stuck permanently "pending" and can never be re-run.
      await releaseAiCutClaim(id);
      throw error;
    }
  } catch (error) {
    reportError("Error running AI rough cut", error);
    return NextResponse.json(
      { error: "The AI pass failed — try again." },
      { status: 502 }
    );
  }
}

/**
 * DELETE /api/projects/:id/ai-cut — clear the stored AI cut results, which
 * re-enables a fresh (paid) POST. No refund: clearing resets derived data,
 * it isn't a billing event — the credits model only refunds failed runs.
 */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { userId: clerkId } = await auth();

  if (!clerkId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { id } = await params;
    const project = await getOwnedProject(id, clerkId);

    if (!project) {
      return NextResponse.json({ error: "Project not found." }, { status: 404 });
    }

    await db
      .update(projects)
      .set({ aiCuts: null, updatedAt: new Date() })
      .where(eq(projects.id, id));

    return NextResponse.json({ ok: true });
  } catch (error) {
    reportError("Error clearing AI cuts", error);
    return NextResponse.json(
      { error: "Couldn't clear the AI cuts — try again." },
      { status: 500 }
    );
  }
}
