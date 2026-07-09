import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { getOwnedProject, getAiCutRun, deleteAiCutRunAndRenumber, renameAiCutRun } from "@/lib/projects";
import { rateLimit } from "@/lib/rate-limit";
import { reportError } from "@/lib/observability";

// Same bucket/window as POST — DELETE carries no charge, but an unbounded loop
// is still unwanted request volume against the database (ADR 0002-ai-cut-paid-rerun).
const AI_CUT_LIMIT = 10;
const AI_CUT_WINDOW_SECONDS = 3600;

/**
 * DELETE /api/projects/:id/ai-cut/runs/:runId — delete a non-active stored AI
 * Cut run (AC-4). No charge, no refund: deleting resets derived data, it
 * isn't a billing event. Renumbers the project's remaining runs so run
 * numbers stay contiguous.
 */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string; runId: string }> }
) {
  const { userId: clerkId } = await auth();

  if (!clerkId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const limit = await rateLimit(`ai-cut:${clerkId}`, AI_CUT_LIMIT, AI_CUT_WINDOW_SECONDS);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Too many AI cut requests — try again in a bit." },
      { status: 429 }
    );
  }

  try {
    const { id, runId } = await params;
    const project = await getOwnedProject(id, clerkId);

    if (!project) {
      return NextResponse.json({ error: "Project not found." }, { status: 404 });
    }

    const run = await getAiCutRun(runId, id);
    if (!run) {
      return NextResponse.json(
        { error: "That AI Cut run wasn't found.", code: "AI_CUT_RUN_NOT_FOUND" },
        { status: 404 }
      );
    }

    if (project.activeAiCutRunId === runId) {
      return NextResponse.json(
        {
          error: "Switch to a different run before deleting this one.",
          code: "AI_CUT_RUN_IS_ACTIVE",
        },
        { status: 409 }
      );
    }

    await deleteAiCutRunAndRenumber(id, runId);

    return NextResponse.json({ ok: true });
  } catch (error) {
    reportError("Error deleting AI cut run", error);
    return NextResponse.json(
      { error: "Couldn't delete that run — try again." },
      { status: 500 }
    );
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; runId: string }> }
) {
  const { userId: clerkId } = await auth();

  if (!clerkId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const limit = await rateLimit(`ai-cut:${clerkId}`, AI_CUT_LIMIT, AI_CUT_WINDOW_SECONDS);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Too many AI cut requests — try again in a bit." },
      { status: 429 }
    );
  }

  try {
    const { id, runId } = await params;
    const body = await request.json();
    const name = typeof body.name === "string" ? body.name.slice(0, 100) : null;

    const project = await getOwnedProject(id, clerkId);
    if (!project) {
      return NextResponse.json({ error: "Project not found." }, { status: 404 });
    }

    const run = await renameAiCutRun(id, runId, name);
    if (!run) {
      return NextResponse.json(
        { error: "That AI Cut run wasn't found.", code: "AI_CUT_RUN_NOT_FOUND" },
        { status: 404 }
      );
    }

    return NextResponse.json(run);
  } catch (error) {
    reportError("Error renaming AI cut run", error);
    return NextResponse.json(
      { error: "Couldn't rename that run — try again." },
      { status: 500 }
    );
  }
}
