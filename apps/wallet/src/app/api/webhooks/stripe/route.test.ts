import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const state = vi.hoisted(() => ({
  rateAllowed: true,
  // What constructEvent yields; a function so tests can make it throw.
  constructImpl: (() => ({ type: "other.event", data: { object: {} } })) as () => {
    type: string;
    data: { object: Record<string, unknown> };
  },
  deposits: [] as Array<{ userId: string; creditMicros: number; eventId: string }>,
  depositResult: true,
  depositError: false,
  reported: [] as string[],
  autoDeposits: [] as Array<{ userId: string; micros: number; eventId: string }>,
  savedCustomers: [] as Array<{ userId: string; customerId: string }>,
  savedPms: [] as Array<{ userId: string; pmId: string }>,
  sessionPm: "pm_from_session" as string | null,
  sessionCustomer: "cus_from_pi" as string | null,
  // What setStripeCustomerId "persists" as (simulates the COALESCE
  // first-write-wins) — override per test to simulate a concurrent checkout
  // that already claimed a different customer id for this user.
  storedCustomerId: null as string | null,
}));

vi.mock("@/lib/stripe", () => ({
  getStripe: () => ({
    webhooks: {
      constructEvent: vi.fn(() => state.constructImpl()),
    },
  }),
  paymentMethodFromSession: vi.fn(async () => ({
    paymentMethodId: state.sessionPm,
    customerId: state.sessionCustomer,
  })),
  AUTORECHARGE_KIND: "auto_recharge",
}));

vi.mock("@/lib/credits", () => ({
  depositPurchase: vi.fn(async (userId: string, creditMicros: number, eventId: string) => {
    if (state.depositError) throw new Error("db down");
    state.deposits.push({ userId, creditMicros, eventId });
    return state.depositResult;
  }),
}));

