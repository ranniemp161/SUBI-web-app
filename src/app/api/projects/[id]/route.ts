import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { projects } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getOwnedProject } from "@/lib/projects";
import { patchProjectSchema } from "@/lib/validation";
import { reportError } from "@/lib/observability";

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

  try {
    const { id } = await params;
    const project = await getOwnedProject(id, clerkId);

    if (!project) {
      return NextResponse.json(
        { error: "Project not found." },
        { status: 404 }
      );
    }

    return NextResponse.json(project);
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
    const { edl, transcript, durationMs, fileName } = parsed.data;
    const updateData: Record<string, unknown> = {
      updatedAt: new Date(),
    };

    if (edl !== undefined) updateData.edl = edl;
    if (transcript !== undefined) updateData.transcript = transcript;
    if (durationMs !== undefined) updateData.durationMs = durationMs;
    if (fileName !== undefined) updateData.fileName = fileName;

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
