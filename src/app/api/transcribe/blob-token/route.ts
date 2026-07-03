import { auth, currentUser } from "@clerk/nextjs/server";
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { NextResponse } from "next/server";
import { getOwnedProject } from "@/lib/projects";
import { hasValidAccessCode } from "@/lib/access-code";
import { rateLimit } from "@/lib/rate-limit";
import { DEEPGRAM_MAX_UPLOAD_BYTES } from "@/lib/deepgram";
import { uploadPathnameForProject } from "@/lib/blob";
import { reportError } from "@/lib/observability";

// Minting a token costs nothing on its own — no Deepgram call happens until
// the client follows up with a POST to /api/transcribe/deepgram, which has
// its own (lower) rate limit. This is a separate, more generous limit purely
// to bound Blob storage churn, not a stand-in for the transcription-start gate.
const BLOB_UPLOAD_LIMIT = 60;
const BLOB_UPLOAD_WINDOW_SECONDS = 3600;

/**
 * POST /api/transcribe/blob-token
 *
 * Issues a short-lived client upload token so the browser can PUT extracted
 * audio directly to Vercel Blob, bypassing our server entirely for the bytes
 * (Vercel's serverless Functions cap request bodies at ~4.5MB, well under
 * even a modest audio file). `onUploadCompleted` won't fire on localhost
 * without a tunnel (Vercel can't reach it) — same limitation this app already
 * works around for Deepgram's own callback — so it's just a best-effort log,
 * not relied on: the client already gets the blob URL synchronously from
 * `upload()` and drives the next step (POSTing it to /api/transcribe/deepgram)
 * itself.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const body = (await request.json()) as HandleUploadBody;

  try {
    const jsonResponse = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (pathname, clientPayload) => {
        const { userId: clerkId } = await auth();
        if (!clerkId) throw new Error("Not authenticated.");

        const clerkUser = await currentUser();
        if (!hasValidAccessCode(clerkUser?.unsafeMetadata)) {
          throw new Error("Not authorized.");
        }

        const limit = await rateLimit(
          `blob-upload:${clerkId}`,
          BLOB_UPLOAD_LIMIT,
          BLOB_UPLOAD_WINDOW_SECONDS
        );
        if (!limit.allowed) {
          throw new Error("You're uploading too frequently. Please wait a bit and try again.");
        }

        const projectId =
          typeof clientPayload === "string"
            ? (JSON.parse(clientPayload) as { projectId?: string }).projectId
            : undefined;
        if (!projectId) throw new Error("Missing projectId.");

        const project = await getOwnedProject(projectId, clerkId);
        if (!project) throw new Error("Project not found.");

        // Pin the pathname so every upload lands under `projects/` — the
        // orphan sweep only lists that prefix, and a freely chosen pathname
        // would let a client stash blobs where the sweep never finds them.
        // Uniqueness comes from `addRandomSuffix` below, not the pathname.
        if (pathname !== uploadPathnameForProject(projectId)) {
          throw new Error("Unexpected upload pathname.");
        }

        return {
          access: "public",
          addRandomSuffix: true,
          allowedContentTypes: ["audio/*"],
          maximumSizeInBytes: DEEPGRAM_MAX_UPLOAD_BYTES,
          tokenPayload: clientPayload,
        };
      },
      onUploadCompleted: async ({ blob }) => {
        console.log("[blob] client upload completed:", blob.url);
      },
    });

    return NextResponse.json(jsonResponse);
  } catch (error) {
    reportError("Error generating blob upload token", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to generate upload token." },
      { status: 400 }
    );
  }
}
