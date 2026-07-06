import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { getStripe } from "@/lib/stripe";
import { depositPurchase } from "@/lib/credits";
import { ipRateLimit } from "@/lib/ip-rate-limit";
import { reportError } from "@/lib/observability";

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
 * session metadata (userId, tokens) was written server-side at session
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

    // Card payments are paid at completion; async methods (bank debits etc.)
    // would arrive unpaid here and complete via async_payment_succeeded,
    // which we deliberately don't sell through — card-only scope.
    if (session.payment_status !== "paid") {
      return NextResponse.json({ received: true });
    }

    const userId = session.metadata?.userId ?? session.client_reference_id;
    const tokens = Number(session.metadata?.tokens);

    if (!userId || !Number.isInteger(tokens) || tokens <= 0) {
      reportError(
        "Stripe checkout.session.completed with missing/malformed metadata",
        new Error("unusable checkout session metadata"),
        { sessionId: session.id }
      );
      return NextResponse.json({ received: true });
    }

    try {
      const deposited = await depositPurchase(userId, tokens, session.id);
      if (!deposited) {
        console.warn(`Duplicate Stripe webhook delivery for session ${session.id} — ignored.`);
      }
    } catch (error) {
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
  }

  return NextResponse.json({ received: true });
}
