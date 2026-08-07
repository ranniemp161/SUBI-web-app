import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { db } from "@repo/db";
import { projects } from "@repo/db/schema";
import { getAuthorizedDbUser } from "@repo/server-shared/authz";
import { findUserIdByClerkId, listProjectPage } from "@/lib/projects";
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

    const { fileName, durationMs, fileSize, fileType } = parsed.data;

    // AI polish is mandatory for every new project (ADR 0004 child 1) —
    // decided server-side; the client sends no `aiPolish` field.
    const [project] = await db
      .insert(projects)
      .values({
        userId: user.id,
        fileName,
        durationMs: durationMs ?? null,
        fileSize: fileSize ?? null,
        fileType: fileType ?? null,
        aiPolishRequested: true,
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
 * GET /api/projects — one page of the authenticated user's projects, newest
 * first.
 *
 * `?limit=` (default `PROJECT_PAGE_SIZE`, hard-capped at `MAX_PROJECT_PAGE_SIZE`)
 * and `?cursor=` (the `X-Next-Cursor` from the previous page). The response body
 * stays a bare array — the next cursor rides in a header so the shape is
 * unchanged for any existing caller — and its absence means this is the last
 * page.
 *
 * The dashboard does not use this route; it calls the `loadMoreProjects` server
 * action, which shares the same `listProjectPage` query. This exists for
 * machine callers, and is what the e2e smoke test asserts Clerk's gate on. It
 * used to select every row a user had ever created with no limit at all.
 */
export async function GET(request: Request) {
  const { userId: clerkId } = await auth();

  if (!clerkId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const limit = await readRateLimit(clerkId);
    if (!limit.allowed) {
      return NextResponse.json(
        { error: "Too many requests. Please wait a bit and try again." },
        { status: 429 }
      );
    }

    const userId = await findUserIdByClerkId(clerkId);
    if (!userId) {
      // User hasn't created any projects yet
      return NextResponse.json([]);
    }

    const { searchParams } = new URL(request.url);
    const rawLimit = searchParams.get("limit");
    const parsedLimit = rawLimit === null ? undefined : Number(rawLimit);
    if (parsedLimit !== undefined && !Number.isFinite(parsedLimit)) {
      return NextResponse.json({ error: "Invalid limit." }, { status: 400 });
    }

    // List view only needs metadata — the transcript + EDL jsonb are never
    // selected (see listProjectPage). `hasEdl` is presence-only (ADR 0004
    // child 1): it drives the "Ready for step 2" vs "Ready" dashboard label
    // without ever reading the EDL itself.
    let page;
    try {
      page = await listProjectPage(userId, {
        cursor: searchParams.get("cursor") ?? undefined,
        limit: parsedLimit,
      });
    } catch {
      // listProjectPage only throws for a cursor we didn't issue.
      return NextResponse.json({ error: "Invalid cursor." }, { status: 400 });
    }

    // Explicit no-store: per-user project list must never be served stale or
    // shared across users by an intermediary.
    const headers: Record<string, string> = { "Cache-Control": "no-store" };
    if (page.nextCursor) headers["X-Next-Cursor"] = page.nextCursor;

    return NextResponse.json(page.data, { headers });
  } catch (error) {
    reportError("Error listing projects", error);
    return NextResponse.json(
      { error: "Failed to list projects." },
      { status: 500 }
    );
  }
}
