import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import {
  getOwnedProject,
  claimAiCutSlot,
  releaseAiCutClaim,
  countAiCutRuns,
  createAiCutRun,
  AI_CUT_RUN_LIMIT,
} from "@/lib/projects";
import { aiCutRateLimit, rateLimit } from "@/lib/rate-limit";
import { runAiRoughCut, isAiRoughCutConfigured } from "@/lib/ai-rough-cut";
import { chargeAiCut, costSecondsForDurationMs, refundAiCut } from "@/lib/credits";
import { reportError } from "@/lib/observability";
import type { Transcript } from "@/lib/edl";

// Gemini legitimately takes minutes on a long transcript with thinking enabled
// (capped at 240s in ai-rough-cut.ts) — don't let the platform cut it off first.
export const maxDuration = 300;

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
 * POST /api/projects/:id/ai-cut — run a fresh AI mistake-detection pass over
 * the project's transcript, store it as a new versioned run, make it the
 * active run, and return it (ADR 0002-ai-cut-paid-rerun).
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

  const limit = await aiCutRateLimit(clerkId);
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

    // Cheap, no-side-effect cap check first (AC-2): a request that's going to
    // be rejected for being at the cap should never take the claim below.
    const runCount = await countAiCutRuns(id);
    if (runCount >= AI_CUT_RUN_LIMIT) {
      return NextResponse.json(
        {
          error: `You already have ${AI_CUT_RUN_LIMIT} saved AI Cut runs. Delete one to run again.`,
          code: "AI_CUT_RUN_LIMIT_REACHED",
        },
        { status: 409 }
      );
    }

    // Atomically claim the run: only one concurrent POST can flip the claim
    // from idle to held. A losing concurrent request matches zero rows and is
    // rejected here, before either one charges — see claimAiCutSlot.
    const claimed = await claimAiCutSlot(id, project.userId);
    if (!claimed) {
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

      const run = await createAiCutRun(id, aiCuts.ranges, aiCuts.model);

      return NextResponse.json(run);
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
