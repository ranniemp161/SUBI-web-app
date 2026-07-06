import Stripe from "stripe";
import { reportError } from "@/lib/observability";

/**
 * Stripe wiring for one-time credit bundle purchases via Checkout.
 *
 * Bundles are Stripe Prices listed in the STRIPE_PRICE_IDS allowlist, each
 * carrying `metadata.credit_seconds`. Prices/amounts live entirely in the
 * Stripe dashboard — repricing or adding a bundle never needs a deploy, and
 * nothing outside the allowlist can be checked out.
 */

let stripeSingleton: Stripe | null = null;

/** Lazy singleton — constructing at module load would crash builds without the env. */
export function getStripe(): Stripe {
  if (!stripeSingleton) {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) throw new Error("STRIPE_SECRET_KEY is not set.");
    stripeSingleton = new Stripe(key);
  }
  return stripeSingleton;
}

/** Bundle Price-ID allowlist from STRIPE_PRICE_IDS (comma-separated). */
export function allowedPriceIds(): string[] {
  return (process.env.STRIPE_PRICE_IDS ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
}

export interface Bundle {
  priceId: string;
  name: string;
  /** Smallest currency unit (cents). */
  amount: number;
  currency: string;
  creditSeconds: number;
}

/** Positive-int parse of a Price's metadata.credit_seconds; null if malformed. */
export function creditSecondsFromPrice(price: {
  metadata?: Record<string, string>;
}): number | null {
  const n = Number(price.metadata?.credit_seconds);
  return Number.isInteger(n) && n > 0 ? n : null;
}

// Per-serverless-instance cache. Bundles change rarely (dashboard edits), so
// a short TTL keeps the buy popover snappy without a config redeploy path.
const BUNDLES_TTL_MS = 5 * 60 * 1000;
let bundlesCache: { at: number; bundles: Bundle[] } | null = null;

export async function getBundles(): Promise<Bundle[]> {
  if (bundlesCache && Date.now() - bundlesCache.at < BUNDLES_TTL_MS) {
    return bundlesCache.bundles;
  }

  const stripe = getStripe();
  const prices = await Promise.all(
    allowedPriceIds().map((id) => stripe.prices.retrieve(id, { expand: ["product"] }))
  );

  const bundles: Bundle[] = [];
  for (const price of prices) {
    const creditSeconds = creditSecondsFromPrice(price);
    if (!creditSeconds || price.unit_amount == null) {
      reportError(
        "Stripe price skipped: missing/malformed credit_seconds metadata or amount",
        new Error("misconfigured bundle price"),
        { priceId: price.id }
      );
      continue;
    }
    const product = price.product;
    const name =
      typeof product === "object" && product && "name" in product
        ? product.name
        : "Transcription credits";
    bundles.push({
      priceId: price.id,
      name,
      amount: price.unit_amount,
      currency: price.currency,
      creditSeconds,
    });
  }

  // Cheapest first — the natural display order for a pricing list.
  bundles.sort((a, b) => a.amount - b.amount);
  bundlesCache = { at: Date.now(), bundles };
  return bundles;
}

/** Test hook: drop the memoized bundle list. */
export function clearBundlesCache() {
  bundlesCache = null;
}
