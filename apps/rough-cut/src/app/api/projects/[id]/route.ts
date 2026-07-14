import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { db } from "@repo/db";
import { projects } from "@repo/db/schema";
import { eq } from "drizzle-orm";
import { getOwnedProject, listAiCutRuns } from "@/lib/projects";
import { settleHold } from "@/lib/credits";
import { patchProjectSchema } from "@/lib/validation";
import { readRateLimit } from "@/lib/rate-limit";
import { reportError } from "@/lib/observability";
import * as jsonpatch from "fast-json-patch";

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
    const { edl, edlPatch, transcript, durationMs, fileName, fileSize, fileType } = parsed.data;
    const updateData: Record<string, unknown> = {
      updatedAt: new Date(),
    };

    if (edlPatch !== undefined && project.edl) {
      try {
        // We clone project.edl just in case, though applyPatch handles mutations safely
        // when mutateDocument is false (which is the default).
        // The zod schema validates each operation's shape loosely; the
        // validate=true argument makes applyPatch enforce full JSON Patch
        // semantics (required value/from per op) at runtime, so this
        // narrowing cast is safe.
        const newEdl = jsonpatch.applyPatch(
          project.edl,
          edlPatch as jsonpatch.Operation[],
          true,
          false
        ).newDocument;
        updateData.edl = newEdl;
      } catch (patchErr) {
        return NextResponse.json(
          { error: "Invalid EDL patch." },
          { status: 400 }
        );
      }
    } else if (edl !== undefined) {
      updateData.edl = edl;
    }
    if (transcript !== undefined) updateData.transcript = transcript;
    if (durationMs !== undefined) updateData.durationMs = durationMs;
    if (fileName !== undefined) updateData.fileName = fileName;
    if (fileSize !== undefined) updateData.fileSize = fileSize;
    if (fileType !== undefined) updateData.fileType = fileType;

    const [updated] = await db
      .update(projects)
      .set(updateData)
      .where(eq(projects.id, id))
      .returning();

    return NextResponse.json(updated);
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
