import { NextResponse } from "next/server";
import { list, del } from "@vercel/blob";
import { db } from "@repo/db";
import { brollAssets } from "@repo/db/schema";
import { sql } from "drizzle-orm";
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

  // The row half of the same problem (spec `broll/0007` AC-130). The two are
  // deliberately separate passes over separate stores: above collects objects
  // with no row, this collects rows with no objects, and neither can stand in
  // for the other.
  let charactersDeleted = 0;
  try {
    charactersDeleted = await sweepEmptyCharacters();
  } catch (error) {
    reportError("Character sweep failed to collect empty characters", error);
  }

  if (deleted > 0 || failed > 0 || charactersDeleted > 0) {
    console.log(
      `[broll-character-sweep] scanned=${scanned} deleted=${deleted} failed=${failed} charactersDeleted=${charactersDeleted}`
    );
  }

  return NextResponse.json({ scanned, deleted, failed, charactersDeleted });
}

/**
 * Delete character rows that never received an image (AC-130).
 *
 * **These exist because the generate route creates the character before turn 1**
 * — every pathname the run mints names it, so the row has to exist first — and
 * creates it *before* reserving the money, so a user at the cap is refused
 * before any charge. A run that dies in that gap leaves a row with no assets,
 * counting against `MAX_CHARACTERS_PER_USER` forever and cluttering the picker
 * that the characters page shows.
 *
 * **Three guards, and each one is load bearing:**
 *
 * - *No assets.* The whole definition of empty. A character with even one stored
 *   image is a partial set someone may still commit, and is not ours to delete.
 * - *Old enough.* The same hour as the object sweep above, and for the same
 *   reason: a character created seconds ago legitimately has no assets yet,
 *   because the browser uploads all six and commits once at the end. An hour is
 *   far past the ten minute claim window that bounds a live run.
 * - *No project pointing at it.* Belt and braces, since a project attaching to a
 *   character with no images should be impossible — `resolveCompleteCharacter`
 *   refuses an incomplete one. If it ever happened, deleting the row would null
 *   that project's reference silently, which is precisely the failure the
 *   characters page's delete refusal exists to prevent.
 */
async function sweepEmptyCharacters(): Promise<number> {
  const cutoff = new Date(Date.now() - ORPHAN_MIN_AGE_MS);

  const result = await db.execute(sql`
    DELETE FROM broll_characters c
    WHERE c.created_at < ${cutoff.toISOString()}
      AND NOT EXISTS (SELECT 1 FROM broll_assets a WHERE a.broll_character_id = c.id)
      AND NOT EXISTS (SELECT 1 FROM broll_projects p WHERE p.broll_character_id = c.id)
    RETURNING c.id
  `);

  const rows = (result as unknown as { rows: { id?: string }[] }).rows ?? [];
  return rows.length;
}
