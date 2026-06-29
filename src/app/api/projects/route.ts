import { auth, currentUser } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { projects, users } from "@/db/schema";
import { eq, desc } from "drizzle-orm";
import { hasValidAccessCode } from "@/lib/access-code";

/**
 * POST /api/projects — Create a new project.
 *
 * Creates the user record (upsert) if it doesn't exist yet,
 * then creates the project with the provided file metadata.
 */
export async function POST(request: Request) {
  const { userId: clerkId } = await auth();

  if (!clerkId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    // Re-check the access code here too, not just in the user.created
    // webhook. signUp.create() grants a session immediately, before the
    // webhook has had a chance to run and delete an invalid account —
    // without this check, a fast enough request in that window could
    // create real rows before the webhook catches up.
    const clerkUser = await currentUser();

    if (!hasValidAccessCode(clerkUser?.unsafeMetadata)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    const body = await request.json();
    const { fileName, durationMs } = body;

    if (!fileName) {
      return NextResponse.json(
        { error: "fileName is required." },
        { status: 400 }
      );
    }

    // Upsert user — create if first project, otherwise get existing
    const existingUsers = await db
      .select()
      .from(users)
      .where(eq(users.clerkId, clerkId))
      .limit(1);

    let dbUserId: string;

    if (existingUsers.length === 0) {
      // Fallback for the rare race where a project is created before
      // the user.created webhook has landed — fetch the real email
      // directly instead of leaving it blank.
      const email = clerkUser?.emailAddresses[0]?.emailAddress ?? "";

      const [newUser] = await db
        .insert(users)
        .values({ clerkId, email })
        .returning();
      dbUserId = newUser.id;
    } else {
      dbUserId = existingUsers[0].id;
    }

    // Create the project
    const [project] = await db
      .insert(projects)
      .values({
        userId: dbUserId,
        fileName,
        durationMs: durationMs || null,
      })
      .returning();

    return NextResponse.json(project, { status: 201 });
  } catch (error) {
    console.error("Error creating project:", error);
    return NextResponse.json(
      { error: "Failed to create project." },
      { status: 500 }
    );
  }
}

/**
 * GET /api/projects — List all projects for the authenticated user.
 *
 * Returns projects ordered by creation date (newest first).
 */
export async function GET() {
  const { userId: clerkId } = await auth();

  if (!clerkId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const userRows = await db
      .select()
      .from(users)
      .where(eq(users.clerkId, clerkId))
      .limit(1);

    if (userRows.length === 0) {
      // User hasn't created any projects yet
      return NextResponse.json([]);
    }

    const userProjects = await db
      .select()
      .from(projects)
      .where(eq(projects.userId, userRows[0].id))
      .orderBy(desc(projects.createdAt));

    return NextResponse.json(userProjects);
  } catch (error) {
    console.error("Error listing projects:", error);
    return NextResponse.json(
      { error: "Failed to list projects." },
      { status: 500 }
    );
  }
}
