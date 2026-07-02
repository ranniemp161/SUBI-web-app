import { randomBytes } from "crypto";
import { auth, currentUser } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { projects } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getOwnedProject } from "@/lib/projects";
import { hasValidAccessCode } from "@/lib/access-code";
import { rateLimit } from "@/lib/rate-limit";
import { reportError } from "@/lib/observability";
import {
  DEEPGRAM_MAX_UPLOAD_BYTES,
  extractDeepgramError,
  normalizeDeepgram,
  type DeepgramResponse,
} from "@/lib/deepgram";

// Transcription is the expensive path (Deepgram cost + a large in-memory proxy
// pass), so cap how often a single user can kick it off.
const TRANSCRIBE_LIMIT = 30;
const TRANSCRIBE_WINDOW_SECONDS = 3600;

/**
 * POST /api/transcribe/deepgram?projectId=<id>
 *
 * Kicks off Deepgram transcription by proxying the media through our own
 * server. The browser can't upload straight to api.deepgram.com — the
 * pre-recorded REST endpoint doesn't send CORS headers, so a cross-origin
 * fetch with an Authorization header is blocked at preflight. So the browser
 * POSTs the raw media here (Content-Type = the file's type) and we forward it
 * to Deepgram with our key.
 *
 * Two completion modes, chosen by whether we can hand Deepgram a publicly
 * reachable callback URL:
 *
 * - **Callback (public host):** we pass a `callback` URL; Deepgram accepts the
 *   job immediately and POSTs the finished transcript to
 *   /api/transcribe/callback. This route returns as soon as the job is
 *   accepted — the connection isn't held for the whole transcription.
 * - **Synchronous (localhost):** Deepgram can't reach a localhost callback
 *   (it rejects it as "Invalid callback URL"), so instead we omit the callback
 *   and read the transcript straight out of Deepgram's HTTP response, storing
 *   it here before returning. No tunnel needed for local dev — mirrors how the
 *   local faster-whisper path works.
 */
function isLocalHostname(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "::1" ||
    hostname === "[::1]" ||
    hostname.endsWith(".local")
  );
}

