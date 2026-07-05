import { sql } from "drizzle-orm";
import { db } from "@/db";
import { reportError } from "@/lib/observability";

/**
 * Credit operations. 1 credit = 1 second of transcription audio.
 *
 * The ledger (credit_ledger) is the source of truth; users.credit_seconds is
 * a cache of SUM(delta_seconds). The neon-http driver has no transactions, so
 * every mutation here is a single CTE-pipeline statement (same philosophy as
 * lib/rate-limit.ts): all of it commits or none of it does.
 *
 * Concurrency rests on the users_credit_seconds_nonneg CHECK constraint —
 * deliberately, no `credit_seconds >= cost` qual appears in any UPDATE.
 * Concurrent spends serialize on the users row; whichever statement would
 * overdraft raises 23514 and rolls back in its entirety, earlier CTEs
 * (e.g. the project hold) included.
 */

/** Seconds held when the project has no client-reported duration. */
export const FALLBACK_HOLD_SECONDS = 60;

/**
 * Estimated real-world cost, in USD micros per second (1,000,000 = $1), used
 * to populate credit_ledger.cost_micros for margin visibility — not billed
 * to the user, who's charged in credit-seconds regardless.
 *
 * TRANSCRIPTION is the blended Deepgram + Gemini rough-cut estimate
 * ($0.083/min ÷ 60). AI_CUT is the Gemini-only portion for an on-demand
 * re-run (no Deepgram call), estimated at ~88% of the blended rate per the
 * cost breakdown that set these numbers — refine both once real
 * `cost_micros` data accumulates.
 */
export const TRANSCRIPTION_COST_MICROS_PER_SECOND = 1383;
export const AI_CUT_COST_MICROS_PER_SECOND = 1217;

/**
 * How long a hold must sit untouched — and not "processing" — before it's
 * treated as abandoned by a crashed request, rather than one genuinely still
 * mid-flight between reserving and flipping status to "processing". That
 * window is pure in-memory work (URL/token building, no I/O), so it's over in
 * low single-digit milliseconds; this is deliberately generous to survive any
 * GC pause or cold-start jitter while still recovering promptly from a real
 * crash. See reclaimStaleHold.
 */
export const STALE_HOLD_MS = 10_000;

/** Seconds to reserve for a job, from the client-reported duration. */
export function costSecondsForDurationMs(
  durationMs: number | null | undefined
): number {
  if (durationMs == null || !Number.isFinite(durationMs) || durationMs <= 0) {
    return FALLBACK_HOLD_SECONDS;
  }
  return Math.max(1, Math.ceil(durationMs / 1000));
}

/**
 * Billable seconds from Deepgram's authoritative `metadata.duration`, or null
 * when the payload doesn't carry one (null tells settleHold to keep the hold
 * as the final charge — a job that ran is never spuriously refunded).
 */
export function secondsFromDeepgramDuration(
  duration: number | null | undefined
): number | null {
  if (duration == null || !Number.isFinite(duration) || duration <= 0) return null;
  return Math.max(1, Math.ceil(duration));
}

/** UTC calendar-month key for grant rows, e.g. "2026-07". */
export function currentMonthKey(now = new Date()): string {
  return now.toISOString().slice(0, 7);
}

/** Monthly member grant from MEMBER_MONTHLY_GRANT_SECONDS, default 3600. */
export function memberGrantSeconds(): number {
  const n = Number(process.env.MEMBER_MONTHLY_GRANT_SECONDS);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 3600;
}

/** True when the error (or anything in its cause chain) is a CHECK violation. */
function isCheckViolation(err: unknown): boolean {
  let e: unknown = err;
  // The Neon driver nests errors — walk the chain like isRetryable in db/index.ts.
  for (let i = 0; i < 6 && e; i++) {
    if ((e as { code?: unknown })?.code === "23514") return true;
    e =
      (e as { cause?: unknown })?.cause ??
      (e as { sourceError?: unknown })?.sourceError;
  }
  return false;
}

type Row = Record<string, unknown>;

