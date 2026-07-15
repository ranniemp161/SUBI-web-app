import { NextResponse } from "next/server";
import { getBundles } from "@/lib/stripe";
import { ipRateLimit } from "@/lib/ip-rate-limit";
import { reportError } from "@/lib/observability";

// Legitimate traffic almost never reaches this function (the CDN serves it
// for 300s), so a real client should hit it about once per session. The cap
// exists because the cache is keyed on the full URL: junk query strings
// (`?r=<random>`) miss the CDN every time, and without a limiter each miss
// is a free function invocation — on Hobby, the budget whose exhaustion
// pauses the whole deployment (see the 2026-07-15 DDoS review).
const BUNDLES_LIMIT = 60;
const BUNDLES_WINDOW_SECONDS = 60;

/**
 * GET /api/billing/bundles — the purchasable credit bundles.
 *
 * Prices aren't user-specific or sensitive, so this is intentionally
 * unauthenticated and edge-cacheable — a CDN hit skips the function (and the
 * per-instance `bundlesCache` in stripe.ts) entirely. Checkout itself still
 * requires auth; this route only lists what's for sale.
 */
export async function GET(request: Request) {
  try {
    const limit = await ipRateLimit(request, "bundles", BUNDLES_LIMIT, BUNDLES_WINDOW_SECONDS);
    if (!limit.allowed) {
      return NextResponse.json(
        { error: "Too many requests." },
        // Not cacheable: a 429 stored under a shared CDN key would serve the
        // rate-limit error to well-behaved clients for 300s.
        { status: 429, headers: { "Cache-Control": "no-store" } }
      );
    }

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
