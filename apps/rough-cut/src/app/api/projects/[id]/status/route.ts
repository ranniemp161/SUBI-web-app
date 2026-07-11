import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { getOwnedProjectStatus } from "@/lib/projects";
import { readRateLimit } from "@/lib/rate-limit";
import { reportError } from "@/lib/observability";

/**
 * GET /api/projects/:id/status — just the transcript status.
 *
 * The dashboard polls this while a project is transcribing. It returns a single
 * field instead of the whole project (transcript + EDL jsonb), so a 4s poll
 * across several in-flight projects stays cheap on both the wire and the DB.
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
    const transcriptStatus = await getOwnedProjectStatus(id, clerkId);

    if (transcriptStatus === null) {
      return NextResponse.json({ error: "Project not found." }, { status: 404 });
    }

    // Explicit no-store: this is polled per-user state — a cache or proxy
    // serving a stale "transcribing" would strand the dashboard's poll loop.
    return NextResponse.json(
      { transcriptStatus },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    reportError("Error fetching project status", error);
    return NextResponse.json(
      { error: "Failed to fetch project status." },
      { status: 500 }
    );
  }
}
