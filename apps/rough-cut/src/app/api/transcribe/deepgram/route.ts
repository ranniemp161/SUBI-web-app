import { randomBytes } from "crypto";
import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { del } from "@vercel/blob";
import { db } from "@repo/db";
import { projects } from "@repo/db/schema";
import { eq } from "drizzle-orm";
import { getOwnedProject } from "@/lib/projects";
import { getAuthorizedDbUser } from "@/lib/authz";
import {
  costSecondsForDurationMs,
  ensureMonthlyGrant,
  memberGrantMicros,
  reclaimStaleHold,
  reserveCredits,
  secondsFromDeepgramDuration,
  settleHold,
  STALE_HOLD_MS,
} from "@/lib/credits";
import { rateLimit } from "@/lib/rate-limit";
import { reportError } from "@/lib/observability";
import { isOwnBlobUrl } from "@/lib/blob";
import {
  extractDeepgramError,
  normalizeDeepgram,
  type DeepgramResponse,
} from "@/lib/deepgram";

// Transcription is the expensive path (Deepgram cost), so cap how often a
// single user can kick it off.
const TRANSCRIBE_LIMIT = 30;
const TRANSCRIBE_WINDOW_SECONDS = 3600;

/**
 * POST /api/transcribe/deepgram?projectId=<id>
 *
 * Kicks off Deepgram transcription. The browser has already uploaded the
 * extracted audio straight to Vercel Blob (see /api/transcribe/blob-token) —
 * this route just receives that blob's URL as a small JSON body and tells
 * Deepgram to fetch it directly, so our server never touches the audio bytes.
 * This also sidesteps Vercel serverless Functions' ~4.5MB request body cap,
 * which the old raw-body-proxy design would have hit on any real recording.
 *
 * Two completion modes, chosen by whether we can hand Deepgram a publicly
 * reachable callback URL:
 *
 * - **Callback (public host):** we pass a `callback` URL; Deepgram accepts the
 *   job immediately and POSTs the finished transcript to
 *   /api/transcribe/callback. This route returns as soon as the job is
 *   accepted — the connection isn't held for the whole transcription. The
 *   blob can't be deleted yet (Deepgram fetches it asynchronously after we
 *   return), so its URL rides along in the callback URL's query string for
 *   the callback route to clean up once the job actually finishes.
 * - **Synchronous (localhost):** Deepgram can't reach a localhost callback
 *   (it rejects it as "Invalid callback URL"), so instead we omit the callback
 *   and read the transcript straight out of Deepgram's HTTP response, storing
 *   it here before returning — and deleting the blob immediately after, since
 *   nothing else needs it once the transcript is captured.
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

/** Best-effort blob cleanup — a failed delete shouldn't mask the real result. */
async function deleteBlobQuietly(blobUrl: string) {
  try {
    await del(blobUrl);
  } catch (error) {
    reportError("Failed to delete transcription blob", error);
  }
}

/** Best-effort settle — a credits hiccup must never mask the transcript result. */
async function settleHoldQuietly(projectId: string, actualSeconds: number | null) {
  try {
    await settleHold(projectId, actualSeconds);
  } catch (error) {
    reportError("Failed to settle credit hold", error, { projectId });
  }
}

export async function POST(request: Request) {
  const { userId: clerkId } = await auth();

  if (!clerkId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = await getAuthorizedDbUser(clerkId);

  if (!user) {
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

  const { blobUrl } = await request.json().catch(() => ({ blobUrl: null }));

  if (typeof blobUrl !== "string" || !isOwnBlobUrl(blobUrl)) {
    return NextResponse.json({ error: "Invalid or missing blobUrl." }, { status: 400 });
  }

  // Credits: top up the member grant if a new month started, then atomically
  // reserve this job's cost (charged now, trued up against Deepgram's
  // authoritative duration when the transcript lands — see lib/credits.ts).
  await ensureMonthlyGrant(user.id, memberGrantMicros());

  const costSeconds = costSecondsForDurationMs(project.durationMs);
  let reserved = await reserveCredits(user.id, projectId, costSeconds);

  if (reserved.status === "already_held") {
    // Only reclaim a hold that's BOTH not "processing" AND has sat past
    // STALE_HOLD_MS — checked and cleared atomically in one statement against
    // the database's current state, not an in-memory snapshot taken before
    // this reserve attempt. That distinction matters: a snapshot can't tell
    // "an earlier attempt crashed" apart from "a concurrent request just
    // reserved and hasn't written 'processing' yet" — both look identical to
    // a stale read — so trusting one would let a live request's hold get
    // refunded and stolen out from under it.
    const reclaimed = await reclaimStaleHold(projectId, STALE_HOLD_MS);
    if (reclaimed) {
      reserved = await reserveCredits(user.id, projectId, costSeconds);
    }
  }

  if (reserved.status === "already_held") {
    return NextResponse.json(
      { error: "A transcription for this project is already in progress." },
      { status: 409 }
    );
  }

  if (reserved.status === "insufficient") {
    return NextResponse.json(
      {
        error: "Not enough credits to transcribe this video.",
        code: "INSUFFICIENT_CREDITS",
        requiredSeconds: costSeconds,
      },
      { status: 402 }
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
    // Transcribe disfluencies ("um", "uh") so the editor's filler-word removal
    // has something to find — Deepgram omits them by default.
    filler_words: "true",
  });

  // Callback mode needs a one-time token so the (unsigned) callback can be
  // verified as ours. Sync mode reads the transcript here, so no token/callback.
  const callbackToken = useSync ? null : randomBytes(32).toString("hex");
  if (!useSync && callbackToken) {
    params.set(
      "callback",
      `${callbackBase}/api/transcribe/callback?projectId=${projectId}&token=${callbackToken}&blobUrl=${encodeURIComponent(blobUrl)}`
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

  try {
    // Hand Deepgram a URL instead of streaming bytes — Deepgram fetches the
    // audio itself, so our request body is tiny regardless of recording length.
    const dgResponse = await fetch(`https://api.deepgram.com/v1/listen?${params}`, {
      method: "POST",
      headers: {
        Authorization: `Token ${deepgramApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ url: blobUrl }),
    });

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

      // Whether sync or callback mode, a rejected initial request means no
      // callback will ever arrive — safe to clean up now either way.
      await settleHoldQuietly(projectId, 0);
      await deleteBlobQuietly(blobUrl);

      return NextResponse.json(
        { error: "Deepgram rejected the request.", detail: extractDeepgramError(detail) },
        { status: 502 }
      );
    }

    // Callback mode: Deepgram only acknowledged the job here — the transcript
    // arrives later at /api/transcribe/callback, which flips status to ready
    // and deletes the blob once Deepgram has actually fetched and used it.
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

    // Reconcile the hold against the duration Deepgram actually measured —
    // the client-reported one the hold was based on can't be trusted.
    await settleHoldQuietly(
      projectId,
      secondsFromDeepgramDuration(payload.metadata?.duration)
    );
    await deleteBlobQuietly(blobUrl);

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

    await settleHoldQuietly(projectId, 0);
    await deleteBlobQuietly(blobUrl);

    return NextResponse.json(
      { error: "Failed to start transcription." },
      { status: 500 }
    );
  }
}
