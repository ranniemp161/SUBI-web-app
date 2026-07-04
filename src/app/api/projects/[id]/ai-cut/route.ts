import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { projects } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getOwnedProject } from "@/lib/projects";
import { rateLimit } from "@/lib/rate-limit";
import { runAiRoughCut, isAiRoughCutConfigured } from "@/lib/ai-rough-cut";
import { reportError } from "@/lib/observability";
import type { Transcript } from "@/lib/edl";

// Gemini legitimately takes minutes on a long transcript with thinking enabled
// (capped at 240s in ai-rough-cut.ts) — don't let the platform cut it off first.
export const maxDuration = 300;

// Each run is a real Gemini call the account pays for; 10/hour is plenty for
// "re-run it on a project or three", not enough to matter if a client loops.
const AI_CUT_LIMIT = 10;
const AI_CUT_WINDOW_SECONDS = 3600;

/**
 * POST /api/projects/:id/ai-cut — run (or re-run) the AI mistake-detection
 * pass over the project's transcript, store the result, and return it.
 *
 * This is the on-demand path behind the studio's "AI Cut" button: the retry
 * when the automatic post-transcription pass failed, and the way projects
 * transcribed before the feature existed get AI cuts at all.
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

    const aiCuts = await runAiRoughCut(transcript.words);
    // Configured + non-empty words were checked above, so null here means the
    // transcript tripped the size guard.
    if (!aiCuts) {
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
