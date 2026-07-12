import { sql } from "drizzle-orm";
import { db } from "@repo/db";
import { RETAIL_MICROS_PER_MINUTE as DEFAULT_RETAIL_MICROS_PER_MINUTE } from "@repo/ui";
import { reportError } from "@/lib/observability";

/**
 * Credit operations. The balance is real money in USD micros (1,000,000 = $1).
 *
 * The ledger (credit_ledger) is the source of truth; users.balance_micros is
 * a cache of SUM(delta_micros). The neon-http driver has no transactions, so
 * every mutation here is a single CTE-pipeline statement (same philosophy as
 * lib/rate-limit.ts): all of it commits or none of it does.
 *
 * Concurrency rests on the users_balance_micros_nonneg CHECK constraint —
 * deliberately, no `balance_micros >= cost` qual appears in any UPDATE.
 * Concurrent spends serialize on the users row; whichever statement would
 * overdraft raises 23514 and rolls back in its entirety, earlier CTEs
 * (e.g. the project hold) included.
 *
 * Metering is unchanged in spirit: the library still computes billable seconds
 * exactly as before (client duration for the hold, Deepgram metadata.duration
 * for the settle); only the final step multiplies those seconds into USD micros
 * at the retail rate (chargeMicrosForSeconds) before touching the ledger.
 */

/** Seconds held when the project has no client-reported duration. */
export const FALLBACK_HOLD_SECONDS = 60;

/**
 * Estimated real-world cost, in USD micros per second (1,000,000 = $1), used
 * to populate credit_ledger.cost_micros for margin visibility — this is our
 * cost, not the retail price the user is charged (that is delta_micros).
 *
 * TRANSCRIPTION is Deepgram-only: the AI pass no longer runs automatically
 * at transcription time (it's strictly opt-in from the studio, charged via
 * AI_CUT), so its cost lives entirely on the ai_cut ledger rows. The two
 * values are the split of the original blended $0.083/min estimate — refine
 * both once real `cost_micros` data accumulates.
 */
export const TRANSCRIPTION_COST_MICROS_PER_SECOND = 166;
export const AI_CUT_COST_MICROS_PER_SECOND = 1217;

/**
 * Retail rate: USD micros per minute of service, from the RETAIL_MICROS_PER_MINUTE
 * env var (so the client can retune pricing without a redeploy), defaulting to
 * the shared constant in @repo/ui ($19 buys ~60 min). Prices are config, not code.
 */
export const RETAIL_MICROS_PER_MINUTE =
  Number(process.env.RETAIL_MICROS_PER_MINUTE) ||
  DEFAULT_RETAIL_MICROS_PER_MINUTE;

/** USD micros to charge for a number of billable seconds, at the retail rate. */
export function chargeMicrosForSeconds(seconds: number): number {
  return Math.round((seconds * RETAIL_MICROS_PER_MINUTE) / 60);
}

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

/** Monthly member grant in seconds, from MEMBER_MONTHLY_GRANT_SECONDS, default 3600. */
export function memberGrantSeconds(): number {
  const n = Number(process.env.MEMBER_MONTHLY_GRANT_SECONDS);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 3600;
}

/**
 * Monthly member grant in USD micros. The grant is still expressed in seconds
 * (a placeholder until the client settles the money-era grant — see ADR 0002
 * Follow-up); this converts it to micros so it deposits like any other credit.
 */