async function executeRows(query: ReturnType<typeof sql>): Promise<Row[]> {
  const result = await db.execute(query);
  return (result as unknown as { rows: Row[] }).rows ?? [];
}

export type ReserveResult =
  | { status: "reserved"; balance: number }
  | { status: "insufficient" }
  | { status: "already_held" };

/**
 * Reserve `costSeconds` for a transcription job: set the project's hold,
 * charge the balance, and write the ledger row — one statement.
 *
 * The hold UPDATE's `credit_hold_seconds IS NULL` qual is the double-kickoff
 * gate: a concurrent second call matches zero rows and gets `already_held`.
 * An overdraft trips the CHECK (23514) and rolls the whole statement back,
 * hold included → `insufficient`.
 */
export async function reserveCredits(
  userId: string,
  projectId: string,
  costSeconds: number
): Promise<ReserveResult> {
  try {
    const [row] = await executeRows(sql`
      WITH hold AS (
        UPDATE projects SET credit_hold_seconds = ${costSeconds}, updated_at = now()
        WHERE id = ${projectId} AND user_id = ${userId} AND credit_hold_seconds IS NULL
        RETURNING user_id
      ),
      charged AS (
        UPDATE users u SET credit_seconds = u.credit_seconds - ${costSeconds}
        FROM hold WHERE u.id = hold.user_id
        RETURNING u.credit_seconds
      ),
      led AS (
        INSERT INTO credit_ledger (user_id, delta_seconds, reason, project_id, cost_micros)
        SELECT user_id, ${-costSeconds}, 'transcription', ${projectId},
               ${costSeconds * TRANSCRIPTION_COST_MICROS_PER_SECOND}
        FROM hold
      )
      SELECT (SELECT count(*)::int FROM hold) AS held,
             (SELECT credit_seconds FROM charged) AS balance
    `);

    if (!row || Number(row.held) === 0) return { status: "already_held" };
    return { status: "reserved", balance: Number(row.balance) };
  } catch (error) {
    if (isCheckViolation(error)) return { status: "insufficient" };
    throw error;
  }
}

/**
 * Reclaim (fully refund) a hold that looks abandoned — the project isn't
 * "processing" AND the hold has sat untouched past `staleAfterMs`. Use this
 * before retrying a reserve that came back `already_held`, instead of
 * trusting an application-level snapshot of transcriptStatus: a snapshot
 * taken before the reserve attempt can't tell "crashed" apart from "a
 * concurrent request just reserved and hasn't written 'processing' yet",
 * because both look identical to a stale read. This function checks and
 * clears the hold in one statement, against the database's own current state
 * and clock, so a hold a live request set a moment ago is never mistaken for
 * abandoned and stolen out from under it.
 *
 * Returns true if a hold was reclaimed (safe to retry the reserve).
 */
export async function reclaimStaleHold(
  projectId: string,
  staleAfterMs: number
): Promise<boolean> {
  const [row] = await executeRows(sql`
    WITH prev AS (
      SELECT id, user_id, credit_hold_seconds AS held
      FROM projects
      WHERE id = ${projectId}
        AND credit_hold_seconds IS NOT NULL
        AND transcript_status <> 'processing'
        AND updated_at < now() - (interval '1 millisecond' * ${staleAfterMs})
    ),
    hold AS (
      UPDATE projects p SET credit_hold_seconds = NULL, updated_at = now()
      FROM prev
      WHERE p.id = prev.id
        AND p.credit_hold_seconds IS NOT NULL
        AND p.transcript_status <> 'processing'
        AND p.updated_at < now() - (interval '1 millisecond' * ${staleAfterMs})
      RETURNING prev.user_id, prev.held
    ),
    led AS (
      INSERT INTO credit_ledger (user_id, delta_seconds, reason, project_id, cost_micros)
      SELECT user_id, held, 'refund', ${projectId}, held * ${TRANSCRIPTION_COST_MICROS_PER_SECOND}
      FROM hold WHERE held <> 0
      RETURNING user_id, delta_seconds
    ),
    bal AS (
      UPDATE users u SET credit_seconds = u.credit_seconds + led.delta_seconds
      FROM led WHERE u.id = led.user_id
    )
    SELECT (SELECT count(*)::int FROM hold) AS reclaimed
  `);

  const reclaimed = Number(row?.reclaimed ?? 0) > 0;
  if (reclaimed) {
    console.warn(`Reclaimed an abandoned credit hold on project ${projectId}.`);
  }
  return reclaimed;
}

