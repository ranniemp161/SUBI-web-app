// Hard stop against this file reaching a browser bundle. The `@repo/billing`
// barrel re-exports it, so a client component that reaches for `formatUsd` or
// the retail rate from the barrel instead of `@repo/billing/pricing` would drag
// the Neon driver in with it. That is a build error now, not a silent 200KB.
import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@repo/db";
import { reportError } from "@repo/server-shared/observability";
import {
  AI_CUT_COST_MICROS_PER_SECOND,
  BROLL_CHARACTER_SET_COST_MICROS,
  BROLL_CHARACTER_SET_MICROS,
  BROLL_PLAN_RERUN_COST_MICROS,
  BROLL_PLAN_RERUN_MICROS,
  BROLL_STALE_HOLD_MS,
  RETAIL_MICROS_PER_MINUTE,
  TRANSCRIPTION_COST_MICROS_PER_SECOND,
  chargeMicrosForSeconds,
  currentMonthKey,
} from "./pricing";

/**
 * The only place in the ecosystem that moves money.
 *
 * The balance is real money in USD micros (1,000,000 = $1). The ledger
 * (credit_ledger) is the source of truth; users.balance_micros is a cache of
 * SUM(delta_micros). The neon-http driver has no transactions, so every
 * mutation here is a single CTE-pipeline statement (same philosophy as
 * server-shared's rate limiter): all of it commits or none of it does.
 *
 * Concurrency rests on the users_balance_micros_nonneg CHECK constraint —
 * deliberately, no `balance_micros >= cost` qual appears in any UPDATE.
 * Concurrent spends serialize on the users row; whichever statement would
 * overdraft raises 23514 and rolls back in its entirety, earlier CTEs
 * (e.g. the project hold) included.
 *
 * Metering is unchanged in spirit: the caller still computes billable seconds
 * exactly as before (client duration for the hold, Deepgram metadata.duration
 * for the settle); only the final step multiplies those seconds into USD micros
 * at the retail rate (chargeMicrosForSeconds) before touching the ledger.
 *
 * Both apps import from here. Do not re-implement any of it app-side: two
 * copies of a money invariant drift, and the drift is silent.
 */

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

// ---------------------------------------------------------------------------
// B-Roll (apps/broll)
//
// New sibling functions, NOT an extension of the ones above, and spec
// `broll/0002` build step 6 says so explicitly because "reuse what is proven"
// would mislead here: `reserveCredits`, `reclaimStaleHold` and `settleHold`
// each hardcode `UPDATE projects` in their SQL, and `reclaimStaleHold` also
// hardcodes `transcript_status <> 'processing'`. None of them can be pointed at
// another table.
//
// Two shapes, matching what is being paid for:
//
// - A character set **holds first** (reserve, external call, settle). Six
//   Gemini image calls take ~110 s, so the money must be reserved before we
//   spend it at the vendor; the CHECK rejects an overdraft while the images are
//   still unbought.
// - A plan re-run **charges eagerly**, exactly like `chargeAiCut`. It is one
//   synchronous text call, so a hold would be pure overhead.
//
// Both are flat per action, not per second — see `flatRateMicros` in ./pricing.
// ---------------------------------------------------------------------------

export type BrollReserveResult =
  | { status: "reserved"; balance: number }
  | { status: "insufficient" }
  | { status: "already_held" };

/**
 * Reserve the price of one character emotion set: take the generation claim,
 * park the hold, debit the balance, and write the ledger row — one statement.
 *
 * `gen_claim_at` and `hold_micros` are set together and cleared together
 * (spec `broll/0002` invariant 5: money with no claim, or a claim with no
 * money, is a bug). Setting both here is what makes that pair atomic.
 *
 * The `hold_micros IS NULL AND gen_claim_at IS NULL` qual is the double-click
 * gate: a concurrent second Generate matches zero rows and gets `already_held`
 * without charging. An overdraft trips the CHECK (23514) and rolls the whole
 * statement back — claim, hold, debit and ledger row together → `insufficient`.
 *
 * Deliberately strict about a *stale* claim rather than stealing it: a row
 * whose claim has expired still holds real money, and overwriting it here would
 * debit a second time and orphan the first hold with nothing to refund it. A
 * caller that gets `already_held` calls `reclaimStaleBrollHold` and retries,
 * which is the same dance rough-cut does around `reserveCredits`.
 */
