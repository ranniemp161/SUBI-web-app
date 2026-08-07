import { NextResponse } from "next/server";
import Stripe from "stripe";
import { chargeAutoRechargeOffSession } from "@/lib/stripe";
import {
  selectAutoRechargeCandidates,
  checkNeedsAutoRecharge,
  countRecentAutoRecharges,
  autoRechargeIdempotencyKey,
  depositAutoRecharge,
  recordAutoRechargeFailure,
  AUTORECHARGE_MAX_PER_DAY,
  type AutoRechargeCandidate,
} from "@/lib/autorecharge";
import { reportError } from "@/lib/observability";

// One run may touch many users; give it room.
export const maxDuration = 300;

/**
 * How many candidates are charged at once.
 *
 * Each candidate is a different user with a different Stripe customer, so they
 * share nothing but the database. Nothing about the sweep depends on their
 * order, and safety against a double charge comes from the per-user
 * idempotency key, not from sequencing — so this is genuinely parallelizable.
 *
 * Ten sits far under Stripe's live-mode rate limit (~100 requests/second) and
 * turns a sweep that managed roughly one user per second into roughly ten.
 *
 * This used to be a `BATCH_SIZE` that sliced the candidate list into tens and
 * then awaited each member of the slice in sequence — the slicing bought
 * nothing at all. See the 2026-07-08 hardening note.
 */
const CONCURRENCY = 10;

/**
 * Stop *starting* new batches once the run has been going this long.
 *
 * `maxDuration` is 300s and a batch is a second or two, so 240s leaves plenty
 * of room to finish the batch already in flight and still answer. Whatever is
 * left over comes back as `remaining` and is picked up by the next run: the
 * selection query re-derives who still needs a top-up from live balances, so
 * there is no cursor to persist and no risk of skipping someone.
 *
 * On the Hobby plan the next run is a day away (see the root AGENTS.md note on
 * the cron cap), which is exactly why a non-zero `remaining` is reported to
 * Sentry rather than only returned in the body.
 */
const TIME_BUDGET_MS = 240_000;

/** A thrown Stripe card/auth error means the off-session charge did not go through. */
function isDecline(error: unknown): boolean {
  if (error instanceof Stripe.errors.StripeCardError) return true;
  const code = (error as { code?: string })?.code;
  return (
    code === "card_declined" ||
    code === "authentication_required" ||
    code === "expired_card" ||
    code === "insufficient_funds"
  );
}

/**
 * Record a decline without letting a database hiccup take the whole sweep down.
 * The charge has already failed by this point; losing the counter bump is a far
 * smaller loss than aborting every candidate that shares this batch.
 */
async function noteFailureQuietly(userId: string) {
  try {
    await recordAutoRechargeFailure(userId);
  } catch (error) {
    reportError("Auto-recharge sweep: failed to record a decline", error, {
      userId,
    });
  }
}

/** What happened to one candidate. Every path returns exactly one of these. */
type Outcome = "charged" | "declined" | "capped" | "skipped" | "errored";

/**
 * Sweep a single candidate.
 *
 * Total by construction: every path returns an `Outcome` and nothing escapes,
 * so one user's bad day cannot abort the batch they happen to share. That
 * matters more now the batch runs concurrently — a rejection inside
 * `Promise.all` would discard the outcomes of its nine siblings, and those
 * charges may already have reached Stripe.
 */
async function sweepOne(c: AutoRechargeCandidate): Promise<Outcome> {
  try {
    // Re-check against the live balance: the user may have topped up manually
    // between being selected and being charged.
    const needsRecharge = await checkNeedsAutoRecharge(c.id);
    if (!needsRecharge) return "skipped";

    const successesToday = await countRecentAutoRecharges(c.id);
    if (successesToday >= AUTORECHARGE_MAX_PER_DAY) return "capped";

    const pi = await chargeAutoRechargeOffSession({
      customerId: c.stripeCustomerId,
      paymentMethodId: c.defaultPaymentMethodId,
      amountMicros: c.amountMicros,
      userId: c.id,
      idempotencyKey: autoRechargeIdempotencyKey(
        c.id,
        successesToday,
        c.failures
      ),
    });

    if (pi.status === "succeeded") {
      await depositAutoRecharge(c.id, c.amountMicros, pi.id);
      return "charged";
    }

    // requires_action / processing etc. — can't complete off-session.
    await noteFailureQuietly(c.id);
    return "declined";
  } catch (error) {
    if (isDecline(error)) {
      await noteFailureQuietly(c.id);
      return "declined";
    }
    // Network/config error — don't count it against the user's card.
    reportError("Auto-recharge sweep: unexpected charge error", error, {
      userId: c.id,
    });
    return "errored";
  }
}

/**
 * GET /api/cron/autorecharge — the auto-recharge sweep (ADR 0002/0002).
 *
 * Selects users whose balance dropped below their threshold and charges their
 * saved card off-session, `CONCURRENCY` at a time until the candidate list runs
 * out or the time budget does. Runs entirely in the wallet (rough-cut never
 * calls Stripe). Safe by construction: a per-user daily cap, an idempotency key
 * that can't double-charge on a re-run, and a decline counter that auto-disables
 * a dead card.
 *
 * Failure accounting lives HERE, not in the webhook: an off-session charge with
 * confirm:true resolves synchronously, so every decline (including
 * `authentication_required`, which never emits a `payment_failed` webhook) is
 * caught in `sweepOne`'s try/catch. The webhook's `payment_intent.*` handlers are
 * idempotent backstops (see the webhook route). Failures are recorded on the
 * user row (`recordAutoRechargeFailure`) and surfaced by the Wallet dashboard;
 * the sweep itself does not send notifications or auto-disable on a decline
 * threshold.
 */
export async function GET(request: Request) {
  const authHeader = request.headers.get("Authorization");
  if (
    !process.env.CRON_SECRET ||
    authHeader !== `Bearer ${process.env.CRON_SECRET}`
  ) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const startedAt = Date.now();
  const tally: Record<Outcome, number> = {
    charged: 0,
    declined: 0,
    capped: 0,
    skipped: 0,
    errored: 0,
  };
  let processed = 0;

  try {
    const candidates = await selectAutoRechargeCandidates();

    for (let i = 0; i < candidates.length; i += CONCURRENCY) {
      if (Date.now() - startedAt > TIME_BUDGET_MS) break;

      const batch = candidates.slice(i, i + CONCURRENCY);
      // sweepOne never rejects, so this never rejects — see its doc comment.
      const outcomes = await Promise.all(batch.map(sweepOne));
      for (const outcome of outcomes) tally[outcome]++;
      processed += batch.length;
    }

    const remaining = candidates.length - processed;
    if (remaining > 0) {
      // Not just a body field: on Hobby the next run is ~24h away, so users who
      // fell off the end of this sweep can hit $0 in the meantime.
      reportError(
        "Auto-recharge sweep hit its time budget with candidates left",
        new Error("autorecharge sweep incomplete"),
        { selected: candidates.length, processed, remaining }
      );
    }

    return NextResponse.json({
      swept: candidates.length,
      processed,
      remaining,
      ...tally,
    });
  } catch (error) {
    reportError("Auto-recharge sweep failed", error);
    return NextResponse.json({ error: "Sweep failed." }, { status: 500 });
  }
}
