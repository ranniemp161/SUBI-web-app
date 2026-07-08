import Stripe from "stripe";
import { chargeMicrosForSeconds } from "@repo/ui";
import { reportError } from "@/lib/observability";

/**
 * Stripe wiring for one-time credit bundle purchases via Checkout.
 *
 * Bundles are Stripe Prices listed in the STRIPE_PRICE_IDS allowlist, each
 * carrying `metadata.credit_micros` — the USD-micros balance to credit, which
 * is not the same as `unit_amount` (what the user pays) for the bonus tiers.
 * Prices/amounts and the credited balance live entirely in the Stripe dashboard
 * — repricing or adding a bundle never needs a deploy, and nothing outside the
 * allowlist can be checked out.
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
  /** Smallest currency unit (cents) — what the user pays. */
  amount: number;
  currency: string;
  /** USD micros credited to the balance (1,000,000 = $1); bonus tiers exceed `amount`. */
  creditMicros: number;
}

/**
 * The USD-micros balance a Price credits, from `metadata.credit_micros`.
 * Falls back to the legacy `metadata.tokens`/`credit_seconds` (seconds) times
 * the retail rate for prices not yet migrated to credit_micros. Null if malformed.
 */
export function creditMicrosFromPrice(price: Stripe.Price): number | null {
  const product = price.product as Stripe.Product | string;
  const productMetadata = typeof product === "object" ? product.metadata : null;

  // Check price metadata first, then product metadata.
  for (const metadata of [price.metadata, productMetadata]) {
    if (!metadata) continue;
    // Preferred: an explicit USD-micros balance.
    const micros = Number(metadata.credit_micros);
    if (Number.isInteger(micros) && micros > 0) return micros;
    // Legacy: a token/second count — convert at the retail rate.
    const legacySeconds = Number(metadata.tokens || metadata.credit_seconds);
    if (Number.isInteger(legacySeconds) && legacySeconds > 0) {
      return chargeMicrosForSeconds(legacySeconds);
    }
  }
  return null;
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
    allowedPriceIds().map((id) => 
      stripe.prices.retrieve(id, { expand: ["product"] })
      .catch((err) => {
        reportError("Failed to retrieve Stripe price", err instanceof Error ? err : new Error(String(err)), { priceId: id });
        return null;
      })
    )
  );

  const bundles: Bundle[] = [];
  for (const price of prices) {
    if (!price) continue;
    const creditMicros = creditMicrosFromPrice(price);
    if (!creditMicros || price.unit_amount == null) {
      reportError(
        "Stripe price skipped: missing/malformed credit_micros metadata or amount",
        new Error("misconfigured bundle price"),
        { priceId: price.id }
      );
      continue;
    }
    const product = price.product;
    const name =
      typeof product === "object" && product && "name" in product
        ? product.name
        : "Wallet credit";
    bundles.push({
      priceId: price.id,
      name,
      amount: price.unit_amount,
      currency: price.currency,
      creditMicros,
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

// ---------------------------------------------------------------------------
// Off-session auto-recharge (ADR 0002/0002)
// ---------------------------------------------------------------------------

/** Metadata key marking a PaymentIntent as an auto-recharge (read by the webhook). */
export const AUTORECHARGE_KIND = "auto_recharge";

/**
 * USD micros -> Stripe's minor unit (cents). 10,000 micros = 1 cent. Retail
 * bundle amounts are whole-cent multiples, so this is exact there; an
 * auto-recharge amount is a user-chosen integer that is NOT constrained to
 * whole cents, so this can genuinely round. That's safe only because the
 * webhook credits back `amount_received * 10,000` — what Stripe actually
 * captured after this same rounding — rather than the pre-rounding metadata
 * value, so the charged and credited amounts can never drift apart.
 */
export function microsToStripeMinorUnit(micros: number): number {
  return Math.round(micros / 10_000);
}

/** Create the Stripe Customer for a user if they don't have one yet; return its id. */
export async function ensureStripeCustomer(
  existingCustomerId: string | null,
  email: string | null,
  dbUserId: string
): Promise<string> {
  if (existingCustomerId) return existingCustomerId;
  const customer = await getStripe().customers.create({
    email: email || undefined,
    metadata: { dbUserId },
  });
  return customer.id;
}

/**
 * SetupIntent for the settings "add / replace card" path: lets the client
 * confirm a card for later off-session use without a payment.
 */
export async function createSetupIntent(
  customerId: string,
  userId: string
): Promise<{ clientSecret: string | null; setupIntentId: string }> {
  const si = await getStripe().setupIntents.create({
    customer: customerId,
    usage: "off_session",
    payment_method_types: ["card"],
    metadata: { userId },
  });
  return { clientSecret: si.client_secret, setupIntentId: si.id };
}

/**
 * Charge a saved card off-session for an auto-recharge. Idempotent on the
 * provided key so a sweep re-run cannot double-charge. Metadata carries the
 * userId + amount so the webhook can deposit reason `auto_recharge`.
 * Throws a Stripe card error on a synchronous decline (caller handles it).
 */
export async function chargeAutoRechargeOffSession(params: {
  customerId: string;
  paymentMethodId: string;
  amountMicros: number;
  userId: string;
  idempotencyKey: string;
}): Promise<Stripe.PaymentIntent> {
  const { customerId, paymentMethodId, amountMicros, userId, idempotencyKey } =
    params;
  return getStripe().paymentIntents.create(
    {
      amount: microsToStripeMinorUnit(amountMicros),
      currency: "usd",
      customer: customerId,
      payment_method: paymentMethodId,
      off_session: true,
      confirm: true,
      metadata: {
        kind: AUTORECHARGE_KIND,
        userId,
        amountMicros: String(amountMicros),
      },
    },
    { idempotencyKey }
  );
}

/**
 * The saved PaymentMethod id and its owning Customer id from a completed
 * Checkout session, both read off the *same* PaymentIntent retrieval.
 *
 * Deliberately not sourced from `session.customer` for the customer id: two
 * concurrent first-time checkouts (each creating its own Customer) can have
 * their webhook deliveries interleave, and reading the PM from one session
 * while separately trusting `session.customer` from the (possibly different,
 * already-written) event can bind a payment method to the wrong customer —
 * a later off-session charge then fails with "payment method does not
 * belong to customer". Sourcing both fields from one PI retrieval makes them
 * always consistent with each other by construction.
 */
export async function paymentMethodFromSession(
  session: Stripe.Checkout.Session
): Promise<{ paymentMethodId: string | null; customerId: string | null }> {
  const piId =
    typeof session.payment_intent === "string"
      ? session.payment_intent
      : session.payment_intent?.id;
  if (!piId) return { paymentMethodId: null, customerId: null };
  const pi = await getStripe().paymentIntents.retrieve(piId);
  const paymentMethodId =
    typeof pi.payment_method === "string"
      ? pi.payment_method
      : pi.payment_method?.id ?? null;
  const customerId =
    typeof pi.customer === "string" ? pi.customer : pi.customer?.id ?? null;
  return { paymentMethodId, customerId };
}

// ---------------------------------------------------------------------------
// Saved-card display (ADR 0002/0003 — premium wallet UI)
// ---------------------------------------------------------------------------

export interface SavedCard {
  brand: string;
  last4: string;
}

/**
 * Retrieve the saved card's brand and last4 for display in the auto-recharge
 * panel. Returns null if the payment method doesn't exist or has no card data.
 * Never returns sensitive card details — just the display-safe fields.
 */
export async function getSavedCard(
  paymentMethodId: string | null | undefined
): Promise<SavedCard | null> {
  if (!paymentMethodId) return null;
  try {
    const pm = await getStripe().paymentMethods.retrieve(paymentMethodId);
    const card = pm.card;
    if (!card) return null;
    return { brand: card.brand, last4: card.last4 };
  } catch {
    return null;
  }
}
