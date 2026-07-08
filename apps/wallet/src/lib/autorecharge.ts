import { sql } from "drizzle-orm";
import { eq } from "drizzle-orm";
import { db } from "@repo/db";
import { users } from "@repo/db/schema";

/**
 * Auto-recharge data + business logic (ADR 0002/0002).
 *
 * The money mutations reuse child 0001's rule: every balance change is a single
 * CTE-pipeline statement (neon-http has no transactions), idempotent on the
 * Stripe id via credit_ledger.stripe_event_id. Auto-recharge deposits use the
 * distinct reason `auto_recharge`, which is what makes the daily-cap count cheap.
 */

/** Max successful auto-recharges per rolling 24h (safety cap). Config, not code. */
export const AUTORECHARGE_MAX_PER_DAY =
  Number(process.env.AUTORECHARGE_MAX_PER_DAY) || 3;

/** Consecutive declines before auto-recharge turns itself off. */
export const AUTORECHARGE_MAX_FAILURES =
  Number(process.env.AUTORECHARGE_MAX_FAILURES) || 3;

type Row = Record<string, unknown>;

async function executeRows(query: ReturnType<typeof sql>): Promise<Row[]> {
  const result = await db.execute(query);
  return (result as unknown as { rows: Row[] }).rows ?? [];
}

export interface AutoRechargeCandidate {
  id: string;
  stripeCustomerId: string;
  defaultPaymentMethodId: string;
  amountMicros: number;
  /** Decline counter at selection time — part of the idempotency key. */
  failures: number;
}

/**
 * Users the sweep should top up: auto-recharge on, a saved card + customer,
 * threshold and amount set, and the balance has dropped below the threshold.
 * Lowest balance first, so the most urgent are charged if a run is capped short.
 */
export async function selectAutoRechargeCandidates(
  limit = 200
): Promise<AutoRechargeCandidate[]> {
  const rows = await executeRows(sql`
    SELECT id,
           stripe_customer_id AS "stripeCustomerId",
           default_payment_method_id AS "defaultPaymentMethodId",
           autorecharge_amount_micros AS "amountMicros",
           autorecharge_failures AS "failures"
    FROM users
    WHERE autorecharge_enabled = true
      AND stripe_customer_id IS NOT NULL
      AND default_payment_method_id IS NOT NULL
      AND autorecharge_threshold_micros IS NOT NULL
      AND autorecharge_amount_micros IS NOT NULL
      AND balance_micros < autorecharge_threshold_micros
    ORDER BY balance_micros ASC
    LIMIT ${limit}
  `);
  return rows.map((r) => ({
    id: String(r.id),
    stripeCustomerId: String(r.stripeCustomerId),
    defaultPaymentMethodId: String(r.defaultPaymentMethodId),
    amountMicros: Number(r.amountMicros),
    failures: Number(r.failures),
  }));
}

/**
 * Check if a user still needs auto-recharge.
 * Used right before charging Stripe to avoid race conditions with manual deposits.
 */
export async function checkNeedsAutoRecharge(userId: string): Promise<boolean> {
  const [row] = await executeRows(sql`
    SELECT balance_micros < autorecharge_threshold_micros AS needs_recharge
    FROM users
    WHERE id = ${userId}
      AND autorecharge_enabled = true
      AND autorecharge_threshold_micros IS NOT NULL
  `);
  return row?.needs_recharge === true;
}

/** Count of successful auto-recharges for a user in the last rolling 24 hours. */
export async function countRecentAutoRecharges(userId: string): Promise<number> {
  const [row] = await executeRows(sql`
    SELECT count(*)::int AS n
    FROM credit_ledger
    WHERE user_id = ${userId}
      AND reason = 'auto_recharge'
      AND created_at > now() - interval '24 hours'
  `);
  return Number(row?.n ?? 0);
}

/**
 * Stable idempotency key for one recharge attempt. It advances only when the
 * user's state actually changes — the count of today's successes or the decline
 * counter — so:
 *  - repeated sweeps in the gap before the webhook lands reuse the same key
 *    (Stripe dedups, no double charge),
 *  - a success (count++, failures reset to 0) frees a new key for the next dip,
 *  - a decline (failures++ via the webhook) frees a new key so the sweep retries
 *    and the failure counter can climb to the auto-disable threshold.
 */
