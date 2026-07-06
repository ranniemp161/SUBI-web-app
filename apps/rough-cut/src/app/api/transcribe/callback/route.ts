import { timingSafeEqual } from "crypto";
import { NextResponse } from "next/server";
import { del } from "@vercel/blob";
import { db } from "@/db";
import { projects } from "@/db/schema";
import { eq } from "drizzle-orm";
import { normalizeDeepgram } from "@/lib/deepgram";
import { secondsFromDeepgramDuration, settleHold } from "@/lib/credits";
import { reportError } from "@/lib/observability";
import { ipRateLimit } from "@/lib/ip-rate-limit";

// Headroom for parsing large Deepgram payloads on long videos.
export const maxDuration = 60;

// This route has no Clerk session (Deepgram calls it directly), so it's
// exempt from src/proxy.ts's middleware and from the per-user limits used
// elsewhere. The per-project token below is the real gate; this cap just
// bounds the DB read below to a fixed cost per IP regardless of how many
// well-formed-but-wrong requests someone sends. 60/10min gives headroom for
// Deepgram's callback infra, which may share egress IPs across many
// customers' concurrent jobs.
const CALLBACK_LIMIT = 60;
const CALLBACK_WINDOW_SECONDS = 600;

// Matches randomBytes(32).toString("hex") from the deepgram route exactly —
// rejecting anything else here costs nothing (no DB, no rate limiter) and
// filters out the vast majority of garbage before either.
const TOKEN_SHAPE = /^[0-9a-f]{64}$/i;

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

/**
 * POST /api/transcribe/callback
 *
 * Deepgram posts the finished transcript here. There's no Clerk session on
 * this request — Deepgram is calling us directly — and Deepgram doesn't
 * sign its callback payloads, so the per-project random token in the query
 * string is the only thing standing between this route and anyone who
 * guesses the URL. Compare it with a timing-safe equality check.
 */
export async function POST(request: Request) {
  const url = new URL(request.url);
  const projectId = url.searchParams.get("projectId");
  const token = url.searchParams.get("token");
  // The blob URL the deepgram route embedded in this callback URL when it
  // kicked off the job — this is the only record of it, since nothing is
  // persisted to the DB while the job is in flight (see deepgram/route.ts).
  const blobUrl = url.searchParams.get("blobUrl");

  const isValidUuid =
    !!projectId &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      projectId
    );

  if (!isValidUuid || !token || !TOKEN_SHAPE.test(token)) {
    return NextResponse.json(
      { error: "Missing projectId or token." },
      { status: 400 }
    );
  }

  const limit = await ipRateLimit(request, "transcribe-callback", CALLBACK_LIMIT, CALLBACK_WINDOW_SECONDS);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Too many callback requests." },
      { status: 429 }
    );
  }

  const [project] = await db
    .select()
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);

  if (!project?.transcriptCallbackToken) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const expected = Buffer.from(project.transcriptCallbackToken);
  const provided = Buffer.from(token);

  if (
    expected.length !== provided.length ||
    !timingSafeEqual(expected, provided)
  ) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  try {
    const payload = await request.json();

    // Deepgram's callback payload includes an `err_code`/`err_msg` on failure
    // instead of the usual transcription results.
    const failed = typeof payload?.err_code === "string";
    // Store the flat, editor-ready shape on success; leave the transcript
    // untouched on failure (only the status changes).
    const transcript = failed ? undefined : normalizeDeepgram(payload);

    await db
      .update(projects)
      .set({
        ...(transcript ? { transcript } : {}),
        transcriptStatus: failed ? "failed" : "ready",
        // One-time use — clear it so the URL can't be replayed.
        transcriptCallbackToken: null,
        updatedAt: new Date(),
      })
      .where(eq(projects.id, projectId));

    // Settle the credit hold: full refund on failure, otherwise reconcile
    // against the duration Deepgram actually measured — this is where a
    // spoofed client durationMs gets corrected.
    await settleHoldQuietly(
      projectId,
      failed ? 0 : secondsFromDeepgramDuration(payload?.metadata?.duration)
    );

    if (blobUrl) await deleteBlobQuietly(blobUrl);

    // No AI pass here — AI Cut is strictly opt-in from the studio, where the
    // user sees the credit cost before it runs.

    return NextResponse.json({ received: true });
  } catch (error) {
    reportError("Error processing transcribe callback", error);
    await db
      .update(projects)
      .set({
        transcriptStatus: "failed",
        transcriptCallbackToken: null,
        updatedAt: new Date(),
      })
      .where(eq(projects.id, projectId));

    // Deepgram's retry of this callback will 401 on the cleared token, so
    // this is the last chance to release the hold for a failed job.
    await settleHoldQuietly(projectId, 0);

    if (blobUrl) await deleteBlobQuietly(blobUrl);

    return NextResponse.json(
      { error: "Failed to process callback." },
      { status: 500 }
    );
  }
}
