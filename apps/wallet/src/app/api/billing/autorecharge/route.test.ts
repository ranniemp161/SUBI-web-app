import { describe, it, expect, vi, beforeEach } from "vitest";

type DbUser = {
  id: string;
  defaultPaymentMethodId: string | null;
  autorechargeEnabled: boolean;
  autorechargeThresholdMicros: number | null;
  autorechargeAmountMicros: number | null;
  autorechargeFailures: number;
};

const state = vi.hoisted(() => ({
  clerkId: null as string | null,
  dbUser: null as DbUser | null,
  rateAllowed: true,
  saved: [] as unknown[],
}));

vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn(async () => ({ userId: state.clerkId })),
}));
vi.mock("@/lib/authz", () => ({
  getAuthorizedDbUser: vi.fn(async () => state.dbUser),
}));
vi.mock("@/lib/rate-limit", () => ({
  rateLimit: vi.fn(async () => ({
    allowed: state.rateAllowed,
    remaining: state.rateAllowed ? 19 : 0,
    limit: 20,
  })),
}));
vi.mock("@/lib/autorecharge", () => ({
  updateAutorechargeSettings: vi.fn(async (userId: string, s: unknown) => {
    state.saved.push({ userId, s });
  }),
}));
vi.mock("@/lib/observability", () => ({ reportError: vi.fn() }));

import { GET, PATCH } from "./route";

function patchReq(body?: unknown) {
  return new Request("http://localhost/api/billing/autorecharge", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

const withCard: DbUser = {
  id: "db-user-1",
  defaultPaymentMethodId: "pm_1",
  autorechargeEnabled: false,
  autorechargeThresholdMicros: null,
  autorechargeAmountMicros: null,
  autorechargeFailures: 0,
};

beforeEach(() => {
  state.clerkId = null;
  state.dbUser = null;
  state.rateAllowed = true;
  state.saved = [];
  vi.clearAllMocks();
});

describe("GET /api/billing/autorecharge", () => {
  it("401 when unauthenticated", async () => {
    expect((await GET()).status).toBe(401);
  });

  it("403 without an authorized users row", async () => {
    state.clerkId = "clerk_1";
    expect((await GET()).status).toBe(403);
  });

  it("returns the settings shape with hasCard derived from the saved card", async () => {
    state.clerkId = "clerk_1";
    state.dbUser = {
      ...withCard,
      autorechargeEnabled: true,
      autorechargeThresholdMicros: 5_000_000,
      autorechargeAmountMicros: 19_000_000,
    };
    const res = await GET();
    const body = await res.json();
    expect(body).toEqual({
      enabled: true,
      thresholdMicros: 5_000_000,
      amountMicros: 19_000_000,
      hasCard: true,
      failures: 0,
    });
    // Per-user billing settings must never be cached by any proxy in front.
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });
});

describe("PATCH /api/billing/autorecharge", () => {
  // covers: AC-5 — enable needs a saved card, amount must exceed the threshold.
  it("401 when unauthenticated", async () => {
    expect((await PATCH(patchReq({}))).status).toBe(401);
  });

  it("429 when rate limited", async () => {
    state.clerkId = "clerk_1";
    state.dbUser = withCard;
    state.rateAllowed = false;
    expect((await PATCH(patchReq({ enabled: false, thresholdMicros: 1, amountMicros: 2 }))).status).toBe(429);
  });

  it("400 on a malformed body", async () => {
    state.clerkId = "clerk_1";
    state.dbUser = withCard;
    expect((await PATCH(patchReq({ enabled: "yes" }))).status).toBe(400);
  });

  it("400 with NO_CARD when enabling without a saved card", async () => {
    state.clerkId = "clerk_1";
    state.dbUser = { ...withCard, defaultPaymentMethodId: null };
    const res = await PATCH(patchReq({ enabled: true, thresholdMicros: 5_000_000, amountMicros: 19_000_000 }));
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("NO_CARD");
    expect(state.saved).toHaveLength(0);
  });

  it("400 when the amount does not exceed the threshold", async () => {
    state.clerkId = "clerk_1";
    state.dbUser = withCard;
    const res = await PATCH(patchReq({ enabled: true, thresholdMicros: 5_000_000, amountMicros: 5_000_000 }));
    expect(res.status).toBe(400);
    expect(state.saved).toHaveLength(0);
  });

  it("400 when the amount exceeds the safety maximum", async () => {
    state.clerkId = "clerk_1";
    state.dbUser = withCard;
    const res = await PATCH(patchReq({ enabled: true, thresholdMicros: 5_000_000, amountMicros: 2_000_000_000 }));
    expect(res.status).toBe(400);
    expect(state.saved).toHaveLength(0);
  });

  it("200 and persists valid settings (amount > threshold, card present)", async () => {
    state.clerkId = "clerk_1";
    state.dbUser = withCard;
    const res = await PATCH(patchReq({ enabled: true, thresholdMicros: 5_000_000, amountMicros: 19_000_000 }));
    expect(res.status).toBe(200);
    expect(state.saved).toEqual([
      { userId: "db-user-1", s: { enabled: true, thresholdMicros: 5_000_000, amountMicros: 19_000_000 } },
    ]);
  });

  it("allows disabling without a card", async () => {
    state.clerkId = "clerk_1";
    state.dbUser = { ...withCard, defaultPaymentMethodId: null };
    const res = await PATCH(patchReq({ enabled: false, thresholdMicros: 5_000_000, amountMicros: 19_000_000 }));
    expect(res.status).toBe(200);
    expect(state.saved).toHaveLength(1);
  });
});
