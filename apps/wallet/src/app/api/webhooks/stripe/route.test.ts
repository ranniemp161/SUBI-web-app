import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const state = vi.hoisted(() => ({
  rateAllowed: true,
  // What constructEvent yields; a function so tests can make it throw.
  constructImpl: (() => ({ type: "other.event", data: { object: {} } })) as () => {
    type: string;
    data: { object: Record<string, unknown> };
  },
  deposits: [] as Array<{ userId: string; tokens: number; eventId: string }>,
  depositResult: true,
  depositError: false,
  reported: [] as string[],
}));

vi.mock("@/lib/stripe", () => ({
  getStripe: () => ({
    webhooks: {
      constructEvent: vi.fn(() => state.constructImpl()),
    },
  }),
}));

vi.mock("@/lib/credits", () => ({
  depositPurchase: vi.fn(async (userId: string, tokens: number, eventId: string) => {
    if (state.depositError) throw new Error("db down");
    state.deposits.push({ userId, tokens, eventId });
    return state.depositResult;
  }),
}));

vi.mock("@/lib/rate-limit", () => ({
  rateLimit: vi.fn(async () => ({
    allowed: state.rateAllowed,
    remaining: state.rateAllowed ? 119 : 0,
    limit: 120,
  })),
}));

vi.mock("@/lib/observability", () => ({
  reportError: vi.fn((message: string) => {
    state.reported.push(message);
  }),
}));

import { POST } from "./route";
import { rateLimit } from "@/lib/rate-limit";
import { depositPurchase } from "@/lib/credits";

function req({ signature = "sig_test", ip = "203.0.113.9" } = {}) {
  return new Request("http://localhost/api/webhooks/stripe", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": ip,
      ...(signature ? { "stripe-signature": signature } : {}),
    },
    body: JSON.stringify({ raw: "payload" }),
  });
}

function completedSession(overrides: Record<string, unknown> = {}) {
  state.constructImpl = () => ({
    type: "checkout.session.completed",
    data: {
      object: {
        id: "cs_test_123",
        payment_status: "paid",
        client_reference_id: null,
        metadata: { userId: "db-user-1", tokens: "500" },
        ...overrides,
      },
    },
  });
}

beforeEach(() => {
  state.rateAllowed = true;
  state.constructImpl = () => ({ type: "other.event", data: { object: {} } });
  state.deposits = [];
  state.depositResult = true;
  state.depositError = false;
  state.reported = [];
  vi.clearAllMocks();
  process.env.STRIPE_WEBHOOK_SECRET = "whsec_test";
});

afterEach(() => {
  delete process.env.STRIPE_WEBHOOK_SECRET;
});

describe("POST /api/webhooks/stripe — request guards", () => {
  it("500 when STRIPE_WEBHOOK_SECRET is unset (never touches the rate limiter)", async () => {
    delete process.env.STRIPE_WEBHOOK_SECRET;
    const res = await POST(req());
    expect(res.status).toBe(500);
    expect(rateLimit).not.toHaveBeenCalled();
  });

  it("400 when the stripe-signature header is missing", async () => {
    const res = await POST(req({ signature: "" }));
    expect(res.status).toBe(400);
    expect(rateLimit).not.toHaveBeenCalled();
  });

  it("429 once the per-IP limit is exceeded, before the signature is verified", async () => {
    state.rateAllowed = false;
    const res = await POST(req({ ip: "198.51.100.30" }));
    expect(res.status).toBe(429);
    expect(rateLimit).toHaveBeenCalledWith("webhook-stripe:198.51.100.30", 120, 60);
  });

  it("400 on an invalid signature", async () => {
    state.constructImpl = () => {
      throw new Error("bad signature");
    };
    const res = await POST(req());
    expect(res.status).toBe(400);
    expect(depositPurchase).not.toHaveBeenCalled();
  });
});

describe("POST /api/webhooks/stripe — checkout.session.completed", () => {
  it("credits the purchase keyed on the session id", async () => {
    completedSession();
    const res = await POST(req());
    expect(res.status).toBe(200);
    expect(state.deposits).toEqual([
      { userId: "db-user-1", tokens: 500, eventId: "cs_test_123" },
    ]);
  });

  it("still 200 on a duplicate delivery (no double credit)", async () => {
    completedSession();
    state.depositResult = false;
    const res = await POST(req());
    expect(res.status).toBe(200);
  });

  it("ignores unpaid sessions (async payment methods are out of scope)", async () => {
    completedSession({ payment_status: "unpaid" });
    const res = await POST(req());
    expect(res.status).toBe(200);
    expect(depositPurchase).not.toHaveBeenCalled();
  });

  it("200 + Sentry report on malformed metadata — a retry can never fix it", async () => {
    completedSession({ metadata: { userId: "db-user-1", tokens: "banana" } });
    const res = await POST(req());
    expect(res.status).toBe(200);
    expect(depositPurchase).not.toHaveBeenCalled();
    expect(state.reported).toHaveLength(1);
  });

  it("falls back to client_reference_id when metadata has no userId", async () => {
    completedSession({
      metadata: { tokens: "100" },
      client_reference_id: "db-user-2",
    });
    const res = await POST(req());
    expect(res.status).toBe(200);
    expect(state.deposits).toEqual([
      { userId: "db-user-2", tokens: 100, eventId: "cs_test_123" },
    ]);
  });

  it("200 + Sentry report on negative or zero tokens", async () => {
    completedSession({ metadata: { userId: "db-user-1", tokens: "-50" } });
    const res = await POST(req());
    expect(res.status).toBe(200);
    expect(depositPurchase).not.toHaveBeenCalled();
    expect(state.reported).toHaveLength(1);
  });

  it("500 on a transient deposit failure so Stripe retries (idempotent)", async () => {
    completedSession();
    state.depositError = true;
    const res = await POST(req());
    expect(res.status).toBe(500);
  });
});

describe("POST /api/webhooks/stripe — other events", () => {
  it("acknowledges unhandled event types without depositing", async () => {
    const res = await POST(req());
    expect(res.status).toBe(200);
    expect(depositPurchase).not.toHaveBeenCalled();
  });
});
