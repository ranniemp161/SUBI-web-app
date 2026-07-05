import { NextResponse } from "next/server";
import { getBundles } from "@/lib/stripe";
import { reportError } from "@/lib/observability";

/**
 * GET /api/billing/bundles — the purchasable credit bundles.
 *
 * Prices aren't user-specific or sensitive, so this is intentionally
 * unauthenticated and edge-cacheable — a CDN hit skips the function (and the
 * per-instance `bundlesCache` in stripe.ts) entirely. Checkout itself still
 * requires auth; this route only lists what's for sale.
 */
export async function GET() {
  try {
    return NextResponse.json(await getBundles(), {
      headers: {
        "Cache-Control": "public, s-maxage=300, stale-while-revalidate=3600",
      },
    });
  } catch (error) {
    reportError("Failed to load credit bundles from Stripe", error);
    return NextResponse.json(
      { error: "Failed to load credit bundles." },
      { status: 500 }
    );
  }
}
