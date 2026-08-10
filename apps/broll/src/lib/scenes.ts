import "server-only";
import { db } from "@repo/db";
import { brollScenes, brollProjects } from "@repo/db/schema";
import { and, asc, eq, sql } from "drizzle-orm";
import type { SceneChart, VisualType, LayoutTemplate } from "./scene-schema";
import type { CharacterEmotion } from "./emotions";
import type { PlannedScene } from "./planner";

/**
 * Every query that reaches `broll_scenes`, for the same reason
 * `projects.ts` exists: the owner scoping and the replace semantics hold in one
 * place rather than in each caller.
 */

/** One scene as the project page lists it. */
export type SceneSummary = {
  id: string;
  startMs: number;
  durationMs: number;
  sourceText: string | null;
  visualType: VisualType;
  emotion: CharacterEmotion | null;
  layoutTemplate: LayoutTemplate;
  overlayText: string | null;
  chart: SceneChart | null;
  strength: number | null;
  included: boolean;
  origin: string;
};

/**
 * List a project's scenes, ordered the way they export (AC-42).
 *
 * Owner scoped by construction: the `user_id` predicate is part of the query
 * through the join rather than a check on the result, so there is no code path
 * that reads another user's scenes and then decides what to do about it. The
 * ordering is `start_ms, id`, which the `broll_scenes_project_start_idx` index
 * already serves.
 */
export async function listBrollScenes(
  userId: string,
  projectId: string
): Promise<SceneSummary[]> {
  const rows = await db
    .select({
      id: brollScenes.id,
      startMs: brollScenes.startMs,
      durationMs: brollScenes.durationMs,
      sourceText: brollScenes.sourceText,
      visualType: brollScenes.visualType,
      emotion: brollScenes.emotion,
      layoutTemplate: brollScenes.layoutTemplate,
      overlayText: brollScenes.overlayText,
      chart: brollScenes.chart,
      strength: brollScenes.strength,
      included: brollScenes.included,
      origin: brollScenes.origin,
    })
    .from(brollScenes)
    .innerJoin(brollProjects, eq(brollScenes.brollProjectId, brollProjects.id))
    .where(
      and(eq(brollScenes.brollProjectId, projectId), eq(brollProjects.userId, userId))
    )
    .orderBy(asc(brollScenes.startMs), asc(brollScenes.id));

  return rows.map((row) => ({
    ...row,
    visualType: row.visualType as VisualType,
    emotion: row.emotion as CharacterEmotion | null,
    layoutTemplate: row.layoutTemplate as LayoutTemplate,
    chart: (row.chart as SceneChart | null) ?? null,
  }));
}

/**
 * Replace this project's planner scenes with a new plan — one statement (AC-51).
 *
 * **Why one statement.** A delete followed by an insert leaves a window where
 * the project has no scenes at all, and two concurrent runs interleaving across
 * that window leave a mixture of two plans, which is the one outcome nothing
 * downstream could make sense of. A single statement is atomic in Postgres, so
 * a reader sees either the old plan or the new one and never half of each. That
 * atomicity is also what makes it safe for this route to carry no claim column
 * and no hold (spec `0002`'s explicit decision).
 *
 * **Scenes the user added by hand are never touched.** The delete is scoped to
 * `origin = 'planner'`, so a re-run costs the user their generated scenes and
 * nothing else (AC-51, invariant 4).
 *
 * Returns how many scenes were committed. That count, not the count that
 * validated, is what decides the refund (AC-53) — a charge that lands against a
 * write that failed has bought nothing.
 */
export async function replacePlannerScenes(
  projectId: string,
  scenes: readonly PlannedScene[]
): Promise<number> {
  // An empty plan deliberately leaves the previous one standing. The run is
  // refunded either way (AC-53), and wiping a good plan in exchange for nothing
  // would be the one outcome worse than a failed run.
  if (scenes.length === 0) return 0;

  const values = sql.join(
    scenes.map(
      (scene) => sql`(
        ${projectId}::uuid,
        ${scene.startMs}::integer,
        ${scene.durationMs}::integer,
        ${scene.sourceText}::text,
        ${scene.sourceStartMs}::integer,
        ${scene.sourceEndMs}::integer,
        ${scene.visualType}::text,
        ${scene.emotion}::text,
        ${scene.layoutTemplate}::text,
        ${scene.overlayText}::text,
        ${scene.chart ? JSON.stringify(scene.chart) : null}::jsonb,
        ${scene.strength}::real,
        true,
        'planner'::text
      )`
    ),
    sql`, `
  );

  const result = await db.execute(sql`
    WITH deleted AS (
      DELETE FROM broll_scenes
      WHERE broll_project_id = ${projectId}::uuid AND origin = 'planner'
    ),
    ins AS (
      INSERT INTO broll_scenes (
        broll_project_id, start_ms, duration_ms,
        source_text, source_start_ms, source_end_ms,
        visual_type, emotion, layout_template, overlay_text,
        chart, strength, included, origin
      )
      VALUES ${values}
      RETURNING id
    )
    SELECT count(*)::int AS committed FROM ins
  `);

  const rows = (result as unknown as { rows: { committed?: number }[] }).rows ?? [];
  return Number(rows[0]?.committed ?? 0);
}
