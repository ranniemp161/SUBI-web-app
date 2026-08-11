import "server-only";
import { db } from "@repo/db";
import { brollAssets, brollProjects } from "@repo/db/schema";
import { and, asc, eq, sql } from "drizzle-orm";
import type { CharacterEmotion } from "./emotions";

/**
 * Every query that reaches `broll_assets`, for the same reason `projects.ts` and
 * `scenes.ts` exist: the owner scoping and the replace semantics hold in one
 * place rather than in each caller.
 *
 * The replace rules here are the ones spec `broll/0004` calls invariant 6 and
 * AC-69: a replacement is a **new pathname**, never an overwrite, and its row is
 * written **before** the superseded object is deleted. Both live in
 * `storeCharacterAssets` rather than in the routes, so neither route can get the
 * order wrong on its own.
 */

/** One stored character variant, as the review gate lists it. */
export type CharacterAsset = {
  emotion: CharacterEmotion;
  pathname: string;
  width: number;
  height: number;
  byteSize: number;
  attempt: number;
};

/** What a caller asks to be stored. `byteSize` is measured server side, never claimed. */
export type StoredAssetInput = {
  emotion: CharacterEmotion;
  pathname: string;
  width: number;
  height: number;
  byteSize: number;
};

export async function listCharacterAssets(
  userId: string,
  projectId: string
): Promise<CharacterAsset[]> {
  const rows = await db
    .select({
      emotion: brollAssets.emotion,
      pathname: brollAssets.r2Key,
      width: brollAssets.width,
      height: brollAssets.height,
      byteSize: brollAssets.byteSize,
      attempt: brollAssets.attempt,
    })
    .from(brollAssets)
    .innerJoin(brollProjects, eq(brollAssets.brollProjectId, brollProjects.id))
    .where(
      and(
        eq(brollAssets.brollProjectId, projectId),
        eq(brollProjects.userId, userId)
      )
    )
    .orderBy(asc(brollAssets.emotion));

  return rows.map((row) => ({
    ...row,
    emotion: row.emotion as CharacterEmotion,
  }));
}

/**
 * How many free regenerations this project has spent (AC-64).
 *
 * **Derived, never stored.** `attempt` starts at 1 on a first store, so
 * `SUM(attempt) - COUNT(*)` is exactly the number of replacements across the
 * set, and a project with no assets answers zero. A separate counter column
 * would be a second source of truth for a number the rows already carry, and the
 * two would drift the first time a row was replaced by a path that skipped it.
 */
export async function regenerationsUsed(
  userId: string,
  projectId: string
): Promise<number> {
  const rows = await db
    .select({
      used: sql<number>`coalesce(sum(${brollAssets.attempt}), 0) - count(*)`,
    })
    .from(brollAssets)
    .innerJoin(brollProjects, eq(brollAssets.brollProjectId, brollProjects.id))
    .where(
      and(
        eq(brollAssets.brollProjectId, projectId),
        eq(brollProjects.userId, userId)
      )
    );

  return Number(rows[0]?.used ?? 0);
}

/**
 * Store or replace character assets, and report which objects they superseded.
 *
 * One statement, so a set of six is written whole or not at all: `broll_scenes`
 * gets the same treatment for the same reason, and here a half written set would
 * be exactly the partial set invariant 3 forbids.
 *
 * `attempt` is where the two modes differ, and it is the whole of AC-64/AC-65:
 *
 * - `mode: "set"` writes **1**, resetting the count, because a full re-run is a
 *   fresh purchase at the full price and a purchase must not consume the free
 *   regeneration allowance it just paid to refill.
 * - `mode: "variant"` writes the previous row's value **plus one**, which is
 *   what makes `SUM(attempt) - COUNT(*)` count regenerations.
 *
 * Returns the pathnames the write superseded. The caller deletes them **after**
 * this resolves, never before: the other order leaves an emotion with no image
 * at all if the write fails (invariant 6).
 */
export async function storeCharacterAssets(
  projectId: string,
  assets: readonly StoredAssetInput[],
  mode: "set" | "variant"
): Promise<{ stored: number; superseded: string[] }> {
  if (assets.length === 0) return { stored: 0, superseded: [] };

  const values = sql.join(
    assets.map(
      (asset) => sql`(
        ${projectId}::uuid,
        ${asset.emotion}::text,
        ${asset.pathname}::text,
        ${asset.width}::integer,
        ${asset.height}::integer,
        ${asset.byteSize}::integer
      )`
    ),
    sql`, `
  );

  // `EXCLUDED` carries the incoming row; `broll_assets.attempt` on the right of
  // the assignment is the existing one. The unique index on
  // (broll_project_id, emotion) is what makes replace in place true here rather
  // than merely intended.
  const attempt =
    mode === "set" ? sql`1` : sql`${brollAssets.attempt} + 1`;

  const result = await db.execute(sql`
    WITH incoming (broll_project_id, emotion, r2_key, width, height, byte_size) AS (
      VALUES ${values}
    ),
    prior AS (
      SELECT a.emotion, a.r2_key
      FROM broll_assets a
      JOIN incoming i
        ON i.broll_project_id = a.broll_project_id AND i.emotion = a.emotion
      WHERE a.r2_key <> i.r2_key
    ),
    upserted AS (
      INSERT INTO broll_assets (
        broll_project_id, emotion, r2_key, width, height, byte_size, attempt
      )
      SELECT broll_project_id, emotion, r2_key, width, height, byte_size, 1
      FROM incoming
      ON CONFLICT (broll_project_id, emotion) DO UPDATE
      SET r2_key = EXCLUDED.r2_key,
          width = EXCLUDED.width,
          height = EXCLUDED.height,
          byte_size = EXCLUDED.byte_size,
          attempt = ${attempt},
          updated_at = now()
      RETURNING emotion
    )
    SELECT
      (SELECT count(*)::int FROM upserted) AS stored,
      coalesce((SELECT array_agg(r2_key) FROM prior), ARRAY[]::text[]) AS superseded
  `);

  const rows =
    (result as unknown as { rows: { stored?: number; superseded?: string[] }[] })
      .rows ?? [];

  return {
    stored: Number(rows[0]?.stored ?? 0),
    superseded: rows[0]?.superseded ?? [],
  };
}