/**
 * Clear the project's hold and true it up against the seconds actually billed:
 * - `actualSeconds = 0`    → full refund (job failed / never ran)
 * - `actualSeconds = n`    → refund the excess, or charge the shortfall
 *                            (clamped at balance 0 — see below)
 * - `actualSeconds = null` → keep the hold as the final charge (duration missing)
 *
 * Exactly-once across Deepgram callback retries and racing failure paths:
 * only the call that flips credit_hold_seconds to NULL produces ledger and
 * balance effects; every later call matches zero rows and no-ops.
 *
 * The shortfall clamp (LEAST(shortfall, balance)) keeps the ledger consistent
 * with the CHECK-constrained cache; when it engages — a spoofed/underreported
 * client duration met a near-empty balance — the loss is reported to Sentry.
 */
export async function settleHold(
  projectId: string,
  actualSeconds: number | null
): Promise<void> {
  // `prev` snapshots the hold before the UPDATE nulls it — RETURNING yields
  // *new* column values, so reading the hold there would always give NULL.
  // Exactly-once still rests on the UPDATE's re-checked qual: of two racing
  // settles, the loser re-evaluates `IS NOT NULL` on the updated row, matches
  // nothing, and every downstream CTE is empty.
  const [row] = await executeRows(sql`
    WITH prev AS (
      SELECT id, user_id, credit_hold_seconds AS held
      FROM projects
      WHERE id = ${projectId} AND credit_hold_seconds IS NOT NULL
    ),
    hold AS (
      UPDATE projects p SET credit_hold_seconds = NULL, updated_at = now()
      FROM prev
      WHERE p.id = prev.id AND p.credit_hold_seconds IS NOT NULL
      RETURNING prev.user_id, prev.held
    ),
    adj AS (
      SELECT h.user_id, h.held,
             CASE
               WHEN ${actualSeconds}::int IS NULL THEN 0
               WHEN ${actualSeconds}::int >= h.held
                 THEN -LEAST(${actualSeconds}::int - h.held, u.credit_seconds)
               ELSE h.held - ${actualSeconds}::int
             END AS delta
      FROM hold h JOIN users u ON u.id = h.user_id
    ),
    led AS (
      INSERT INTO credit_ledger (user_id, delta_seconds, reason, project_id, cost_micros)
      SELECT user_id, delta,
             (CASE WHEN delta < 0 THEN 'transcription' ELSE 'refund' END)::credit_ledger_reason,
             ${projectId},
             delta * ${TRANSCRIPTION_COST_MICROS_PER_SECOND}
      FROM adj WHERE delta <> 0
      RETURNING user_id, delta_seconds
    ),
    bal AS (
      UPDATE users u SET credit_seconds = u.credit_seconds + led.delta_seconds
      FROM led WHERE u.id = led.user_id
    )
    SELECT (SELECT held FROM adj) AS held, (SELECT delta FROM adj) AS delta
  `);

  // No row / null held ⇒ nothing was settled (already settled earlier) — fine.
  if (row?.held == null || actualSeconds == null) return;

  const held = Number(row.held);
  const delta = Number(row.delta);
  const shortfall = actualSeconds - held;
  if (shortfall > 0 && -delta < shortfall) {
    reportError(
      "Credit reconciliation shortfall clamped at zero balance",
      new Error("credit shortfall clamped"),
      { projectId, held, actualSeconds, charged: -delta, uncollected: shortfall + delta }
    );
  }
}

/**
 * Credit a Stripe purchase, idempotently keyed on the Checkout session id.
 * Returns false on a duplicate delivery (webhook retry) — no double credit.
 */
