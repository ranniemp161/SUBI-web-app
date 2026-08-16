import { NextResponse } from "next/server";
import { list, del } from "@vercel/blob";
import { db } from "@repo/db";
import { brollAssets } from "@repo/db/schema";
import { reportError } from "@repo/server-shared/observability";
import { isStorageConfigured } from "@/lib/storage";

/**
 * `GET /api/cron/character-sweep` — delete stored character images that no row
 * references (spec `broll/0004` AC-73, invariant 9).
 *
 * The commit route sweeps its own project's prefix, which covers a run that
 * finishes. This covers the run that never commits at all: the tab closes
 * halfway through six uploads, and four objects sit in the store with nothing
 * pointing at them. On a plan whose failure mode is a thirty day lockout, and
 * one shared with Ruff Cut's transcription uploads, letting those accumulate is
 * not a tidiness problem.
 *
 * **The age guard is the whole safety of this.** An object uploaded seconds ago
 * legitimately has no row yet: the browser uploads all six and commits once at
 * the end. Sweeping by prefix alone would delete a set out from under the run
 * that is still storing it. An hour is far past the ten minute claim window that
 * bounds a live run.
 *
 * Invoked by Vercel Cron (see `vercel.json`) with
 * `Authorization: Bearer ${CRON_SECRET}`, which Vercel injects for cron requests
 * when that variable is set. `proxy.ts` lists this path as public so Clerk does
 * not 401 it before its own check runs — the same shape as Ruff Cut's
 * `blob-sweep`.
 *
 * **Once a day, not more.** Vercel's Hobby plan caps cron at one run per day
 * (see the root `AGENTS.md`), so this is deliberately a floor on latency rather
 * than the cadence the work wants.
 */

/** Old enough that no live run could still be uploading it. */
const ORPHAN_MIN_AGE_MS = 60 * 60 * 1000;

/** Constant time comparison, mirroring Ruff Cut's cron route. */
function secretsMatch(provided: string, expected: string): boolean {
  if (provided.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < provided.length; i += 1) {
    diff |= provided.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return diff === 0;
}

export async function GET(request: Request): Promise<NextResponse> {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    console.error("CRON_SECRET is not set — the character sweep is disabled.");
    return NextResponse.json({ error: "Server configuration error." }, { status: 500 });
  }

  const authHeader = request.headers.get("authorization") ?? "";
  if (!secretsMatch(authHeader, `Bearer ${cronSecret}`)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!isStorageConfigured()) {
    return NextResponse.json({ error: "Storage isn't configured." }, { status: 503 });
  }

  const cutoff = Date.now() - ORPHAN_MIN_AGE_MS;
  let scanned = 0;
  let deleted = 0;
  let failed = 0;

  try {
    // Read the referenced set **first**. A row written while the listing is in
    // flight is then either already in this set or belongs to an object too new
    // to be swept, so the age guard covers the gap either way.
    const rows = await db.select({ pathname: brollAssets.r2Key }).from(brollAssets);
    const referenced = new Set(rows.map((row) => row.pathname));

    let cursor: string | undefined;
    do {
      // `broll/characters/`, not `broll/` (spec `broll/0007` AC-144). Every
      // stored object lives under a character now, and no old project shaped
      // path survives the `0018` migration, so a wider prefix would only widen
      // what a bug here could delete.
      const page = await list({
        prefix: "broll/characters/",
        cursor,
        limit: 1000,
      });
      scanned += page.blobs.length;

      const orphans = page.blobs
        .filter(
          (blob) =>
            !referenced.has(blob.pathname) &&
            new Date(blob.uploadedAt).getTime() < cutoff
        )
        .map((blob) => blob.url);

      if (orphans.length > 0) {
        try {
          await del(orphans);
          deleted += orphans.length;
        } catch (error) {
          // Keep sweeping the remaining pages; the next run retries these.
          reportError("Character sweep failed to delete a batch", error);
          failed += orphans.length;
        }
      }

      cursor = page.hasMore ? page.cursor : undefined;
    } while (cursor);
  } catch (error) {
    reportError("Character sweep failed while listing", error);
    return NextResponse.json(
      { error: "Sweep failed.", scanned, deleted, failed },
      { status: 500 }
    );
  }

  if (deleted > 0 || failed > 0) {
    console.log(
      `[broll-character-sweep] scanned=${scanned} deleted=${deleted} failed=${failed}`
    );
  }

  return NextResponse.json({ scanned, deleted, failed });
}