export function memberGrantMicros(): number {
  return chargeMicrosForSeconds(memberGrantSeconds());
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
 * Reserve the cost of a transcription job: set the project's hold, charge the
 * balance, and write the ledger row — one statement. `costSeconds` is converted
 * to USD micros (chargeMicrosForSeconds) for the hold, balance, and delta; the
 * returned `balance` is in micros.
 *
 * The hold UPDATE's `hold_micros IS NULL` qual is the double-kickoff gate: a
 * concurrent second call matches zero rows and gets `already_held`. An overdraft
 * trips the CHECK (23514) and rolls the whole statement back, hold included →
 * `insufficient`.
 */
export async function reserveCredits(
  userId: string,
  projectId: string,
  costSeconds: number
): Promise<ReserveResult> {
  const holdMicros = chargeMicrosForSeconds(costSeconds);
  try {
    const [row] = await executeRows(sql`
      WITH hold AS (
        UPDATE projects SET hold_micros = ${holdMicros}, updated_at = now()
        WHERE id = ${projectId} AND user_id = ${userId} AND hold_micros IS NULL
        RETURNING user_id
      ),
      charged AS (
        UPDATE users u SET balance_micros = u.balance_micros - ${holdMicros}
        FROM hold WHERE u.id = hold.user_id
        RETURNING u.balance_micros
      ),
      led AS (
        INSERT INTO credit_ledger (user_id, delta_micros, reason, project_id, cost_micros)
        SELECT user_id, ${-holdMicros}, 'transcription', ${projectId},
               ${costSeconds * TRANSCRIPTION_COST_MICROS_PER_SECOND}
        FROM hold
      )
      SELECT (SELECT count(*)::int FROM hold) AS held,
             (SELECT balance_micros FROM charged) AS balance
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
      SELECT id, user_id, hold_micros AS held
      FROM projects
      WHERE id = ${projectId}
        AND hold_micros IS NOT NULL
        AND transcript_status <> 'processing'
        AND updated_at < now() - (interval '1 millisecond' * ${staleAfterMs})
    ),
    hold AS (
      UPDATE projects p SET hold_micros = NULL, updated_at = now()
      FROM prev
      WHERE p.id = prev.id
        AND p.hold_micros IS NOT NULL
        AND p.transcript_status <> 'processing'
        AND p.updated_at < now() - (interval '1 millisecond' * ${staleAfterMs})
      RETURNING prev.user_id, prev.held
    ),
    led AS (
      INSERT INTO credit_ledger (user_id, delta_micros, reason, project_id, cost_micros)
      SELECT user_id, held, 'refund', ${projectId},
             round(held * 60.0 / ${RETAIL_MICROS_PER_MINUTE})::int * ${TRANSCRIPTION_COST_MICROS_PER_SECOND}
      FROM hold WHERE held <> 0
      RETURNING user_id, delta_micros
    ),
    bal AS (
      UPDATE users u SET balance_micros = u.balance_micros + led.delta_micros
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
 * Clear the project's hold and true it up against what was actually billed:
 * - `actualSeconds = 0`    → full refund (job failed / never ran)
 * - `actualSeconds = n`    → refund the excess, or charge the shortfall
 *                            (clamped at balance 0 — see below)
 * - `actualSeconds = null` → keep the hold as the final charge (duration missing)
 *
 * The comparison happens in USD micros: `actualSeconds` is converted to its
 * retail charge and trued up against the stored `hold_micros`.
 *
 * Exactly-once across Deepgram callback retries and racing failure paths:
 * only the call that flips hold_micros to NULL produces ledger and
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
  const actualMicros =
    actualSeconds == null ? null : chargeMicrosForSeconds(actualSeconds);
  // `prev` snapshots the hold before the UPDATE nulls it — RETURNING yields
  // *new* column values, so reading the hold there would always give NULL.
  // Exactly-once still rests on the UPDATE's re-checked qual: of two racing
  // settles, the loser re-evaluates `IS NOT NULL` on the updated row, matches
  // nothing, and every downstream CTE is empty.
  const [row] = await executeRows(sql`
    WITH prev AS (
      SELECT id, user_id, hold_micros AS held
      FROM projects
      WHERE id = ${projectId} AND hold_micros IS NOT NULL
    ),
    hold AS (
      UPDATE projects p SET hold_micros = NULL, updated_at = now()
      FROM prev
      WHERE p.id = prev.id AND p.hold_micros IS NOT NULL
      RETURNING prev.user_id, prev.held
    ),
    adj AS (
      SELECT h.user_id, h.held,
             CASE
               WHEN ${actualMicros}::int IS NULL THEN 0
               WHEN ${actualMicros}::int >= h.held
                 THEN -LEAST(${actualMicros}::int - h.held, u.balance_micros)
               ELSE h.held - ${actualMicros}::int
             END AS delta
      FROM hold h JOIN users u ON u.id = h.user_id
    ),
    led AS (
      INSERT INTO credit_ledger (user_id, delta_micros, reason, project_id, cost_micros)
      SELECT user_id, delta,
             (CASE WHEN delta < 0 THEN 'transcription' ELSE 'refund' END)::credit_ledger_reason,
             ${projectId},
             -round(delta * 60.0 / ${RETAIL_MICROS_PER_MINUTE})::int * ${TRANSCRIPTION_COST_MICROS_PER_SECOND}
      FROM adj WHERE delta <> 0
      RETURNING user_id, delta_micros
    ),
    bal AS (
      UPDATE users u SET balance_micros = u.balance_micros + led.delta_micros
      FROM led WHERE u.id = led.user_id
    )
    SELECT (SELECT held FROM adj) AS held, (SELECT delta FROM adj) AS delta
  `);

  // No row / null held ⇒ nothing was settled (already settled earlier) — fine.
  if (row?.held == null || actualMicros == null) return;

  const held = Number(row.held);
  const delta = Number(row.delta);
  const shortfall = actualMicros - held;
  if (shortfall > 0 && -delta < shortfall) {
    reportError(
      "Credit reconciliation shortfall clamped at zero balance",
      new Error("credit shortfall clamped"),
      { projectId, held, actualMicros, charged: -delta, uncollected: shortfall + delta }
    );
  }
}

/** Best-effort settle — a credits hiccup must never mask the transcript result. */
export async function settleHoldQuietly(
  projectId: string,
  actualSeconds: number | null
): Promise<void> {
  try {
    await settleHold(projectId, actualSeconds);
  } catch (error) {
    reportError("Failed to settle credit hold", error, { projectId });
  }
}

/**
 * Credit a Stripe purchase, idempotently keyed on the Checkout session id.
 * `micros` is the USD-micros value to add. Returns false on a duplicate
 * delivery (webhook retry) — no double credit.
 */
export async function depositPurchase(
  userId: string,
  micros: number,
  stripeEventId: string
): Promise<boolean> {
  const rows = await executeRows(sql`
    WITH ins AS (
      INSERT INTO credit_ledger (user_id, delta_micros, reason, stripe_event_id)
      VALUES (${userId}, ${micros}, 'purchase', ${stripeEventId})
      ON CONFLICT (stripe_event_id) DO NOTHING
      RETURNING user_id, delta_micros
    )
    UPDATE users u SET balance_micros = u.balance_micros + ins.delta_micros
    FROM ins WHERE u.id = ins.user_id
    RETURNING u.balance_micros
  `);
  return rows.length > 0;
}

export type AiCutChargeResult =
  | { status: "charged" }
  | { status: "insufficient" };

/**
 * Charge an on-demand AI Cut run — a single eager deduction, unlike
 * reserveCredits' hold/settle pair, since this is one synchronous Gemini call
 * rather than an async job. `costSeconds` is converted to USD micros at the
 * retail rate. Same CHECK-constraint mechanism guards against overdraft.
 *
 * Every AI Cut run is charged here: the pass is strictly opt-in from the
 * studio (there is no automatic pass at transcription time), so each run is
 * a Gemini call the user explicitly asked — and pays — for.
 *
 * `idempotencyKey` (the caller's per-attempt `Idempotency-Key`, when sent)
 * is written into the same unique `stripe_event_id` column Stripe deposits
 * use — it's a generic unique/nullable slot, not Stripe-specific — under an
 * `ai_cut:` prefix so a retried request can never deduct twice. Without a
 * key (older/other callers), the insert is unconstrained, matching the
 * previous unconditional-charge behavior.
 */
export async function chargeAiCut(
  userId: string,
  projectId: string,
  costSeconds: number,
  idempotencyKey?: string
): Promise<AiCutChargeResult> {
  const chargeMicros = chargeMicrosForSeconds(costSeconds);
  const ledgerKey = idempotencyKey ? `ai_cut:${idempotencyKey}` : null;
  try {
    const rows = await executeRows(sql`
      WITH ins AS (
        INSERT INTO credit_ledger (user_id, delta_micros, reason, project_id, cost_micros, stripe_event_id)
        VALUES (${userId}, ${-chargeMicros}, 'ai_cut', ${projectId},
                ${costSeconds * AI_CUT_COST_MICROS_PER_SECOND}, ${ledgerKey})
        ON CONFLICT (stripe_event_id) DO NOTHING
        RETURNING delta_micros
      ),
      charged AS (
        UPDATE users u SET balance_micros = u.balance_micros + ins.delta_micros
        FROM ins WHERE u.id = ${userId}
        RETURNING u.balance_micros
      )
      SELECT balance_micros FROM charged
    `);
    if (rows.length === 0) {
      // A keyed retry that lost the ON CONFLICT race is already charged —
      // that is success, not an error. Only a genuinely missing user row
      // (no idempotency key in play) is the failure case.
      if (ledgerKey) return { status: "charged" };
      throw new Error("ai_cut charge matched no user row");
    }
    return { status: "charged" };
  } catch (error) {
    if (isCheckViolation(error)) return { status: "insufficient" };
    throw error;
  }
}

/**
 * Refund an AI Cut charge that didn't deliver a usable result (Gemini call
 * failed, or the transcript tripped the size guard) — a straight credit-back
 * in USD micros, no hold to reconcile against. Keyed the same way as
 * `chargeAiCut` (a distinct `ai_cut_refund:` prefix) so a retried refund
 * can't double-credit either.
 */
export async function refundAiCut(
  userId: string,
  projectId: string,
  costSeconds: number,
  idempotencyKey?: string
): Promise<void> {
  const chargeMicros = chargeMicrosForSeconds(costSeconds);
  const ledgerKey = idempotencyKey ? `ai_cut_refund:${idempotencyKey}` : null;
  await executeRows(sql`
    WITH ins AS (
      INSERT INTO credit_ledger (user_id, delta_micros, reason, project_id, cost_micros, stripe_event_id)
      SELECT id, ${chargeMicros}, 'refund', ${projectId},
             ${costSeconds * AI_CUT_COST_MICROS_PER_SECOND}, ${ledgerKey}
      FROM users WHERE id = ${userId}
      ON CONFLICT (stripe_event_id) DO NOTHING
      RETURNING user_id, delta_micros
    )
    UPDATE users u SET balance_micros = u.balance_micros + ins.delta_micros
    FROM ins WHERE u.id = ins.user_id
  `);
}

/**
 * Lazy monthly grant: deposits `grantMicros` USD micros once per UTC calendar
 * month for members; a no-op for non-members and already-granted months.
 * Race-safe via the partial unique index credit_ledger_grant_month_uq — of two
 * concurrent calls, one inserts and the other conflicts into a no-op.
 */
export async function ensureMonthlyGrant(
  userId: string,
  grantMicros: number
): Promise<void> {
  if (grantMicros <= 0) return;
  await executeRows(sql`
    WITH ins AS (
      INSERT INTO credit_ledger (user_id, delta_micros, reason, month_key)
      SELECT id, ${grantMicros}, 'grant', ${currentMonthKey()}
      FROM users WHERE id = ${userId} AND is_member
      ON CONFLICT (user_id, month_key) WHERE reason = 'grant' DO NOTHING
      RETURNING user_id, delta_micros
    )
    UPDATE users u SET balance_micros = u.balance_micros + ins.delta_micros
    FROM ins WHERE u.id = ins.user_id
  `);
}
