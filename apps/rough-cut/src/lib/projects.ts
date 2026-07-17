import { sql, eq, and } from "drizzle-orm";
import { db, withDbRetry } from "@repo/db";
import { projects, users } from "@repo/db/schema";
import type { AiCutRange, AiCutRun } from "@/lib/ai-cuts";

/**
 * Get a project and verify ownership.
 * Returns the project if the authenticated user owns it, null otherwise.
 */
export async function getOwnedProject(projectId: string, clerkId: string) {
  const result = await withDbRetry(() =>
    db
      .select({
        project: projects,
        user: users,
      })
      .from(projects)
      .innerJoin(users, eq(projects.userId, users.id))
      .where(and(eq(projects.id, projectId), eq(users.clerkId, clerkId)))
      .limit(1)
  );

  return result.length > 0 ? result[0].project : null;
}

/**
 * A claimed-but-unfinished AI Cut run is treated as abandoned (the request
 * that held it crashed or timed out) once it's older than this, and can be
 * reclaimed. Gemini is capped at 240s server-side (ai-rough-cut.ts) inside a
 * 300s function timeout (ai-cut/route.ts maxDuration) — this sits
 * comfortably above both so a live run is never reclaimed out from under it.
 */
export const AI_CUT_CLAIM_STALE_MS = 360_000;

/** A project holds at most this many stored AI Cut runs at once (ADR 0002-ai-cut-paid-rerun). */
export const AI_CUT_RUN_LIMIT = 3;

type Row = Record<string, unknown>;

async function executeRows(query: ReturnType<typeof sql>): Promise<Row[]> {
  const result = await db.execute(query);
  return (result as unknown as { rows: Row[] }).rows ?? [];
}

function toAiCutRun(row: Row): AiCutRun {
  return {
    id: row.id as string,
    runNumber: row.runNumber as number,
    name: (row.name as string | null) ?? null,
    ranges: row.ranges as AiCutRange[],
    model: row.model as string,
    createdAt: new Date(row.createdAt as string).toISOString(),
  };
}

/**
 * Atomically claim the right to run AI Cut on this project. A plain
 * read-then-write (read the claim, see it's empty, then charge and write) has
 * a TOCTOU window: two POSTs reading the same empty claim a moment apart both
 * pass the guard and both charge. This single conditional UPDATE flips
 * `ai_cut_claim_at` from null (or stale) to now() only when no other request
 * already holds the claim — a losing concurrent call matches zero rows and
 * gets `false`, the same shape as `reserveCredits`' `hold_micros IS NULL` gate
 * in lib/credits.ts. A claim older than AI_CUT_CLAIM_STALE_MS is treated as
 * abandoned and can be reclaimed.
 *
 * The claim is decoupled from the stored runs (ADR 0002-ai-cut-paid-rerun):
 * it protects concurrent create requests only, independent of how many runs
 * are stored or which one is active.
 *
 * The same UPDATE also clears `ai_polish_requested` (ADR 0003 child 1): the one
 * caller that wins the claim always consumes the auto-fire flag in the same
 * atomic statement, whether the request came from the studio's automatic chain
 * or a later manual "Polish with AI" click. Setting false to false is a no-op
 * on a project that never requested polish, and correct on one that did — so
 * exactly one automatic AI attempt can ever fire per project, even if the run
 * that follows the claim later fails or is refunded.
 */
export async function claimAiCutSlot(
  projectId: string,
  userId: string
): Promise<boolean> {
  const [row] = await executeRows(sql`
    UPDATE projects
    SET ai_cut_claim_at = now(), ai_polish_requested = false
    WHERE id = ${projectId}
      AND user_id = ${userId}
      AND (
        ai_cut_claim_at IS NULL
        OR ai_cut_claim_at < now() - (interval '1 millisecond' * ${AI_CUT_CLAIM_STALE_MS})
      )
    RETURNING id
  `);
  return Boolean(row);
}

/**
 * Release a held claim back to idle, so the project can be claimed again —
 * called on any failure after a successful claimAiCutSlot (cap check, charge
 * declined, Gemini error, size guard, unexpected exception), and as the last
 * step of a successful create (createAiCutRun clears it itself). A safe no-op
 * once the claim is already cleared.
 */
export async function releaseAiCutClaim(projectId: string): Promise<void> {
  await executeRows(sql`
    UPDATE projects
    SET ai_cut_claim_at = NULL
    WHERE id = ${projectId} AND ai_cut_claim_at IS NOT NULL
  `);
}

/** How many AI Cut runs are currently stored for this project (AC-2's cap check). */
export async function countAiCutRuns(projectId: string): Promise<number> {
  const [row] = await executeRows(sql`
    SELECT count(*)::int AS count FROM ai_cut_runs WHERE project_id = ${projectId}
  `);
  return (row?.count as number) ?? 0;
}