vi.mock("@/lib/autorecharge", () => ({
  depositAutoRecharge: vi.fn(async (userId: string, micros: number, eventId: string) => {
    state.autoDeposits.push({ userId, micros, eventId });
    return true;
  }),
  setStripeCustomerId: vi.fn(async (userId: string, customerId: string) => {
    state.savedCustomers.push({ userId, customerId });
    // First-write-wins: once storedCustomerId is set, it doesn't change.
    if (!state.storedCustomerId) state.storedCustomerId = customerId;
    return state.storedCustomerId;
  }),
  setDefaultPaymentMethod: vi.fn(async (userId: string, pmId: string) => {
    state.savedPms.push({ userId, pmId });
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
        metadata: { userId: "db-user-1", creditMicros: "19000000" },
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
  state.autoDeposits = [];
  state.savedCustomers = [];
  state.savedPms = [];
  state.sessionPm = "pm_from_session";
  state.sessionCustomer = "cus_from_pi";
  state.storedCustomerId = null;
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

  it("429 once the per-IP limit is exceeded (checked after the signature passes)", async () => {
    state.rateAllowed = false;
    const res = await POST(req({ ip: "198.51.100.30" }));
    expect(res.status).toBe(429);
    expect(rateLimit).toHaveBeenCalledWith("webhook-stripe:198.51.100.30", 120, 60);
  });

  it("400 on an invalid signature, without consuming a rate-limit slot", async () => {
    state.constructImpl = () => {
      throw new Error("bad signature");
    };
    const res = await POST(req());
    expect(res.status).toBe(400);
    expect(depositPurchase).not.toHaveBeenCalled();
    // Signature is verified BEFORE the limiter so unsigned junk can't burn
    // the Upstash command quota (fail-open caps depend on it staying alive).
    expect(rateLimit).not.toHaveBeenCalled();
  });
});

describe("POST /api/webhooks/stripe — checkout.session.completed", () => {
  it("credits the purchase keyed on the session id", async () => {
    completedSession();
    const res = await POST(req());
    expect(res.status).toBe(200);
    expect(state.deposits).toEqual([
      { userId: "db-user-1", creditMicros: 19000000, eventId: "cs_test_123" },
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
    completedSession({ metadata: { userId: "db-user-1", creditMicros: "banana" } });
    const res = await POST(req());
    expect(res.status).toBe(200);
    expect(depositPurchase).not.toHaveBeenCalled();
    expect(state.reported).toHaveLength(1);
  });

  it("falls back to client_reference_id when metadata has no userId", async () => {
    completedSession({
      metadata: { creditMicros: "5000000" },
      client_reference_id: "db-user-2",
    });
    const res = await POST(req());
    expect(res.status).toBe(200);
    expect(state.deposits).toEqual([
      { userId: "db-user-2", creditMicros: 5000000, eventId: "cs_test_123" },
    ]);
  });

  it("200 + Sentry report on negative or zero creditMicros", async () => {
    completedSession({ metadata: { userId: "db-user-1", creditMicros: "-50" } });
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

describe("POST /api/webhooks/stripe — checkout also saves the card", () => {
  it("persists the customer + payment method from the same PaymentIntent retrieval (AC-5)", async () => {
    state.sessionCustomer = "cus_123";
    completedSession();
    const res = await POST(req());
    expect(res.status).toBe(200);
    expect(state.savedCustomers).toEqual([{ userId: "db-user-1", customerId: "cus_123" }]);
    expect(state.savedPms).toEqual([{ userId: "db-user-1", pmId: "pm_from_session" }]);
  });

  it("does not save the payment method when a concurrent checkout already claimed a different customer id", async () => {
    // Simulates two interleaved first-time checkouts: an earlier delivery
    // already won the COALESCE and stuck the user to a different customer.
    state.storedCustomerId = "cus_won_first";
    state.sessionCustomer = "cus_this_event";
    state.sessionPm = "pm_belongs_to_this_event_customer";
    completedSession();
    const res = await POST(req());
    expect(res.status).toBe(200);
    expect(state.savedCustomers).toEqual([
      { userId: "db-user-1", customerId: "cus_this_event" },
    ]);
    // The payment method belongs to cus_this_event, but cus_won_first is what
    // stuck — saving it would attach a PM from the wrong customer.
    expect(state.savedPms).toEqual([]);
  });
});

describe("POST /api/webhooks/stripe — auto-recharge PaymentIntent (AC-6)", () => {
  function pi(metadata: Record<string, unknown>, amountReceived = 1900) {
    state.constructImpl = () => ({
      type: "payment_intent.succeeded",
      data: { object: { id: "pi_auto_1", metadata, amount_received: amountReceived } },
    });
  }

  it("credits an auto_recharge PI from the actually-captured amount, not metadata (idempotent backstop to the sweep)", async () => {
    // amount_received is in cents; metadata carries no amount at all now —
    // the credited value is derived only from what Stripe confirms captured.
    pi({ kind: "auto_recharge", userId: "db-user-1" }, 1900);
    const res = await POST(req());
    expect(res.status).toBe(200);
    expect(state.autoDeposits).toEqual([
      { userId: "db-user-1", micros: 19_000_000, eventId: "pi_auto_1" },
    ]);
  });

  it("ignores a non-auto-recharge PaymentIntent (bundle PIs are handled at checkout)", async () => {
    pi({});
    const res = await POST(req());
    expect(res.status).toBe(200);
    expect(state.autoDeposits).toHaveLength(0);
  });

  it("200 + Sentry report when amount_received is missing or zero", async () => {
    pi({ kind: "auto_recharge", userId: "db-user-1" }, 0);
    const res = await POST(req());
    expect(res.status).toBe(200);
    expect(state.autoDeposits).toHaveLength(0);
    expect(state.reported).toHaveLength(1);
  });
});

describe("POST /api/webhooks/stripe — setup_intent saves the card (AC-5)", () => {
  it("stores the confirmed payment method against the user", async () => {
    state.constructImpl = () => ({
      type: "setup_intent.succeeded",
      data: { object: { id: "seti_1", payment_method: "pm_new", metadata: { userId: "db-user-1" } } },
    });
    const res = await POST(req());
    expect(res.status).toBe(200);
    expect(state.savedPms).toEqual([{ userId: "db-user-1", pmId: "pm_new" }]);
  });
});

describe("POST /api/webhooks/stripe — other events", () => {
  it("acknowledges unhandled event types without depositing", async () => {
    const res = await POST(req());
    expect(res.status).toBe(200);
    expect(depositPurchase).not.toHaveBeenCalled();
  });
});
