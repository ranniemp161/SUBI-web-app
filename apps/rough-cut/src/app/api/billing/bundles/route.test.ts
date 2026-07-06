import { describe, it, expect, vi, beforeEach } from "vitest";

const state = vi.hoisted(() => ({
  bundles: [] as Record<string, unknown>[],
  bundlesError: false,
}));

vi.mock("@/lib/stripe", () => ({
  getBundles: vi.fn(async () => {
    if (state.bundlesError) throw new Error("stripe down");
    return state.bundles;
  }),
}));

vi.mock("@/lib/observability", () => ({ reportError: vi.fn() }));

import { GET } from "./route";

beforeEach(() => {
  state.bundles = [];
  state.bundlesError = false;
  vi.clearAllMocks();
});

describe("GET /api/billing/bundles", () => {
  it("returns the bundle list with an edge-cacheable header", async () => {
    state.bundles = [
      { priceId: "price_small", name: "60 minutes", amount: 500, currency: "usd", creditSeconds: 3600 },
    ];
    const res = await GET();
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual(state.bundles);
    expect(res.headers.get("Cache-Control")).toBe(
      "public, s-maxage=300, stale-while-revalidate=3600"
    );
  });

  it("500 when Stripe is unreachable", async () => {
    state.bundlesError = true;
    const res = await GET();
    expect(res.status).toBe(500);
  });
});