export function autoRechargeIdempotencyKey(
  userId: string,
  successesToday: number,
  failures: number
): string {
  return `autorecharge:v1:${userId}:s${successesToday}:f${failures}`;
}

/**
 * Credit a successful off-session recharge, idempotent on the PaymentIntent id,
 * and reset the decline counter — one statement. Returns false on a duplicate
 * webhook delivery (no double credit).
 */
export async function depositAutoRecharge(
  userId: string,
  micros: number,
  stripeEventId: string
): Promise<boolean> {
  const rows = await executeRows(sql`
    WITH ins AS (
      INSERT INTO credit_ledger (user_id, delta_micros, reason, stripe_event_id)
      VALUES (${userId}, ${micros}, 'auto_recharge', ${stripeEventId})
      ON CONFLICT (stripe_event_id) DO NOTHING
      RETURNING user_id, delta_micros
    )
    UPDATE users u
    SET balance_micros = u.balance_micros + ins.delta_micros,
        autorecharge_failures = 0
    FROM ins WHERE u.id = ins.user_id
    RETURNING u.balance_micros
  `);
  return rows.length > 0;
}

/**
 * Record an off-session decline: bump the counter and, once it reaches the cap,
 * switch auto-recharge off (the balance is then allowed to reach $0 and services
 * gate via the child-0001 CHECK, as if auto-recharge were never on). Returns the
 * new failure count and whether this call disabled it (so the caller notifies).
 */
export async function recordAutoRechargeFailure(
  userId: string,
  maxFailures = AUTORECHARGE_MAX_FAILURES
): Promise<{ failures: number; disabled: boolean }> {
  const [row] = await executeRows(sql`
    UPDATE users
    SET autorecharge_failures = autorecharge_failures + 1,
        autorecharge_enabled = CASE
          WHEN autorecharge_failures + 1 >= ${maxFailures} THEN false
          ELSE autorecharge_enabled
        END
    WHERE id = ${userId}
    RETURNING autorecharge_failures AS failures
  `);
  const failures = Number(row?.failures ?? 0);
  return { failures, disabled: failures >= maxFailures };
}

/** Persist the Stripe customer id (first save wins — never overwrite). */
/**
 * First-write-wins (COALESCE): once a user has a Stripe customer id, it never
 * changes. Returns the id that actually ended up stored, so a caller that
 * also has a payment method for `customerId` can check it still matches
 * before saving it — otherwise a second concurrent checkout (a different
 * customer) could end up overwriting the saved card with a payment method
 * that belongs to a customer id nobody kept.
 */
export async function setStripeCustomerId(
  userId: string,
  customerId: string
): Promise<string | null> {
  const rows = await executeRows(sql`
    UPDATE users
    SET stripe_customer_id = COALESCE(stripe_customer_id, ${customerId})
    WHERE id = ${userId}
    RETURNING stripe_customer_id
  `);
  return (rows[0]?.stripe_customer_id as string | undefined) ?? null;
}

/** Persist the saved card to use off-session. */
export async function setDefaultPaymentMethod(
  userId: string,
  paymentMethodId: string
): Promise<void> {
  await db
    .update(users)
    .set({ defaultPaymentMethodId: paymentMethodId })
    .where(eq(users.id, userId));
}

export interface AutorechargeSettings {
  enabled: boolean;
  thresholdMicros: number;
  amountMicros: number;
}

/** Write validated settings (validation lives in the route). */
export async function updateAutorechargeSettings(
  userId: string,
  s: AutorechargeSettings
): Promise<void> {
  await db
    .update(users)
    .set({
      autorechargeEnabled: s.enabled,
      autorechargeThresholdMicros: s.thresholdMicros,
      autorechargeAmountMicros: s.amountMicros,
      // Re-enabling after a fixed card clears the decline counter.
      autorechargeFailures: s.enabled ? 0 : sql`${users.autorechargeFailures}`,
    })
    .where(eq(users.id, userId));
}
