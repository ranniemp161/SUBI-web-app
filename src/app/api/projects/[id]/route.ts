import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { projects, users } from "@/db/schema";
import { eq, and } from "drizzle-orm";

/**
 * Helper to get a project and verify ownership.
 * Returns the project if the authenticated user owns it, null otherwise.
 */
async function getOwnedProject(projectId: string, clerkId: string) {
  const result = await db
    .select({
      project: projects,
      user: users,
    })
    .from(projects)
    .innerJoin(users, eq(projects.userId, users.id))
    .where(and(eq(projects.id, projectId), eq(users.clerkId, clerkId)))
    .limit(1);

  return result.length > 0 ? result[0].project : null;
}

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
    console.error("Error fetching project:", error);
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

    const body = await request.json();

    // Only allow updating specific fields
    const updateData: Record<string, unknown> = {
      updatedAt: new Date(),
    };

    if (body.edl !== undefined) updateData.edl = body.edl;
    if (body.transcript !== undefined) updateData.transcript = body.transcript;
    if (body.durationMs !== undefined) updateData.durationMs = body.durationMs;
    if (body.fileName !== undefined) updateData.fileName = body.fileName;

    const [updated] = await db
      .update(projects)
      .set(updateData)
      .where(eq(projects.id, id))
      .returning();

    return NextResponse.json(updated);
  } catch (error) {
    console.error("Error updating project:", error);
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
    console.error("Error deleting project:", error);
    return NextResponse.json(
      { error: "Failed to delete project." },
      { status: 500 }
    );
  }
}
