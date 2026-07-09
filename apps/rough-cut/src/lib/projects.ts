import { sql, eq, and } from "drizzle-orm";
import { db, withDbRetry } from "@repo/db";
import { projects, users } from "@repo/db/schema";
import type { AiCuts } from "@/lib/ai-cuts";

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
 * Fetch only a project's transcript status, verifying ownership — for the
 * dashboard's status poll, which shouldn't pull the whole transcript + EDL
 * jsonb every few seconds just to read one field. Returns null if the project
 * doesn't exist or isn't owned by the caller.
 */
export async function getOwnedProjectStatus(projectId: string, clerkId: string) {
  const result = await withDbRetry(() =>
    db
      .select({ transcriptStatus: projects.transcriptStatus })
      .from(projects)
      .innerJoin(users, eq(projects.userId, users.id))
      .where(and(eq(projects.id, projectId), eq(users.clerkId, clerkId)))
      .limit(1)
  );

  return result.length > 0 ? result[0].transcriptStatus : null;
}

/**
 * A claimed-but-unfinished AI Cut run is treated as abandoned (the request
 * that held it crashed or timed out) once it's older than this, and can be
 * reclaimed. Gemini is capped at 240s server-side (ai-rough-cut.ts) inside a
 * 300s function timeout (ai-cut/route.ts maxDuration) — this sits
 * comfortably above both so a live run is never reclaimed out from under it.
 */
export const AI_CUT_CLAIM_STALE_MS = 360_000;

/** Sentinel `AiCuts` value marking a project's AI Cut slot as claimed and in flight. */
const AI_CUT_PENDING_MODEL = "__pending__";

type Row = Record<string, unknown>;

async function executeRows(query: ReturnType<typeof sql>): Promise<Row[]> {
  const result = await db.execute(query);
  return (result as unknown as { rows: Row[] }).rows ?? [];
}

/**
 * Atomically claim the right to run AI Cut on this project. A plain
 * read-then-write (read `aiCuts`, see it's empty, then charge and write) has
 * a TOCTOU window: two POSTs reading the same empty `aiCuts` a moment apart
 * both pass the guard and both charge. This single conditional UPDATE flips
 * `ai_cuts` from "empty" to a pending marker only when no other request
 * already holds the claim — a losing concurrent call matches zero rows and
 * gets `false`, the same shape as `reserveCredits`' `hold_micros IS NULL`
 * gate in lib/credits.ts. A claim older than AI_CUT_CLAIM_STALE_MS is treated
 * as abandoned and can be reclaimed.
 *
 * The marker is a valid `AiCuts` shape (`ranges: []`, a sentinel `model`) so
 * every existing reader (hasAiCuts, applyAiCuts) sees it as "no cuts yet"
 * rather than crashing on an unexpected shape.
 */
export async function claimAiCutSlot(
  projectId: string,
  userId: string
): Promise<boolean> {
  const marker: AiCuts = {
    ranges: [],
    model: AI_CUT_PENDING_MODEL,
    createdAt: new Date().toISOString(),
  };
  const [row] = await executeRows(sql`
    UPDATE projects
    SET ai_cuts = ${JSON.stringify(marker)}::jsonb, updated_at = now()
    WHERE id = ${projectId}
      AND user_id = ${userId}
      AND (
        ai_cuts IS NULL
        OR (
          (ai_cuts->'ranges') = '[]'::jsonb
          AND (ai_cuts->>'model') IS DISTINCT FROM ${AI_CUT_PENDING_MODEL}
        )
        OR (
          (ai_cuts->>'model') = ${AI_CUT_PENDING_MODEL}
          AND (ai_cuts->>'createdAt')::timestamptz
            < now() - (interval '1 millisecond' * ${AI_CUT_CLAIM_STALE_MS})
        )
      )
    RETURNING id
  `);
  return Boolean(row);
}

/**
 * Release a held claim back to empty, so the project can be claimed again —
 * called on any failure after a successful claimAiCutSlot (charge declined,
 * Gemini error, size guard, unexpected exception). Only clears a claim this
 * call actually still owns (`model = "__pending__"`): if the run already
 * finished and wrote a real result, or a stale-reclaim already replaced this
 * claim, the WHERE clause matches nothing and the call is a safe no-op.
 */
export async function releaseAiCutClaim(projectId: string): Promise<void> {
  await executeRows(sql`
    UPDATE projects
    SET ai_cuts = NULL, updated_at = now()
    WHERE id = ${projectId} AND (ai_cuts->>'model') = ${AI_CUT_PENDING_MODEL}
  `);
}
