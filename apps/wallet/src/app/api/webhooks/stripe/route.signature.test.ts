// @vitest-environment node
//
// The main route.test.ts mocks getStripe().webhooks.constructEvent entirely,
// which is correct for exercising the route's branching logic but never
// proves the actual cryptographic signature check works. This file uses the
// real `stripe` package (no mock on "@/lib/stripe") to sign a payload the
// same way Stripe's servers do and assert a tampered body, a tampered
// signature, or the wrong secret is genuinely rejected — the exact defect
// class (a broken/weakened constructEvent call) that a fully-mocked suite
// would let through silently.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import Stripe from "stripe";

vi.mock("@/lib/credits", () => ({
  depositPurchase: vi.fn(async () => true),
}));
vi.mock("@/lib/autorecharge", () => ({
  depositAutoRecharge: vi.fn(async () => true),
  setStripeCustomerId: vi.fn(async () => {}),
  setDefaultPaymentMethod: vi.fn(async () => {}),
}));
vi.mock("@/lib/ip-rate-limit", () => ({
  ipRateLimit: vi.fn(async () => ({ allowed: true, remaining: 119, limit: 120 })),
}));
vi.mock("@/lib/observability", () => ({
  reportError: vi.fn(),
}));

import { POST } from "./route";
import { depositPurchase } from "@/lib/credits";

const REAL_SECRET = "whsec_real_test_secret_do_not_use_in_prod";
const OTHER_SECRET = "whsec_a_different_secret";

// An event type the route doesn't act on, so a valid signature only needs to
// prove verification succeeded (200 + no deposit), not exercise business logic.
const payload = JSON.stringify({
  id: "evt_test_1",
  type: "other.event",
  data: { object: {} },
});

function signedRequest(body: string, secret: string) {
  const header = Stripe.webhooks.generateTestHeaderString({
    payload: body,
    secret,
  });
  return new Request("http://localhost/api/webhooks/stripe", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": "203.0.113.9",
      "stripe-signature": header,
    },
    body,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.STRIPE_WEBHOOK_SECRET = REAL_SECRET;
  process.env.STRIPE_SECRET_KEY = "sk_test_dummy_key_for_local_hmac_only";
});

afterEach(() => {
  delete process.env.STRIPE_WEBHOOK_SECRET;
  delete process.env.STRIPE_SECRET_KEY;
});

describe("POST /api/webhooks/stripe — real signature verification (unmocked)", () => {
  it("accepts a request genuinely signed with the configured secret", async () => {
    const res = await POST(signedRequest(payload, REAL_SECRET));
    expect(res.status).toBe(200);
  });

  it("rejects a body tampered with after signing (signature no longer matches)", async () => {
    const header = Stripe.webhooks.generateTestHeaderString({
      payload,
      secret: REAL_SECRET,
    });
    const tamperedBody = JSON.stringify({
      id: "evt_test_1",
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_evil",
          payment_status: "paid",
          metadata: { userId: "victim-user", creditMicros: "999000000" },
        },
      },
    });
    const req = new Request("http://localhost/api/webhooks/stripe", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-forwarded-for": "203.0.113.9",
        "stripe-signature": header,
      },
      body: tamperedBody,
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    expect(depositPurchase).not.toHaveBeenCalled();
  });

  it("rejects a payload signed with a different secret than the server expects", async () => {
    const res = await POST(signedRequest(payload, OTHER_SECRET));
    expect(res.status).toBe(400);
    expect(depositPurchase).not.toHaveBeenCalled();
  });

  it("rejects a syntactically-plausible but forged signature header", async () => {
    const req = new Request("http://localhost/api/webhooks/stripe", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-forwarded-for": "203.0.113.9",
        "stripe-signature": `t=${Math.floor(Date.now() / 1000)},v1=${"0".repeat(64)}`,
      },
      body: payload,
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    expect(depositPurchase).not.toHaveBeenCalled();
  });
});
