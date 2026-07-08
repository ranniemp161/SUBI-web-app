import { loadStripe, type Stripe } from "@stripe/stripe-js";

let stripePromise: Promise<Stripe | null> | null = null;

/**
 * Client-side Stripe.js singleton, for confirming a SetupIntent with Elements.
 * Throws loudly if the publishable key is missing rather than silently
 * calling loadStripe("") — that would leave the card form permanently dead
 * (useStripe() stays null forever) with nothing in the UI or console to
 * explain why.
 */
export function getStripeClient(): Promise<Stripe | null> {
  if (!stripePromise) {
    const key = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;
    if (!key) {
      throw new Error(
        "NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY is not set — the card form cannot load."
      );
    }
    stripePromise = loadStripe(key);
  }
  return stripePromise;
}
