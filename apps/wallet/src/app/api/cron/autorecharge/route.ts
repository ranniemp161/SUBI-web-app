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
} from "@/lib/autorecharge";
import { notifyAutoRecharge } from "@/lib/notifications";
import { reportError } from "@/lib/observability";

// One run may touch many users; give it room.
export const maxDuration = 300;

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

async function noteFailure(userId: string) {
  const r = await recordAutoRechargeFailure(userId);
  await notifyAutoRecharge(
    userId,
    r.disabled
      ? { kind: "disabled", failures: r.failures }
      : { kind: "declined", failures: r.failures }
  );
}

/**
 * GET /api/cron/autorecharge — the auto-recharge sweep (ADR 0002/0002).
 *
 * Selects users whose balance dropped below their threshold and charges their
 * saved card off-session. Runs entirely in the wallet (rough-cut never calls
 * Stripe). Safe by construction: a per-user daily cap, an idempotency key that
 * can't double-charge on a re-run, and a decline counter that auto-disables a
 * dead card.
 *
 * Failure accounting lives HERE, not in the webhook: an off-session charge with
 * confirm:true resolves synchronously, so every decline (including
 * `authentication_required`, which never emits a `payment_failed` webhook) is
 * caught in this try/catch. The webhook's `payment_intent.*` handlers are
 * idempotent backstops (see the webhook route). This is a placement refinement
 * of the ADR's task 5; the behaviour (notify, then auto-disable after N declines)
 * is unchanged.
 */
export async function GET(request: Request) {
  const authHeader = request.headers.get("Authorization");
  if (
    !process.env.CRON_SECRET ||
    authHeader !== `Bearer ${process.env.CRON_SECRET}`
  ) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let charged = 0;
  let declined = 0;
  let capped = 0;
  let errored = 0;

  try {
    const candidates = await selectAutoRechargeCandidates();

    const BATCH_SIZE = 10;
    for (let i = 0; i < candidates.length; i += BATCH_SIZE) {
      const batch = candidates.slice(i, i + BATCH_SIZE);
      for (const c of batch) {
        try {
          const needsRecharge = await checkNeedsAutoRecharge(c.id);
          if (!needsRecharge) {
            continue;
          }

          const successesToday = await countRecentAutoRecharges(c.id);
          if (successesToday >= AUTORECHARGE_MAX_PER_DAY) {
            capped++;
            continue;
          }

          const idempotencyKey = autoRechargeIdempotencyKey(
            c.id,
            successesToday,
            c.failures
          );
          const pi = await chargeAutoRechargeOffSession({
            customerId: c.stripeCustomerId,
            paymentMethodId: c.defaultPaymentMethodId,
            amountMicros: c.amountMicros,
            userId: c.id,
            idempotencyKey,
          });

          if (pi.status === "succeeded") {
            await depositAutoRecharge(c.id, c.amountMicros, pi.id);
            await notifyAutoRecharge(c.id, {
              kind: "recharged",
              amountMicros: c.amountMicros,
            });
            charged++;
          } else {
            // requires_action / processing etc. — can't complete off-session.
            await noteFailure(c.id);
            declined++;
          }
        } catch (error) {
          if (isDecline(error)) {
            await noteFailure(c.id);
            declined++;
          } else {
            // Network/config error — don't count it against the user's card.
            reportError("Auto-recharge sweep: unexpected charge error", error, {
              userId: c.id,
            });
            errored++;
          }
        }
      }
    }

    return NextResponse.json({
      swept: candidates.length,
      charged,
      declined,
      capped,
      errored,
    });
  } catch (error) {
    reportError("Auto-recharge sweep failed", error);
    return NextResponse.json({ error: "Sweep failed." }, { status: 500 });
  }
}
