import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getAuthorizedDbUser } from "@/lib/authz";
import { rateLimit } from "@/lib/rate-limit";
import { allowedPriceIds, creditSecondsFromPrice, getStripe } from "@/lib/stripe";
import { reportError } from "@/lib/observability";

// Sessions are free to create but each is a live payment page — cap how many
// a single user can mint.
const CHECKOUT_LIMIT = 10;
const CHECKOUT_WINDOW_SECONDS = 3600;

const checkoutSchema = z.object({ priceId: z.string().min(1) });

/**
 * POST /api/billing/checkout — create a Stripe Checkout session for a bundle.
 *
 * The session's metadata (our db userId + the bundle's credit_seconds) is
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

    const parsed = checkoutSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
    }

    const { priceId } = parsed.data;
    if (!allowedPriceIds().includes(priceId)) {
      return NextResponse.json({ error: "Unknown bundle." }, { status: 400 });
    }

    const stripe = getStripe();
    const price = await stripe.prices.retrieve(priceId);
    const creditSeconds = creditSecondsFromPrice(price);
    if (!creditSeconds) {
      reportError(
        "Checkout blocked: allowlisted price is missing credit_seconds metadata",
        new Error("misconfigured bundle price"),
        { priceId }
      );
      return NextResponse.json(
        { error: "This bundle is misconfigured." },
        { status: 500 }
      );
    }

    // Same origin convention as the deepgram route's callback URL.
    const origin = (process.env.PUBLIC_APP_URL ?? new URL(request.url).origin).replace(/\/+$/, "");

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${origin}/dashboard?checkout=success`,
      cancel_url: `${origin}/dashboard?checkout=cancelled`,
      client_reference_id: user.id,
      metadata: { userId: user.id, creditSeconds: String(creditSeconds) },
      customer_email: user.email || undefined,
    });

    return NextResponse.json({ url: session.url });
  } catch (error) {
    reportError("Failed to create Stripe checkout session", error);
    return NextResponse.json(
      { error: "Failed to start checkout." },
      { status: 500 }
    );
  }
}
