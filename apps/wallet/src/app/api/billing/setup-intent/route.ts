import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { getAuthorizedDbUser } from "@/lib/authz";
import { rateLimit } from "@/lib/rate-limit";
import { ensureStripeCustomer, createSetupIntent } from "@/lib/stripe";
import { setStripeCustomerId } from "@/lib/autorecharge";
import { reportError } from "@/lib/observability";

// Same generous cap as checkout — each call just mints a SetupIntent.
const SETUP_LIMIT = 10;
const SETUP_WINDOW_SECONDS = 3600;

/**
 * POST /api/billing/setup-intent — start the "add / replace card" flow.
 *
 * Ensures the user has a Stripe Customer, persists its id, and returns a
 * SetupIntent client secret for the client to confirm a card off-session
 * (the premium settings UI in child 0003 does the confirm). The saved card is
 * written onto the user by the `setup_intent.succeeded` webhook.
 */
export async function POST() {
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
      `setup-intent:${clerkId}`,
      SETUP_LIMIT,
      SETUP_WINDOW_SECONDS
    );
    if (!limit.allowed) {
      return NextResponse.json(
        { error: "Too many attempts. Please wait a bit and try again." },
        { status: 429 }
      );
    }

    const customerId = await ensureStripeCustomer(
      user.stripeCustomerId,
      user.email,
      user.id
    );
    if (customerId !== user.stripeCustomerId) {
      await setStripeCustomerId(user.id, customerId);
    }

    const { clientSecret } = await createSetupIntent(customerId, user.id);
    return NextResponse.json({ clientSecret });
  } catch (error) {
    reportError("Failed to create SetupIntent", error);
    return NextResponse.json(
      { error: "Failed to start card setup." },
      { status: 500 }
    );
  }
}
