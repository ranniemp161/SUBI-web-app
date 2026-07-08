import { NextResponse } from "next/server";
import type Stripe from "stripe";
import {
  getStripe,
  paymentMethodFromSession,
  AUTORECHARGE_KIND,
} from "@/lib/stripe";
import { depositPurchase } from "@/lib/credits";
import {
  depositAutoRecharge,
  setStripeCustomerId,
  setDefaultPaymentMethod,
} from "@/lib/autorecharge";
import { ipRateLimit } from "@/lib/ip-rate-limit";
import { reportError } from "@/lib/observability";

/**
 * Save the Stripe Customer + PaymentMethod from a completed Checkout session
 * onto the user, so auto-recharge can use the card later.
 * Throws on failure to trigger a Stripe webhook retry (depositPurchase is idempotent).
 */
async function persistSavedCard(session: Stripe.Checkout.Session, userId: string) {
  try {
    const customerId =
      typeof session.customer === "string"
        ? session.customer
        : session.customer?.id ?? null;
    if (customerId) await setStripeCustomerId(userId, customerId);
    const pmId = await paymentMethodFromSession(session);
    if (pmId) await setDefaultPaymentMethod(userId, pmId);
  } catch (error) {
    reportError("Failed to save card from checkout session", error, {
      sessionId: session.id,
    });
    throw error;
  }
}

// No Clerk session on this request (Stripe is calling us), so it's exempt
// from src/proxy.ts's middleware and per-user limits. The signature check
// below is the real gate; this just bounds volume/cost per IP — kept high
// because Stripe's webhook infra shares egress IPs across customers.
const WEBHOOK_LIMIT = 120;
const WEBHOOK_WINDOW_SECONDS = 60;

/**
 * POST /api/webhooks/stripe
 *
 * Credits purchases. Stripe POSTs `checkout.session.completed` here; the
 * session metadata (userId, creditMicros) was written server-side at session
 * creation (billing/checkout route), so it's trustworthy once the signature
 * verifies. The deposit is idempotent on the session id — Stripe retries
 * deliveries, and a duplicate must not double-credit.
 *
 * Non-retryable problems (malformed metadata) return 200 on purpose: a 5xx
 * would make Stripe retry a permanently bad event for days.
 */
