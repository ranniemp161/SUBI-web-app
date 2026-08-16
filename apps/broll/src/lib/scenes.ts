import "server-only";
import { db } from "@repo/db";
import { brollScenes, brollProjects } from "@repo/db/schema";
import { and, asc, eq, sql } from "drizzle-orm";
import {
  MIN_SCENE_DURATION_MS,
  MAX_SCENE_DURATION_MS,
  type SceneChart,
  type VisualType,
  type LayoutTemplate,
} from "./scene-schema";
import type { CharacterEmotion } from "./emotions";
import type { PlannedScene } from "./planner";
import { MAX_OVERLAY_TEXT_CHARS, MAX_MANUAL_SCENES_PER_PROJECT } from "./scene-limits";
import { isCharacterTemplate, visualTypeForTemplate } from "./scene-templates";

/**
 * The one template a scene with no chart and no character set can draw, which
 * is exactly what a hand added scene is at the moment it is created (AC-80).
 * The creator may switch it to anything their project supports afterwards.
 */
const MANUAL_SCENE_TEMPLATE: LayoutTemplate = "text-card";

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
  /** Why the honesty check dropped this scene's chart, or null (AC-87). */
  chartRejectionReason: string | null;
  strength: number | null;
  included: boolean;
  origin: string;
  /** Set on every Scene Studio write, and by nothing else (AC-92). */
  userEditedAt: Date | null;
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
      chartRejectionReason: brollScenes.chartRejectionReason,
      strength: brollScenes.strength,
      included: brollScenes.included,
      origin: brollScenes.origin,
      userEditedAt: brollScenes.userEditedAt,
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
        ${scene.chartRejectionReason}::text,
        ${scene.strength}::real,
        ${scene.included}::boolean,
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
        chart, chart_rejection_reason, strength, included, origin
      )
      VALUES ${values}
      RETURNING id
    )
    SELECT count(*)::int AS committed FROM ins
  `);

  const rows = (result as unknown as { rows: { committed?: number }[] }).rows ?? [];
  return Number(rows[0]?.committed ?? 0);
}

/**
 * The fields Scene Studio may override on a single scene.
 *
 * **A closed list, and that is what enforces AC-78.** `chart`, `start_ms` and
 * `duration_ms` are absent by shape rather than filtered out of a supplied
 * object, so a request naming one cannot reach a column even if a future edit
 * forgets to blocklist it. Presentation is editable; a claim traced back to the
 * transcript is not.
 */
export interface SceneOverride {
  /** Whether the scene is exported. Excluding never deletes it. */
  included?: boolean;
  /** The words burned on screen, or null to show none. */
  overlayText?: string | null;
  /** Which layout to composite into. `visual_type` follows from it (AC-76). */
  layoutTemplate?: LayoutTemplate;
  /** Which character variant, or null. Only on a character template (AC-77). */
  emotion?: CharacterEmotion | null;
}

/** What the route needs to know about a scene before it may write to it. */
export type SceneEditContext = {
  origin: string;
  /** What the row carries now, which an emotion sent alone is judged against. */
  layoutTemplate: LayoutTemplate;
  /** `chart-full` is only offerable while this holds (AC-75). */
  hasChart: boolean;
  /** The emotions actually committed for this project (AC-77). */
  committedEmotions: CharacterEmotion[];
};

/**
 * Read what a scene's own data permits, owner scoped.
 *
 * **This is a read for the answer, never for the authorization.** The write
 * below still proves ownership inside its own statement (AC-91); this exists
 * only so an invalid template can answer 422 while a scene that is not yours
 * answers 404, which one statement cannot distinguish — both return zero rows.
 * A plan re-run landing between the two is the benign case and the one the spec
 * names: the write hits nothing and the route answers 404, which is the truth.
 *
 * **The emotions come from the project's character, not from the project.**
 * Spec `broll/0007` moved an asset's owner one table over, so the subquery
 * matches on `broll_characters.id` through `broll_projects.broll_character_id`.
 * A project with no character attached yields an empty array, which is the same
 * answer it gave before and is what the route reads as "no character set".
 */
export async function getSceneEditContext(
  userId: string,
  projectId: string,
  sceneId: string
): Promise<SceneEditContext | null> {
  const result = await db.execute(sql`
    SELECT
      s.origin AS origin,
      s.layout_template AS layout_template,
      (s.chart IS NOT NULL) AS has_chart,
      coalesce(
        (SELECT array_agg(a.emotion) FROM broll_assets a
          WHERE a.broll_character_id = p.broll_character_id),
        ARRAY[]::text[]
      ) AS emotions
    FROM broll_scenes s
    JOIN broll_projects p ON p.id = s.broll_project_id
    WHERE s.id = ${sceneId}::uuid
      AND s.broll_project_id = ${projectId}::uuid
      AND p.user_id = ${userId}
  `);

  const rows =
    (result as unknown as {
      rows: {
        origin?: string;
        layout_template?: string;
        has_chart?: boolean;
        emotions?: string[];
      }[];
    }).rows ?? [];
  const row = rows[0];
  if (!row) return null;

  return {
    origin: row.origin ?? "planner",
    layoutTemplate: row.layout_template as LayoutTemplate,
    hasChart: Boolean(row.has_chart),
    committedEmotions: (row.emotions ?? []) as CharacterEmotion[],
  };
}

/**
 * Applies a Scene Studio override to one scene.
 *
 * **Owner scoped in the statement, not before it.** The update joins through
 * `broll_projects` and matches on `user_id`, so a caller who passes someone
 * else's scene id changes nothing and gets `false` back. Reading the row first
 * to check ownership and then updating would be two statements racing.
 *
 * Excluding a scene sets a flag; it never deletes. A creator who excludes a
 * scene, re-runs the plan, and finds the scene gone has lost work that looked
 * reversible. `replacePlannerScenes` already keeps manual scenes for the same
 * reason.
 *
 * **Three things move together with a template change, in one `SET`** (AC-93):
 * the template itself, the `visual_type` derived from it, and `emotion` cleared
 * when the new template composites no character. A separate cleanup pass would
 * leave a window where a text card carries an emotion, and every reader would
 * have to cope with it.
 *
 * Returns whether a row actually changed, so a caller can answer 404 rather
 * than reporting a success that did nothing.
 */
export async function updateBrollScene(
  userId: string,
  projectId: string,
  sceneId: string,
  override: SceneOverride
): Promise<boolean> {
  const patch: Record<string, unknown> = {};
  if (override.included !== undefined) patch.included = override.included;
  if (override.overlayText !== undefined) {
    const trimmed = override.overlayText?.trim() ?? "";
    // Empty means "no words on screen", which is null in the column rather than
    // an empty string, so every reader has one absent case to handle.
    patch.overlayText = trimmed === "" ? null : trimmed.slice(0, MAX_OVERLAY_TEXT_CHARS);
  }
  if (override.layoutTemplate !== undefined) {
    patch.layoutTemplate = override.layoutTemplate;
    // Derived here, never read from the request (AC-76).
    patch.visualType = visualTypeForTemplate(override.layoutTemplate);
    // A non character template cannot carry a variant, so the switch clears it
    // in this same `SET` rather than leaving a stale one behind (AC-93).
    if (!isCharacterTemplate(override.layoutTemplate)) patch.emotion = null;
  }
  if (override.emotion !== undefined) patch.emotion = override.emotion;
  if (Object.keys(patch).length === 0) return false;

  // The statement's own clock, not the app's, and set on every Scene Studio
  // write (AC-92). Nothing else in this app writes this column: the re-run
  // warning counts it, and a second writer would make that count a guess.
  patch.userEditedAt = sql`now()`;
  patch.updatedAt = new Date();

  const updated = await db
    .update(brollScenes)
    .set(patch)
    .where(
      and(
        eq(brollScenes.id, sceneId),
        eq(brollScenes.brollProjectId, projectId),
        sql`EXISTS (
          SELECT 1 FROM ${brollProjects}
          WHERE ${brollProjects.id} = ${projectId}
            AND ${brollProjects.userId} = ${userId}
        )`
      )
    )
    .returning({ id: brollScenes.id });

  return updated.length > 0;
}

/** A scene the creator added by hand, as the list needs it back. */
export type CreatedScene = {
  id: string;
  startMs: number;
  durationMs: number;
};

/**
 * The length a hand added scene starts at: the middle of the window every scene
 * lives in (spec `0005`, Value sourcing).
 *
 * Derived from the two constants rather than written as a number, so the day
 * the window moves this moves with it. The midpoint has no evidence behind it
 * and needs none: it is a starting value on a field the creator can see, not a
 * measurement.
 */
export const MANUAL_SCENE_DURATION_MS = Math.round(
  (MIN_SCENE_DURATION_MS + MAX_SCENE_DURATION_MS) / 2
);

/**
 * Add a scene at a transcript segment the creator picked (AC-79, AC-80, AC-82).
 *
 * **Everything that decides whether this row may exist is in the one statement
 * that writes it.** Ownership is proved by selecting from `broll_projects`
 * rather than by reading it first (AC-91), and the manual scene count is a
 * subquery of the same insert rather than a separate read (AC-82). The insert
 * writes no rows when either fails, so a caller cannot act on a stale yes.
 *
 * Worth being exact about what the count buys, because the honest version is
 * narrower than "impossible": under Postgres' default read committed
 * isolation, two inserts that overlap inside a single statement's execution can
 * both see the same count. What this closes is every race longer than one
 * statement, which is the shape a double click and a retried request actually
 * take. The Neon HTTP driver runs each statement in its own transaction, so
 * there is no wider transaction to serialize them in, and a lost race here
 * costs one extra row on a path that spends nothing.
 *
 * The four planner columns are left unwritten, so they are NULL exactly when
 * `origin = 'manual'` — spec `0002`'s invariant, unchanged (AC-79).
 */
export async function createManualScene(
  userId: string,
  projectId: string,
  input: { startMs: number; overlayText: string }
): Promise<CreatedScene | "at_cap" | null> {
  const result = await db.execute(sql`
    INSERT INTO broll_scenes (
      broll_project_id, start_ms, duration_ms,
      visual_type, layout_template, overlay_text,
      included, origin, user_edited_at
    )
    SELECT
      p.id,
      ${input.startMs}::integer,
      ${MANUAL_SCENE_DURATION_MS}::integer,
      ${visualTypeForTemplate(MANUAL_SCENE_TEMPLATE)}::text,
      ${MANUAL_SCENE_TEMPLATE}::text,
      ${input.overlayText}::text,
      true,
      'manual'::text,
      now()
    FROM broll_projects p
    WHERE p.id = ${projectId}::uuid
      AND p.user_id = ${userId}
      AND (
        SELECT count(*) FROM broll_scenes s
        WHERE s.broll_project_id = p.id AND s.origin = 'manual'
      ) < ${MAX_MANUAL_SCENES_PER_PROJECT}
    RETURNING id, start_ms AS "startMs", duration_ms AS "durationMs"
  `);

  const rows =
    (result as unknown as {
      rows: { id?: string; startMs?: number; durationMs?: number }[];
    }).rows ?? [];
  const row = rows[0];
  if (row?.id) {
    return {
      id: row.id,
      startMs: Number(row.startMs),
      durationMs: Number(row.durationMs),
    };
  }

  // No row: either the project is not this user's, or the cap is reached. One
  // extra owner scoped count tells the two apart, which the caller needs to
  // answer 409 rather than 404. It runs only on the failure path, so the happy
  // path stays one statement.
  return (await manualSceneCount(userId, projectId)) >= MAX_MANUAL_SCENES_PER_PROJECT
    ? "at_cap"
    : null;
}

/** How many scenes this project has added by hand, owner scoped. */
export async function manualSceneCount(userId: string, projectId: string): Promise<number> {
  const rows = await db
    .select({ manual: sql<number>`count(*)::int` })
    .from(brollScenes)
    .innerJoin(brollProjects, eq(brollScenes.brollProjectId, brollProjects.id))
    .where(
      and(
        eq(brollScenes.brollProjectId, projectId),
        eq(brollProjects.userId, userId),
        eq(brollScenes.origin, "manual")
      )
    );

  return Number(rows[0]?.manual ?? 0);
}

/**
 * Delete a scene the creator added by hand (AC-81).
 *
 * **A planner scene is not deletable, and the restriction is in the `WHERE`.**
 * Excluding one is the reversible answer and always available; deleting one
 * would destroy a row a re-run is going to rewrite anyway. Ownership is proved
 * in this same statement, so a planner scene, another user's scene and a scene
 * that never existed are one outcome here and one answer to the caller.
 */
export async function deleteBrollScene(
  userId: string,
  projectId: string,
  sceneId: string
): Promise<boolean> {
  const deleted = await db
    .delete(brollScenes)
    .where(
      and(
        eq(brollScenes.id, sceneId),
        eq(brollScenes.brollProjectId, projectId),
        eq(brollScenes.origin, "manual"),
        sql`EXISTS (
          SELECT 1 FROM ${brollProjects}
          WHERE ${brollProjects.id} = ${projectId}
            AND ${brollProjects.userId} = ${userId}
        )`
      )
    )
    .returning({ id: brollScenes.id });

  return deleted.length > 0;
}