export async function POST(request: Request) {
  const { userId: clerkId } = await auth();

  if (!clerkId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const clerkUser = await currentUser();

  if (!hasValidAccessCode(clerkUser?.unsafeMetadata)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const limit = await rateLimit(
    `transcribe:${clerkId}`,
    TRANSCRIBE_LIMIT,
    TRANSCRIBE_WINDOW_SECONDS
  );
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "You're transcribing too frequently. Please wait a bit and try again." },
      { status: 429 }
    );
  }

  const deepgramApiKey = process.env.DEEPGRAM_API_KEY;

  if (!deepgramApiKey) {
    console.error("DEEPGRAM_API_KEY is not set.");
    return NextResponse.json(
      { error: "Server configuration error." },
      { status: 500 }
    );
  }

  const projectId = new URL(request.url).searchParams.get("projectId");

  if (!projectId) {
    return NextResponse.json({ error: "projectId is required." }, { status: 400 });
  }

  const project = await getOwnedProject(projectId, clerkId);

  if (!project) {
    return NextResponse.json({ error: "Project not found." }, { status: 404 });
  }

  if (!request.body) {
    return NextResponse.json({ error: "No media in request body." }, { status: 400 });
  }

  // Reject oversized uploads before streaming a multi-GB body to Deepgram only
  // to have it rejected. The browser sets Content-Length for a File body; if
  // it's absent we let Deepgram be the backstop.
  const contentLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > DEEPGRAM_MAX_UPLOAD_BYTES) {
    return NextResponse.json(
      {
        error: `This file is too large to transcribe (max ${Math.floor(
          DEEPGRAM_MAX_UPLOAD_BYTES / (1024 * 1024 * 1024)
        )} GB). Try a shorter clip or a smaller file.`,
      },
      { status: 413 }
    );
  }

  // The base Deepgram's callback must POST back to. PUBLIC_APP_URL (a tunnel's
  // https origin) overrides the request origin for local-dev callback testing;
  // otherwise we use the request origin, which is already public in production.
  const callbackBase = (process.env.PUBLIC_APP_URL ?? new URL(request.url).origin).replace(/\/+$/, "");
  // A localhost base can't receive a Deepgram callback, so fall back to reading
  // the transcript synchronously from the response instead.
  const useSync = isLocalHostname(new URL(callbackBase).hostname);

  const params = new URLSearchParams({
    model: "nova-3",
    smart_format: "true",
    punctuate: "true",
  });

  // Callback mode needs a one-time token so the (unsigned) callback can be
  // verified as ours. Sync mode reads the transcript here, so no token/callback.
  const callbackToken = useSync ? null : randomBytes(32).toString("hex");
  if (!useSync && callbackToken) {
    params.set(
      "callback",
      `${callbackBase}/api/transcribe/callback?projectId=${projectId}&token=${callbackToken}`
    );
  }

  await db
    .update(projects)
    .set({
      transcriptStatus: "processing",
      transcriptCallbackToken: callbackToken,
      updatedAt: new Date(),
    })
    .where(eq(projects.id, projectId));

  // [DIAGNOSTIC] Count bytes we actually forward to Deepgram so we can compare
  // against the declared Content-Length and detect a truncated upload.
  const declaredBytes = Number(request.headers.get("content-length")) || null;
  let forwardedBytes = 0;
  const counter = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      forwardedBytes += chunk.byteLength;
      controller.enqueue(chunk);
    },
  });
  const countedBody = request.body.pipeThrough(counter);

  try {
    // Stream the upload straight through to Deepgram instead of buffering the
    // whole file into memory with arrayBuffer() — a multi-GB Buffer + single
    // socket write is what blew up with EPROTO. `duplex: "half"` is required
    // by Node/undici whenever the fetch body is a stream.
    const dgResponse = await fetch(`https://api.deepgram.com/v1/listen?${params}`, {
      method: "POST",
      headers: {
        Authorization: `Token ${deepgramApiKey}`,
        "Content-Type":
          request.headers.get("content-type") || "application/octet-stream",
      },
      body: countedBody,
      duplex: "half",
    } as RequestInit & { duplex: "half" });

    // [DIAGNOSTIC] Log the byte accounting the moment Deepgram responds.
    console.warn(
      `[dg-diag] status=${dgResponse.status} contentType=${request.headers.get("content-type")} declaredBytes=${declaredBytes} forwardedBytes=${forwardedBytes} truncated=${declaredBytes !== null && forwardedBytes < declaredBytes}`
    );

    if (!dgResponse.ok) {
      const detail = await dgResponse.text();
      console.error("Deepgram rejected the transcription request:", detail);
      // Don't leave the project stuck on "processing" — no transcript is coming.
      await db
        .update(projects)
        .set({
          transcriptStatus: "failed",
          transcriptCallbackToken: null,
          updatedAt: new Date(),
        })
        .where(eq(projects.id, projectId));

      return NextResponse.json(
        { error: "Deepgram rejected the request.", detail: extractDeepgramError(detail) },
        { status: 502 }
      );
    }

    // Callback mode: Deepgram only acknowledged the job here — the transcript
    // arrives later at /api/transcribe/callback, which flips status to ready.
    if (!useSync) {
      return NextResponse.json({ received: true });
    }

    // Sync mode: the transcript is in this response. Normalize and store it, so
    // the dashboard's polling sees "ready" on its next tick.
    const payload = (await dgResponse.json()) as DeepgramResponse;
    const transcript = normalizeDeepgram(payload);

    await db
      .update(projects)
      .set({
        transcript,
        transcriptStatus: "ready",
        transcriptCallbackToken: null,
        updatedAt: new Date(),
      })
      .where(eq(projects.id, projectId));

    return NextResponse.json({ received: true });
  } catch (error) {
    reportError("Error starting Deepgram transcription", error);
    await db
      .update(projects)
      .set({
        transcriptStatus: "failed",
        transcriptCallbackToken: null,
        updatedAt: new Date(),
      })
      .where(eq(projects.id, projectId));

    return NextResponse.json(
      { error: "Failed to start transcription." },
      { status: 500 }
    );
  }
}
