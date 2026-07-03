import { auth, currentUser } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { del } from "@vercel/blob";
import { getOwnedProject } from "@/lib/projects";
import { hasValidAccessCode } from "@/lib/access-code";
import { rateLimit } from "@/lib/rate-limit";
import { reportError } from "@/lib/observability";
import { isOwnBlobUrl, projectIdFromBlobUrl } from "@/lib/blob";

// Mirrors the blob-token bucket sizing: cleanup accompanies (failed) uploads,
// so it should never need more headroom than uploads get. Separate key so a
// burst of cleanups can't eat into the upload budget or vice versa.
const BLOB_CLEANUP_LIMIT = 60;
const BLOB_CLEANUP_WINDOW_SECONDS = 3600;

/**
 * POST /api/transcribe/blob-cleanup
 *
 * Deletes an orphaned upload: the client PUT its audio to Vercel Blob but the
 * follow-up call to /api/transcribe/deepgram failed (network drop, rate
 * limit, server error before Deepgram was told the URL). The server has no
 * record of the blob at that point — its URL lives only in the browser — so
 * the browser hands it back here for deletion instead of leaving ~30MB of
 * dead audio in the store until the daily sweep (/api/cron/blob-sweep) finds
 * it. Only the owner of the project encoded in the blob's pathname may
 * delete it.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const { userId: clerkId } = await auth();

  if (!clerkId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const clerkUser = await currentUser();

  if (!hasValidAccessCode(clerkUser?.unsafeMetadata)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const limit = await rateLimit(
    `blob-cleanup:${clerkId}`,
    BLOB_CLEANUP_LIMIT,
    BLOB_CLEANUP_WINDOW_SECONDS
  );
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Too many cleanup requests. Please wait a bit and try again." },
      { status: 429 }
    );
  }

  const { blobUrl } = await request.json().catch(() => ({ blobUrl: null }));

  if (typeof blobUrl !== "string" || !isOwnBlobUrl(blobUrl)) {
    return NextResponse.json({ error: "Invalid or missing blobUrl." }, { status: 400 });
  }

  // The upload pathname convention (projects/<projectId>/…) encodes the owner
  // — enforced at token issuance — so ownership of the blob reduces to
  // ownership of that project.
  const projectId = projectIdFromBlobUrl(blobUrl);
  const project = projectId ? await getOwnedProject(projectId, clerkId) : null;

  if (!project) {
    return NextResponse.json({ error: "Project not found." }, { status: 404 });
  }

  try {
    await del(blobUrl);
    return NextResponse.json({ deleted: true });
  } catch (error) {
    reportError("Failed to delete orphaned blob", error);
    return NextResponse.json({ error: "Failed to delete blob." }, { status: 500 });
  }
}