export async function depositPurchase(
  userId: string,
  seconds: number,
  stripeEventId: string
): Promise<boolean> {
  const rows = await executeRows(sql`
    WITH ins AS (
      INSERT INTO credit_ledger (user_id, delta_seconds, reason, stripe_event_id)
      VALUES (${userId}, ${seconds}, 'purchase', ${stripeEventId})
      ON CONFLICT (stripe_event_id) DO NOTHING
      RETURNING user_id, delta_seconds
    )
    UPDATE users u SET credit_seconds = u.credit_seconds + ins.delta_seconds
    FROM ins WHERE u.id = ins.user_id
    RETURNING u.credit_seconds
  `);
  return rows.length > 0;
}

export type AiCutChargeResult =
  | { status: "charged" }
  | { status: "insufficient" };

/**
 * Charge `costSeconds` for an on-demand AI Cut (re-)run — a single eager
 * deduction, unlike reserveCredits' hold/settle pair, since this is one
 * synchronous Gemini call rather than an async job. Same CHECK-constraint
 * mechanism guards against overdraft.
 *
 * Only on-demand re-runs are charged here; the automatic first pass right
 * after transcription is already priced into the original per-second
 * transcription hold (see reserveCredits) — charging both would double-bill.
 */
export async function chargeAiCut(
  userId: string,
  projectId: string,
  costSeconds: number
): Promise<AiCutChargeResult> {
  try {
    const rows = await executeRows(sql`
      WITH charged AS (
        UPDATE users SET credit_seconds = credit_seconds - ${costSeconds}
        WHERE id = ${userId}
        RETURNING credit_seconds
      ),
      led AS (
        INSERT INTO credit_ledger (user_id, delta_seconds, reason, project_id, cost_micros)
        SELECT ${userId}, ${-costSeconds}, 'ai_cut', ${projectId},
               ${costSeconds * AI_CUT_COST_MICROS_PER_SECOND}
        FROM charged
      )
      SELECT credit_seconds FROM charged
    `);
    if (rows.length === 0) throw new Error("ai_cut charge matched no user row");
    return { status: "charged" };
  } catch (error) {
    if (isCheckViolation(error)) return { status: "insufficient" };
    throw error;
  }
}

/**
 * Refund an AI Cut charge that didn't deliver a usable result (Gemini call
 * failed, or the transcript tripped the size guard) — a straight credit-back,
 * no hold to reconcile against.
 */
export async function refundAiCut(
  userId: string,
  projectId: string,
  costSeconds: number
): Promise<void> {
  await executeRows(sql`
    WITH led AS (
      INSERT INTO credit_ledger (user_id, delta_seconds, reason, project_id, cost_micros)
      VALUES (${userId}, ${costSeconds}, 'refund', ${projectId},
              ${costSeconds * AI_CUT_COST_MICROS_PER_SECOND})
    )
    UPDATE users SET credit_seconds = credit_seconds + ${costSeconds}
    WHERE id = ${userId}
  `);
}

/**
 * Lazy monthly grant: deposits `grantSeconds` once per UTC calendar month for
 * members; a no-op for non-members and already-granted months. Race-safe via
 * the partial unique index credit_ledger_grant_month_uq — of two concurrent
 * calls, one inserts and the other conflicts into a no-op.
 */
export async function ensureMonthlyGrant(
  userId: string,
  grantSeconds: number
): Promise<void> {
  if (grantSeconds <= 0) return;
  await executeRows(sql`
    WITH ins AS (
      INSERT INTO credit_ledger (user_id, delta_seconds, reason, month_key)
      SELECT id, ${grantSeconds}, 'grant', ${currentMonthKey()}
      FROM users WHERE id = ${userId} AND is_member
      ON CONFLICT (user_id, month_key) WHERE reason = 'grant' DO NOTHING
      RETURNING user_id, delta_seconds
    )
    UPDATE users u SET credit_seconds = u.credit_seconds + ins.delta_seconds
    FROM ins WHERE u.id = ins.user_id
  `);
}
