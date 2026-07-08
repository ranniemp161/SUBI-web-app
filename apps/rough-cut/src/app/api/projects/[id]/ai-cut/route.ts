import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { db } from "@repo/db";
import { projects } from "@repo/db/schema";
import { eq } from "drizzle-orm";
import { getOwnedProject } from "@/lib/projects";
import { rateLimit } from "@/lib/rate-limit";
import { runAiRoughCut, isAiRoughCutConfigured } from "@/lib/ai-rough-cut";
import { chargeAiCut, costSecondsForDurationMs, refundAiCut } from "@/lib/credits";
import { reportError } from "@/lib/observability";
import type { Transcript } from "@/lib/edl";

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

    // Each run is a real Gemini call the account pays for, and this opt-in
    // route is the only place the pass ever runs — so every run is charged.
    const costSeconds = costSecondsForDurationMs(project.durationMs);
    const charge = await chargeAiCut(project.userId, id, costSeconds, idempotencyKey);
    if (charge.status === "insufficient") {
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

    // Configured + non-empty words were checked above, so null here means the
    // transcript tripped the size guard — no usable result was delivered.
    if (!aiCuts) {
      await refundAiCutQuietly(project.userId, id, costSeconds, idempotencyKey);
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
    reportError("Error running AI rough cut", error);
    return NextResponse.json(
      { error: "The AI pass failed — try again." },
      { status: 502 }
    );
  }
}
