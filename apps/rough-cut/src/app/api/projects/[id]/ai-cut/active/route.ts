import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { getOwnedProject, setActiveAiCutRun } from "@/lib/projects";
import { aiCutRateLimit } from "@/lib/rate-limit";
import { reportError } from "@/lib/observability";

/**
 * PATCH /api/projects/:id/ai-cut/active — switch which stored AI Cut run is
 * active (AC-3). Returns the newly active run in the same shape POST does,
 * so the client applies it through the same code path.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { userId: clerkId } = await auth();

  if (!clerkId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const limit = await aiCutRateLimit(clerkId);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Too many AI cut requests — try again in a bit." },
      { status: 429 }
    );
  }

  try {
    const { id } = await params;
    const project = await getOwnedProject(id, clerkId);

    if (!project) {
      return NextResponse.json({ error: "Project not found." }, { status: 404 });
    }

    const body = await request.json().catch(() => null);
    const runId = (body as { runId?: unknown } | null)?.runId;
    if (typeof runId !== "string" || !runId) {
      return NextResponse.json({ error: "runId is required." }, { status: 400 });
    }

    const run = await setActiveAiCutRun(id, runId);
    if (!run) {
      return NextResponse.json(
        { error: "That AI Cut run wasn't found.", code: "AI_CUT_RUN_NOT_FOUND" },
        { status: 404 }
      );
    }

    return NextResponse.json(run);
  } catch (error) {
    reportError("Error switching active AI cut run", error);
    return NextResponse.json(
      { error: "Couldn't switch runs — try again." },
      { status: 500 }
    );
  }
}