export async function POST(request: Request) {
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!webhookSecret) {
    console.error("STRIPE_WEBHOOK_SECRET environment variable is not set.");
    return NextResponse.json(
      { error: "Server configuration error." },
      { status: 500 }
    );
  }

  const signature = request.headers.get("stripe-signature");
  if (!signature) {
    return NextResponse.json(
      { error: "Missing stripe-signature header." },
      { status: 400 }
    );
  }

  const limit = await ipRateLimit(request, "webhook-stripe", WEBHOOK_LIMIT, WEBHOOK_WINDOW_SECONDS);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Too many webhook requests." },
      { status: 429 }
    );
  }

  // Raw body — the signature covers the exact bytes, so .json() would break it.
  const body = await request.text();

  let event: Stripe.Event;
  try {
    event = getStripe().webhooks.constructEvent(body, signature, webhookSecret);
  } catch {
    return NextResponse.json(
      { error: "Invalid webhook signature." },
      { status: 400 }
    );
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object;
    console.log(`[Stripe Webhook] Received checkout.session.completed for session ${session.id}. Payment status: ${session.payment_status}`);

    // Card payments are paid at completion; async methods (bank debits etc.)
    // would arrive unpaid here and complete via async_payment_succeeded,
    // which we deliberately don't sell through — card-only scope.
    if (session.payment_status !== "paid") {
      console.log(`[Stripe Webhook] Ignored because payment_status is '${session.payment_status}', not 'paid'.`);
      return NextResponse.json({ received: true });
    }

    const userId = session.metadata?.userId ?? session.client_reference_id;
    const creditMicros = Number(session.metadata?.creditMicros);

    console.log(`[Stripe Webhook] Parsed metadata - userId: ${userId}, creditMicros: ${creditMicros}`);

    if (!userId || !Number.isInteger(creditMicros) || creditMicros <= 0) {
      console.log(`[Stripe Webhook] ERROR: Missing or malformed metadata. Ignored.`);
      reportError(
        "Stripe checkout.session.completed with missing/malformed metadata",
        new Error("unusable checkout session metadata"),
        { sessionId: session.id }
      );
      return NextResponse.json({ received: true });
    }

    try {
      console.log(`[Stripe Webhook] Attempting depositPurchase for user ${userId}, creditMicros: ${creditMicros}`);
      const deposited = await depositPurchase(userId, creditMicros, session.id);
      if (!deposited) {
        console.warn(`[Stripe Webhook] Duplicate Stripe webhook delivery for session ${session.id} — ignored.`);
      } else {
        console.log(`[Stripe Webhook] SUCCESS: depositPurchase completed for session ${session.id}`);
      }
    } catch (error) {
      console.error(`[Stripe Webhook] ERROR during depositPurchase:`, error);
      // A transient DB failure IS worth a Stripe retry — the deposit is
      // idempotent, so the retry can only succeed once.
      reportError("Failed to credit Stripe purchase", error, {
        sessionId: session.id,
      });
      return NextResponse.json(
        { error: "Failed to record purchase." },
        { status: 500 }
      );
    }

    // Save the card off-session for auto-recharge (ADR 0002/0002).
    // Throws on failure to trigger a Stripe retry; depositPurchase above is idempotent.
    await persistSavedCard(session, userId);
  } else if (event.type === "payment_intent.succeeded") {
    // Auto-recharge deposit — idempotent backstop to the sweep's own deposit
    // (both key on the PaymentIntent id, so at most one credit). Bundle-purchase
    // PaymentIntents are credited via checkout.session.completed above, so we
    // only act on auto-recharge PIs here.
    const pi = event.data.object;
    if (pi.metadata?.kind === AUTORECHARGE_KIND) {
      const userId = pi.metadata?.userId;
      const amountMicros = Number(pi.metadata?.amountMicros);
      if (!userId || !Number.isInteger(amountMicros) || amountMicros <= 0) {
        reportError(
          "auto_recharge payment_intent.succeeded with bad metadata",
          new Error("unusable auto-recharge PI metadata"),
          { paymentIntentId: pi.id }
        );
        return NextResponse.json({ received: true });
      }
      try {
        await depositAutoRecharge(userId, amountMicros, pi.id);
      } catch (error) {
        // Retryable — idempotent on the PI id, so a Stripe retry is safe.
        reportError("Failed to credit auto-recharge", error, {
          paymentIntentId: pi.id,
        });
        return NextResponse.json(
          { error: "Failed to record auto-recharge." },
          { status: 500 }
        );
      }
    }
  } else if (event.type === "payment_intent.payment_failed") {
    // Off-session auto-recharge declines are counted synchronously by the sweep
    // (see api/cron/autorecharge), which catches every decline including
    // authentication_required. This handler only logs, to avoid double-counting.
    const pi = event.data.object;
    if (pi.metadata?.kind === AUTORECHARGE_KIND) {
      console.warn(
        `[Stripe Webhook] auto-recharge payment_intent.payment_failed for ${pi.id} ` +
          `(counted by the sweep, not here).`
      );
    }
  } else if (event.type === "setup_intent.succeeded") {
    // The settings "add / replace card" flow confirmed a card off-session.
    const si = event.data.object;
    const userId = si.metadata?.userId;
    const pmId =
      typeof si.payment_method === "string"
        ? si.payment_method
        : si.payment_method?.id ?? null;
    if (userId && pmId) {
      try {
        await setDefaultPaymentMethod(userId, pmId);
      } catch (error) {
        reportError("Failed to save card from setup intent", error, {
          setupIntentId: si.id,
        });
        return NextResponse.json(
          { error: "Failed to save card." },
          { status: 500 }
        );
      }
    }
  } else {
    console.log(`[Stripe Webhook] Ignored unhandled event type: ${event.type}`);
  }

  return NextResponse.json({ received: true });
}