/** All stored runs for a project, oldest first — what the client lists to compare/switch. */
export async function listAiCutRuns(projectId: string): Promise<AiCutRun[]> {
  const rows = await executeRows(sql`
    SELECT id, run_number AS "runNumber", name, ranges, model, created_at AS "createdAt"
    FROM ai_cut_runs
    WHERE project_id = ${projectId}
    ORDER BY run_number ASC
  `);
  return rows.map(toAiCutRun);
}

/** A single run, scoped to the project it must belong to — never a cross-project lookup. */
export async function getAiCutRun(
  runId: string,
  projectId: string
): Promise<AiCutRun | null> {
  const [row] = await executeRows(sql`
    SELECT id, run_number AS "runNumber", name, ranges, model, created_at AS "createdAt"
    FROM ai_cut_runs
    WHERE id = ${runId} AND project_id = ${projectId}
  `);
  return row ? toAiCutRun(row) : null;
}

/**
 * Insert a new run at the next contiguous run_number, make it the active run,
 * and release the claim — all one statement, matching the Neon HTTP driver's
 * single-statement-atomicity discipline used elsewhere in this file. Assumes
 * the caller already holds the claim (claimAiCutSlot) and checked the run cap
 * (countAiCutRuns), so no concurrent create for this project can be racing.
 */
export async function createAiCutRun(
  projectId: string,
  ranges: AiCutRange[],
  model: string
): Promise<AiCutRun> {
  const [row] = await executeRows(sql`
    WITH next_run AS (
      SELECT COALESCE(MAX(run_number), 0) + 1 AS n
      FROM ai_cut_runs WHERE project_id = ${projectId}
    ),
    ins AS (
      INSERT INTO ai_cut_runs (project_id, run_number, ranges, model)
      SELECT ${projectId}, n, ${JSON.stringify(ranges)}::jsonb, ${model}
      FROM next_run
      RETURNING id, run_number, name, ranges, model, created_at
    )
    UPDATE projects
    SET active_ai_cut_run_id = ins.id, ai_cut_claim_at = NULL, updated_at = now()
    FROM ins
    WHERE projects.id = ${projectId}
    RETURNING ins.id AS id, ins.run_number AS "runNumber", ins.name AS name, ins.ranges AS ranges,
      ins.model AS model, ins.created_at AS "createdAt"
  `);
  return toAiCutRun(row);
}

/**
 * Switch which stored run is active (AC-3). Only succeeds if `runId` belongs
 * to `projectId` — returns null otherwise, which the route maps to 404 rather
 * than leaking whether the run id exists on another project.
 */
export async function setActiveAiCutRun(
  projectId: string,
  runId: string
): Promise<AiCutRun | null> {
  const [row] = await executeRows(sql`
    WITH target AS (
      SELECT id, run_number, name, ranges, model, created_at
      FROM ai_cut_runs WHERE id = ${runId} AND project_id = ${projectId}
    ),
    upd AS (
      UPDATE projects
      SET active_ai_cut_run_id = (SELECT id FROM target), updated_at = now()
      WHERE id = ${projectId} AND EXISTS (SELECT 1 FROM target)
      RETURNING id
    )
    SELECT t.id AS id, t.run_number AS "runNumber", t.name AS name, t.ranges AS ranges,
      t.model AS model, t.created_at AS "createdAt"
    FROM target t JOIN upd ON true
  `);
  return row ? toAiCutRun(row) : null;
}

/**
 * Delete a non-active stored run and renumber the rest contiguously (no gaps
 * left behind). The caller must already have confirmed the run isn't the
 * active one (AC-4) — this just removes the row and closes the gap.
 */
export async function deleteAiCutRunAndRenumber(
  projectId: string,
  runId: string
): Promise<void> {
  await executeRows(sql`
    DELETE FROM ai_cut_runs WHERE id = ${runId} AND project_id = ${projectId}
  `);
  await executeRows(sql`
    UPDATE ai_cut_runs
    SET run_number = sub.new_number
    FROM (
      SELECT id, ROW_NUMBER() OVER (ORDER BY run_number) AS new_number
      FROM ai_cut_runs WHERE project_id = ${projectId}
    ) sub
    WHERE ai_cut_runs.id = sub.id AND ai_cut_runs.run_number != sub.new_number
  `);
}

/** Rename a stored run. Returns the updated run if found and owned, otherwise null. */
export async function renameAiCutRun(
  projectId: string,
  runId: string,
  name: string | null
): Promise<AiCutRun | null> {
  const [row] = await executeRows(sql`
    UPDATE ai_cut_runs
    SET name = ${name}
    WHERE id = ${runId} AND project_id = ${projectId}
    RETURNING id, run_number AS "runNumber", name, ranges, model, created_at AS "createdAt"
  `);
  return row ? toAiCutRun(row) : null;
}

