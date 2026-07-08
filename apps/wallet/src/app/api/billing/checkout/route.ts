import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getAuthorizedDbUser } from "@/lib/authz";
import { rateLimit } from "@/lib/rate-limit";
import { allowedPriceIds, creditMicrosFromPrice, getStripe } from "@/lib/stripe";
import { reportError } from "@/lib/observability";
import { ROUGH_CUT_URL } from "@/lib/env";

// Sessions are free to create but each is a live payment page — cap how many
// a single user can mint.
const CHECKOUT_LIMIT = 10;
const CHECKOUT_WINDOW_SECONDS = 3600;

const checkoutSchema = z.object({ priceId: z.string().min(1) });

/**
 * POST /api/billing/checkout — create a Stripe Checkout session for a bundle.
 *
 * The session's metadata (our db userId + the bundle's creditMicros) is
 * written HERE, server-side, from the allowlisted Price — that's what makes
 * it trustworthy when the webhook reads it back to credit the purchase.
 * Returns { url } for the client to redirect to Stripe's hosted page.
 */
export async function POST(request: Request) {
  const { userId: clerkId } = await auth();

  if (!clerkId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const user = await getAuthorizedDbUser(clerkId);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    const limit = await rateLimit(
      `checkout:${clerkId}`,
      CHECKOUT_LIMIT,
      CHECKOUT_WINDOW_SECONDS
    );
    if (!limit.allowed) {
      return NextResponse.json(
        { error: "Too many checkout attempts. Please wait a bit and try again." },
        { status: 429 }
      );
    }

    const contentType = request.headers.get("content-type") || "";
    let priceId: string | null = null;
    
    if (contentType.includes("application/x-www-form-urlencoded") || contentType.includes("multipart/form-data")) {
      const formData = await request.formData().catch(() => null);
      const parsed = checkoutSchema.safeParse({ priceId: formData?.get("priceId") });
      if (parsed.success) priceId = parsed.data.priceId;
    } else {
      const parsed = checkoutSchema.safeParse(await request.json().catch(() => null));
      if (parsed.success) priceId = parsed.data.priceId;
    }

    if (!priceId) {
      return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
    }
    if (!allowedPriceIds().includes(priceId)) {
      return NextResponse.json({ error: "Unknown bundle." }, { status: 400 });
    }

    const stripe = getStripe();
    const price = await stripe.prices.retrieve(priceId, { expand: ["product"] });
    const creditMicros = creditMicrosFromPrice(price);
    if (!creditMicros) {
      reportError(
        "Checkout blocked: allowlisted price is missing credit_micros metadata",
        new Error("misconfigured bundle price"),
        { priceId }
      );
      return NextResponse.json(
        { error: "This bundle is misconfigured." },
        { status: 500 }
      );
    }

    const origin = ROUGH_CUT_URL;

    // Save the card off-session so auto-recharge (ADR 0002/0002) can use it
    // later. Reuse the user's Stripe Customer if they have one; otherwise let
    // Checkout create one. setup_future_usage persists the PaymentMethod; the
    // webhook reads the customer + payment method back onto the users row.
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${origin}/dashboard?checkout=success`,
      cancel_url: `${origin}/dashboard?checkout=cancelled`,
      client_reference_id: user.id,
      metadata: { userId: user.id, creditMicros: String(creditMicros) },
      payment_intent_data: { setup_future_usage: "off_session" },
      ...(user.stripeCustomerId
        ? { customer: user.stripeCustomerId }
        : { customer_creation: "always", customer_email: user.email || undefined }),
    });

    if (contentType.includes("application/x-www-form-urlencoded") || contentType.includes("multipart/form-data")) {
      if (!session.url) throw new Error("No session URL returned");
      return NextResponse.redirect(session.url, 303);
    }
    return NextResponse.json({ url: session.url });
  } catch (error) {
    reportError("Failed to create Stripe checkout session", error);
    return NextResponse.json(
      { error: "Failed to start checkout." },
      { status: 500 }
    );
  }
}
