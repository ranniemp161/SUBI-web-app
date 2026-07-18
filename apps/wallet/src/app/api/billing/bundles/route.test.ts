import { describe, it, expect, vi, beforeEach } from "vitest";

const state = vi.hoisted(() => ({
  bundles: [] as Record<string, unknown>[],
  bundlesError: false,
  rateAllowed: true,
}));

vi.mock("@/lib/stripe", () => ({
  getBundles: vi.fn(async () => {
    if (state.bundlesError) throw new Error("stripe down");
    return state.bundles;
  }),
}));

vi.mock("@/lib/ip-rate-limit", () => ({
  ipRateLimit: vi.fn(async () => ({
    allowed: state.rateAllowed,
    remaining: state.rateAllowed ? 59 : 0,
    limit: 60,
  })),
}));

vi.mock("@/lib/observability", () => ({ reportError: vi.fn() }));

import { GET } from "./route";
import { getBundles } from "@/lib/stripe";
import { ipRateLimit } from "@/lib/ip-rate-limit";

function req(ip = "203.0.113.9") {
  return new Request("http://localhost/api/billing/bundles", {
    headers: { "x-forwarded-for": ip },
  });
}

beforeEach(() => {
  state.bundles = [];
  state.bundlesError = false;
  state.rateAllowed = true;
  vi.clearAllMocks();
});

describe("GET /api/billing/bundles", () => {
  it("returns the bundle list with an edge-cacheable header", async () => {
    state.bundles = [
      { priceId: "price_small", name: "60 minutes", amount: 500, currency: "usd", creditSeconds: 3600 },
    ];
    const res = await GET(req());
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual(state.bundles);
    expect(res.headers.get("Cache-Control")).toBe(
      "public, s-maxage=300, stale-while-revalidate=3600"
    );
  });

  it("429 once the per-IP limit is exceeded, before Stripe is ever touched", async () => {
    state.rateAllowed = false;
    const res = await GET(req("198.51.100.40"));
    expect(res.status).toBe(429);
    expect(ipRateLimit).toHaveBeenCalledWith(expect.any(Request), "bundles", 60, 60);
    expect(getBundles).not.toHaveBeenCalled();
    // A cached 429 under the shared CDN key would serve the error to
    // well-behaved clients for 300s — it must never be cacheable.
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });

  it("500 when Stripe is unreachable", async () => {
    state.bundlesError = true;
    const res = await GET(req());
    expect(res.status).toBe(500);
  });
});
