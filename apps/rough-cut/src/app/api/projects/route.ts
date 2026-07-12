import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { db, withDbRetry } from "@repo/db";
import { projects, users } from "@repo/db/schema";
import { eq, desc } from "drizzle-orm";
import { getAuthorizedDbUser } from "@/lib/authz";
import { createProjectSchema } from "@/lib/validation";
import { rateLimit, readRateLimit } from "@/lib/rate-limit";
import { reportError } from "@/lib/observability";

// Guards against a runaway client spraying project rows.
const CREATE_LIMIT = 60;
const CREATE_WINDOW_SECONDS = 3600;

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
    // The users row is the authorization (it only exists once an access code
    // was validated). getAuthorizedDbUser also covers the window where
    // signUp.create() granted a session before the user.created webhook ran,
    // by provisioning lazily from the code in Clerk metadata.
    const user = await getAuthorizedDbUser(clerkId);

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    const limit = await rateLimit(`create:${clerkId}`, CREATE_LIMIT, CREATE_WINDOW_SECONDS);
    if (!limit.allowed) {
      return NextResponse.json(
        { error: "You're creating projects too quickly. Please wait a bit and try again." },
        { status: 429 }
      );
    }

    const parsed = createProjectSchema.safeParse(
      await request.json().catch(() => null)
    );

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request body." },
        { status: 400 }
      );
    }

    const { fileName, durationMs, fileSize, fileType, aiPolish } = parsed.data;

    const [project] = await db
      .insert(projects)
      .values({
        userId: user.id,
        fileName,
        durationMs: durationMs ?? null,
        fileSize: fileSize ?? null,
        fileType: fileType ?? null,
        aiPolishRequested: aiPolish,
      })
      .returning();

    return NextResponse.json(project, { status: 201 });
  } catch (error) {
    reportError("Error creating project", error);
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

  const limit = await readRateLimit(clerkId);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Too many requests. Please wait a bit and try again." },
      { status: 429 }
    );
  }

  try {
    const userRows = await withDbRetry(() =>
      db
        .select()
        .from(users)
        .where(eq(users.clerkId, clerkId))
        .limit(1)
    );

    if (userRows.length === 0) {
      // User hasn't created any projects yet
      return NextResponse.json([]);
    }

    // List view only needs metadata — omit the transcript + EDL jsonb, which
    // can be large and aren't rendered on the dashboard grid.
    const userProjects = await withDbRetry(() =>
      db
        .select({
          id: projects.id,
          fileName: projects.fileName,
          durationMs: projects.durationMs,
          transcriptStatus: projects.transcriptStatus,
          createdAt: projects.createdAt,
          updatedAt: projects.updatedAt,
        })
        .from(projects)
        .where(eq(projects.userId, userRows[0].id))
        .orderBy(desc(projects.createdAt))
    );

    // Explicit no-store: per-user project list must never be served stale or
    // shared across users by an intermediary.
    return NextResponse.json(userProjects, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    reportError("Error listing projects", error);
    return NextResponse.json(
      { error: "Failed to list projects." },
      { status: 500 }
    );
  }
}
