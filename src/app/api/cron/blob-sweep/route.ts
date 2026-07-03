import { timingSafeEqual } from "crypto";
import { NextResponse } from "next/server";
import { list, del } from "@vercel/blob";
import { reportError } from "@/lib/observability";

/**
 * How old a blob must be before the sweep considers it orphaned. Every legit
 * blob is deleted within minutes of upload (sync mode: same request; callback
 * mode: when Deepgram's callback lands — and Deepgram fetches the audio right
 * after accepting the job, well before this). Six hours leaves a huge margin
 * over the longest plausible transcription while still keeping storage churn
 * bounded to a day's orphans at most.
 */
const ORPHAN_MAX_AGE_MS = 6 * 60 * 60 * 1000;

/** Constant-time comparison, mirroring the callback route's token check. */
function secretsMatch(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * GET /api/cron/blob-sweep
 *
 * Deletes orphaned transcription audio from Vercel Blob. The normal flow
 * deletes each blob as soon as its transcript is captured, but two gaps can
 * strand one: the browser dies between uploading and telling the server (tab
 * closed mid-flow, lost network — the client's best-effort call to
 * /api/transcribe/blob-cleanup narrows but can't close this), or the server
 * crashes between Deepgram accepting a callback-mode job and the callback
 * arriving. Uploads are pinned under `projects/` at token issuance precisely
 * so this sweep's prefix listing is guaranteed to see every one of them.
 *
 * Invoked by Vercel Cron (see vercel.json) with
 * `Authorization: Bearer ${CRON_SECRET}` — Vercel injects that header
 * automatically for cron requests when the CRON_SECRET env var is set.
 */
export async function GET(request: Request): Promise<NextResponse> {
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret) {
    console.error("CRON_SECRET is not set — blob sweep is disabled.");
    return NextResponse.json({ error: "Server configuration error." }, { status: 500 });
  }

  const authHeader = request.headers.get("authorization") ?? "";
  if (!secretsMatch(authHeader, `Bearer ${cronSecret}`)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const cutoff = Date.now() - ORPHAN_MAX_AGE_MS;
  let scanned = 0;
  let deleted = 0;
  let failed = 0;

  try {
    let cursor: string | undefined;
    do {
      const page = await list({ prefix: "projects/", cursor, limit: 1000 });
      scanned += page.blobs.length;

      const staleUrls = page.blobs
        .filter((blob) => new Date(blob.uploadedAt).getTime() < cutoff)
        .map((blob) => blob.url);

      if (staleUrls.length > 0) {
        try {
          await del(staleUrls);
          deleted += staleUrls.length;
        } catch (error) {
          // Keep sweeping the remaining pages — next run retries these.
          reportError("Blob sweep failed to delete a batch", error);
          failed += staleUrls.length;
        }
      }

      cursor = page.hasMore ? page.cursor : undefined;
    } while (cursor);
  } catch (error) {
    reportError("Blob sweep failed while listing blobs", error);
    return NextResponse.json(
      { error: "Sweep failed.", scanned, deleted, failed },
      { status: 500 }
    );
  }

  if (deleted > 0 || failed > 0) {
    console.log(`[blob-sweep] scanned=${scanned} deleted=${deleted} failed=${failed}`);
  }

  return NextResponse.json({ scanned, deleted, failed });
}
