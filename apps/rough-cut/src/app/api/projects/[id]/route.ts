import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { db } from "@repo/db";
import { projects } from "@repo/db/schema";
import { and, eq, sql } from "drizzle-orm";
import { getOwnedProject, listAiCutRuns } from "@/lib/projects";
import { settleHold } from "@/lib/credits";
import { patchProjectSchema } from "@/lib/validation";
import { readRateLimit } from "@/lib/rate-limit";
import { reportError } from "@/lib/observability";
import { applyPatch } from "rfc6902";

/**
 * GET /api/projects/:id — Get a single project with full details.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { userId: clerkId } = await auth();

  if (!clerkId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const limit = await readRateLimit(clerkId);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Too many requests. Please wait a bit and try again." },
      { status: 429 }
    );
  }

  try {
    const { id } = await params;
    const project = await getOwnedProject(id, clerkId);

    if (!project) {
      return NextResponse.json(
        { error: "Project not found." },
        { status: 404 }
      );
    }

    const aiCutRuns = await listAiCutRuns(id);

    // Explicit no-store: per-user project detail (transcript, EDL) must
    // never be served stale or shared across users by an intermediary.
    return NextResponse.json(
      { ...project, aiCutRuns },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    reportError("Error fetching project", error);
    return NextResponse.json(
      { error: "Failed to fetch project." },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/projects/:id — Update project fields (EDL, transcript, etc.).
 *
 * Used for auto-save from the editor. Only updates fields that are
 * provided in the request body.
 */
export async function PATCH(
  request: Request,
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
      return NextResponse.json(
        { error: "Project not found." },
        { status: 404 }
      );
    }

    const parsed = patchProjectSchema.safeParse(
      await request.json().catch(() => null)
    );

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request body." },
        { status: 400 }
      );
    }

    // Only apply the fields that were actually provided.
    const {
      edl,
      edlPatch,
      baseUpdatedAt,
      transcript,
      wordsAligned,
      durationMs,
      fileName,
      fileSize,
      fileType,
    } = parsed.data;
    const updateData: Record<string, unknown> = {
      updatedAt: new Date(),
    };

    if (edlPatch !== undefined && project.edl) {
      try {
        const newEdl = JSON.parse(JSON.stringify(project.edl));
        const errors = applyPatch(newEdl, edlPatch);
        if (errors.some(e => e !== null)) {
          return NextResponse.json(
            { error: "Invalid EDL patch." },
            { status: 400 }
          );
        }
        updateData.edl = newEdl;
      } catch {
        return NextResponse.json(
          { error: "Invalid EDL patch." },
          { status: 400 }
        );
      }
    } else if (edl !== undefined) {
      updateData.edl = edl;
    }
    if (transcript !== undefined) updateData.transcript = transcript;
    if (wordsAligned !== undefined) updateData.wordsAligned = wordsAligned;
    if (durationMs !== undefined) updateData.durationMs = durationMs;
    if (fileName !== undefined) updateData.fileName = fileName;
    if (fileSize !== undefined) updateData.fileSize = fileSize;
    if (fileType !== undefined) updateData.fileType = fileType;

    // Optimistic concurrency. `edlPatch` is only meaningful against the exact
    // EDL it was diffed from: applied to a row some other writer has already
    // moved on (a second tab, a retry racing the request it duplicates, an AI
    // Cut run), rfc6902 happily produces a structurally valid but semantically
    // wrong EDL — silent corruption of the user's cut. Gate the write on the
    // caller's base version so a diverged patch is rejected instead, and hand
    // back the current state so the client can re-diff against it.
    //
    // Truncated to milliseconds because that's the precision that survives the
    // JSON round-trip (`Date#toISOString`); the stored value can carry
    // microseconds from Postgres' `now()` default.
    const versioned = baseUpdatedAt !== undefined;
    const [updated] = await db
      .update(projects)
      .set(updateData)
      .where(
        versioned
          ? and(
              eq(projects.id, id),
              sql`date_trunc('milliseconds', ${projects.updatedAt}) = ${baseUpdatedAt}::timestamptz`
            )
          : eq(projects.id, id)
      )
      .returning();

    if (!updated) {
      // Zero rows matched: the row exists (ownership was checked above), so
      // the version guard is what rejected this.
      const current = await getOwnedProject(id, clerkId);
      return NextResponse.json(
        {
          error: "Project changed since your last save.",
          edl: current?.edl ?? null,
          updatedAt: current?.updatedAt ?? null,
        },
        { status: 409 }
      );
    }

    return NextResponse.json({ success: true, updatedAt: updated.updatedAt });
  } catch (error) {
    reportError("Error updating project", error);
    return NextResponse.json(
      { error: "Failed to update project." },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/projects/:id — Delete a project.
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
      return NextResponse.json(
        { error: "Project not found." },
        { status: 404 }
      );
    }

    // Refund any in-flight credit hold before the row (and with it the only
    // record of the hold) disappears. Best-effort: a refund hiccup shouldn't
    // block the deletion the user asked for.
    try {
      await settleHold(id, 0);
    } catch (error) {
      reportError("Failed to refund credit hold on project delete", error, {
        projectId: id,
      });
    }

    await db.delete(projects).where(eq(projects.id, id));

    return NextResponse.json({ success: true });
  } catch (error) {
    reportError("Error deleting project", error);
    return NextResponse.json(
      { error: "Failed to delete project." },
      { status: 500 }
    );
  }
}