export async function reserveBrollHold(
  userId: string,
  brollProjectId: string,
  priceMicros: number = BROLL_CHARACTER_SET_MICROS
): Promise<BrollReserveResult> {
  try {
    const [row] = await executeRows(sql`
      WITH hold AS (
        UPDATE broll_projects
        SET hold_micros = ${priceMicros}, gen_claim_at = now(), updated_at = now()
        WHERE id = ${brollProjectId} AND user_id = ${userId}
          AND hold_micros IS NULL AND gen_claim_at IS NULL
        RETURNING user_id
      ),
      charged AS (
        UPDATE users u SET balance_micros = u.balance_micros - ${priceMicros}
        FROM hold WHERE u.id = hold.user_id
        RETURNING u.balance_micros
      ),
      led AS (
        INSERT INTO credit_ledger (user_id, delta_micros, reason, broll_project_id, cost_micros)
        SELECT user_id, ${-priceMicros}, 'broll_character_set', ${brollProjectId},
               ${BROLL_CHARACTER_SET_COST_MICROS}
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

export type BrollSettleOutcome =
  /**
   * The set generated. The price is flat, so there is nothing to true up
   * against usage — the hold simply becomes the charge. `costMicros` is the
   * Gemini call's real reported usage (AC-16); pass null when the response
   * carried no usage metadata and the reserve row's estimate stands.
   */
  | { status: "generated"; costMicros?: number | null }
  /** The generation failed. Refund in full — the user got nothing. */
  | { status: "failed" };

/**
 * Release a character-set generation: clear the claim and the hold together,
 * and either let the charge stand or refund it in full.
 *
 * **No reconciliation, unlike `settleHold`.** That one trues a hold up against
 * metered seconds because transcription is priced per minute. A character set
 * is priced flat, so the only two outcomes are "keep the charge" and "give it
 * all back" — there is no partial.
 *
 * Exactly-once across retries rests on the same mechanism as `settleHold`: only
 * the call that flips `hold_micros` to NULL produces ledger and balance
 * effects, and a racing second call re-evaluates `IS NOT NULL` on the updated
 * row, matches nothing, and leaves every downstream CTE empty.
 *
 * On success this also trues up `cost_micros` on the reserve row, which is the
 * one place b-roll UPDATEs an existing ledger row rather than appending. That is
 * safe and deliberate: `cost_micros` is margin *reporting*, carries no balance
 * effect, and is not part of the SUM the cached balance reconciles against. The
 * real per-call cost is not knowable until the vendor answers, and writing the
 * estimate forever would make the margin data the pricing decision depends on
 * useless. It targets one row by id, so repeated generations on one project
 * each keep their own figure.
 */
export async function settleBrollHold(
  brollProjectId: string,
  outcome: BrollSettleOutcome
): Promise<void> {
  const refund = outcome.status === "failed";
  const actualCost =
    outcome.status === "generated" && outcome.costMicros != null
      ? Math.max(0, Math.round(outcome.costMicros))
      : null;

  await executeRows(sql`
    WITH prev AS (
      SELECT id, user_id, hold_micros AS held
      FROM broll_projects
      WHERE id = ${brollProjectId} AND hold_micros IS NOT NULL
    ),
    rel AS (
      UPDATE broll_projects p
      SET hold_micros = NULL, gen_claim_at = NULL, updated_at = now()
      FROM prev
      WHERE p.id = prev.id AND p.hold_micros IS NOT NULL
      RETURNING prev.user_id, prev.held
    ),
    led AS (
      INSERT INTO credit_ledger (user_id, delta_micros, reason, broll_project_id, cost_micros)
      SELECT user_id, held, 'refund', ${brollProjectId}, 0
      FROM rel WHERE ${refund} AND held <> 0
      RETURNING user_id, delta_micros
    ),
    bal AS (
      UPDATE users u SET balance_micros = u.balance_micros + led.delta_micros
      FROM led WHERE u.id = led.user_id
    ),
    cost AS (
      UPDATE credit_ledger
      SET cost_micros = ${actualCost}
      WHERE ${actualCost}::int IS NOT NULL
        AND EXISTS (SELECT 1 FROM rel)
        AND id = (
          SELECT id FROM credit_ledger
          WHERE broll_project_id = ${brollProjectId}
            AND reason = 'broll_character_set'
          ORDER BY created_at DESC
          LIMIT 1
        )
    )
    SELECT (SELECT count(*)::int FROM rel) AS released
  `);
}

/** Best-effort settle — a credits hiccup must never mask a generated set. */
export async function settleBrollHoldQuietly(
  brollProjectId: string,
  outcome: BrollSettleOutcome
): Promise<void> {
  try {
    await settleBrollHold(brollProjectId, outcome);
  } catch (error) {
    reportError("Failed to settle b-roll generation hold", error, {
      brollProjectId,
      outcome: outcome.status,
    });
  }
}

/**
 * Reclaim a character-set hold stranded by a crash: refund it and release the
 * claim, but only if the claim has aged past `staleAfterMs`.
 *
 * The b-roll sibling of `reclaimStaleHold`, and it cannot reuse it — that one
 * reads `projects` and quals on `transcript_status`, a column this table does
 * not have. Here the claim's own age is the liveness signal, which is why
 * `gen_claim_at` is written at reserve rather than left for the caller.
 *
 * **The default window is ten minutes, not `STALE_HOLD_MS`.** See
 * `BROLL_STALE_HOLD_MS` — reclaiming at ten seconds would rob a generation that
 * is still running and charge the user twice.
 *
 * Returns true if a hold was reclaimed (safe to retry the reserve).
 */
export async function reclaimStaleBrollHold(
  brollProjectId: string,
  staleAfterMs: number = BROLL_STALE_HOLD_MS
): Promise<boolean> {
  const [row] = await executeRows(sql`
    WITH prev AS (
      SELECT id, user_id, hold_micros AS held
      FROM broll_projects
      WHERE id = ${brollProjectId}
        AND hold_micros IS NOT NULL
        AND gen_claim_at IS NOT NULL
        AND gen_claim_at < now() - (interval '1 millisecond' * ${staleAfterMs})
    ),
    rel AS (
      UPDATE broll_projects p
      SET hold_micros = NULL, gen_claim_at = NULL, updated_at = now()
      FROM prev
      WHERE p.id = prev.id
        AND p.hold_micros IS NOT NULL
        AND p.gen_claim_at IS NOT NULL
        AND p.gen_claim_at < now() - (interval '1 millisecond' * ${staleAfterMs})
      RETURNING prev.user_id, prev.held
    ),
    led AS (
      INSERT INTO credit_ledger (user_id, delta_micros, reason, broll_project_id, cost_micros)
      SELECT user_id, held, 'refund', ${brollProjectId}, 0
      FROM rel WHERE held <> 0
      RETURNING user_id, delta_micros
    ),
    bal AS (
      UPDATE users u SET balance_micros = u.balance_micros + led.delta_micros
      FROM led WHERE u.id = led.user_id
    )
    SELECT (SELECT count(*)::int FROM rel) AS reclaimed
  `);

  const reclaimed = Number(row?.reclaimed ?? 0) > 0;
  if (reclaimed) {
    console.warn(
      `Reclaimed an abandoned b-roll generation hold on project ${brollProjectId}.`
    );
  }
  return reclaimed;
}

export type BrollPlanChargeResult =
  | { status: "charged" }
  /** First run on this project — bundled into the character-set price (AC-25). */
  | { status: "bundled" }
  | { status: "insufficient" }
  /** No such project for this user. */
  | { status: "not_found" };

/**
 * Charge a scene-plan re-run, and count the run — one statement.
 *
 * `broll_projects.plan_runs` is the only value separating a bundled first run
 * from a charged re-run (AC-25, AC-41), so reading it in the app and charging
 * on the answer would be check-then-act: two concurrent first runs would both
 * read zero and both go free. The counter is therefore incremented here, in the
 * same statement as the charge, and the pre-increment value decides.
 *
 * Eager, like `chargeAiCut`, because a plan run is one synchronous call.
 * `idempotencyKey` rides in the same generic unique `stripe_event_id` slot
 * under a `broll_plan:` prefix (AC-45), so a double-click charges once.
 *
 * **Known, bounded imprecision.** The `dup` guard stops a *sequential* retry
 * from re-incrementing `plan_runs`, but two genuinely concurrent requests
 * carrying the same key both see no duplicate and both increment, while only
 * one insert survives the `ON CONFLICT`. The user is charged exactly once —
 * that is the invariant that matters — and `plan_runs` can over-count by one.
 * Over-counting only ever moves a run from bundled to charged at the very first
 * boundary, and never charges twice for one run. Tightening it further needs a
 * row lock the single-statement style here deliberately avoids.
 */
export async function chargeBrollPlanRerun(
  userId: string,
  brollProjectId: string,
  idempotencyKey?: string,
  priceMicros: number = BROLL_PLAN_RERUN_MICROS
): Promise<BrollPlanChargeResult> {
  const ledgerKey = idempotencyKey ? `broll_plan:${idempotencyKey}` : null;
  try {
    const [row] = await executeRows(sql`
      WITH dup AS (
        SELECT 1 FROM credit_ledger
        WHERE ${ledgerKey}::text IS NOT NULL AND stripe_event_id = ${ledgerKey}
      ),
      claim AS (
        UPDATE broll_projects
        SET plan_runs = plan_runs + 1, updated_at = now()
        WHERE id = ${brollProjectId} AND user_id = ${userId}
          AND NOT EXISTS (SELECT 1 FROM dup)
        RETURNING user_id, (plan_runs - 1) AS prior_runs
      ),
      ins AS (
        INSERT INTO credit_ledger (user_id, delta_micros, reason, broll_project_id, cost_micros, stripe_event_id)
        SELECT user_id,
               CASE WHEN prior_runs > 0 THEN ${-priceMicros} ELSE 0 END,
               'broll_plan_rerun', ${brollProjectId},
               ${BROLL_PLAN_RERUN_COST_MICROS}, ${ledgerKey}
        FROM claim
        ON CONFLICT (stripe_event_id) DO NOTHING
        RETURNING user_id, delta_micros
      ),
      charged AS (
        UPDATE users u SET balance_micros = u.balance_micros + ins.delta_micros
        FROM ins WHERE u.id = ins.user_id
      )
      SELECT (SELECT count(*)::int FROM dup) AS duplicate,
             (SELECT count(*)::int FROM claim) AS claimed,
             (SELECT prior_runs FROM claim) AS prior_runs
    `);

    // A key we have already charged: the work was paid for, report success.
    if (Number(row?.duplicate ?? 0) > 0) return { status: "charged" };
    if (!row || Number(row.claimed) === 0) return { status: "not_found" };
    return Number(row.prior_runs) > 0
      ? { status: "charged" }
      : { status: "bundled" };
  } catch (error) {
    if (isCheckViolation(error)) return { status: "insufficient" };
    throw error;
  }
}

/**
 * Refund a plan re-run that did not deliver a usable plan (the Gemini call
 * failed, or the response failed the planner's validator). A straight
 * credit-back — there is no hold to reconcile, matching `refundAiCut`.
 *
 * Keyed under its own `broll_plan_refund:` prefix so a retried refund cannot
 * double-credit. `plan_runs` is deliberately left alone: the run happened, it
 * simply did not produce anything, and decrementing it would hand out a second
 * bundled run.
 */
export async function refundBrollPlanRerun(
  userId: string,
  brollProjectId: string,
  idempotencyKey?: string,
  priceMicros: number = BROLL_PLAN_RERUN_MICROS
): Promise<void> {
  const ledgerKey = idempotencyKey
    ? `broll_plan_refund:${idempotencyKey}`
    : null;
  await executeRows(sql`
    WITH ins AS (
      INSERT INTO credit_ledger (user_id, delta_micros, reason, broll_project_id, cost_micros, stripe_event_id)
      SELECT id, ${priceMicros}, 'refund', ${brollProjectId},
             ${BROLL_PLAN_RERUN_COST_MICROS}, ${ledgerKey}
      FROM users WHERE id = ${userId}
      ON CONFLICT (stripe_event_id) DO NOTHING
      RETURNING user_id, delta_micros
    )
    UPDATE users u SET balance_micros = u.balance_micros + ins.delta_micros
    FROM ins WHERE u.id = ins.user_id
  `);
}
