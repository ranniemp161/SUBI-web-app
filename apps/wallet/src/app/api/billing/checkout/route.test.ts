import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const state = vi.hoisted(() => ({
  clerkId: null as string | null,
  dbUser: null as { id: string; email: string } | null,
  rateAllowed: true,
  priceMetadata: { credit_seconds: "18000", tokens: "500" } as Record<string, string>,
  createdSessions: [] as Record<string, unknown>[],
}));

vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn(async () => ({ userId: state.clerkId })),
  currentUser: vi.fn(async () => null),
}));

vi.mock("@/lib/authz", () => ({
  getAuthorizedDbUser: vi.fn(async () => state.dbUser),
}));

vi.mock("@/lib/rate-limit", () => ({
  rateLimit: vi.fn(async () => ({
    allowed: state.rateAllowed,
    remaining: state.rateAllowed ? 9 : 0,
    limit: 10,
  })),
}));

vi.mock("@/lib/stripe", () => ({
  allowedPriceIds: vi.fn(() => ["price_small", "price_large"]),
  tokensFromPrice: vi.fn((price: { metadata?: Record<string, string> }) => {
    const n = Number(price.metadata?.tokens);
    return Number.isInteger(n) && n > 0 ? n : null;
  }),
  creditSecondsFromPrice: vi.fn((price: { metadata?: Record<string, string> }) => {
    const n = Number(price.metadata?.credit_seconds);
    return Number.isInteger(n) && n > 0 ? n : null;
  }),
  getStripe: () => ({
    prices: {
      retrieve: vi.fn(async (id: string) => ({ id, metadata: state.priceMetadata })),
    },
    checkout: {
      sessions: {
        create: vi.fn(async (params: Record<string, unknown>) => {
          state.createdSessions.push(params);
          return { url: "https://checkout.stripe.com/c/pay/cs_test_123" };
        }),
      },
    },
  }),
}));

vi.mock("@/lib/observability", () => ({ reportError: vi.fn() }));

vi.mock("@/lib/env", () => ({
  ROUGH_CUT_URL: "https://ruffcut.example.com"
}));

import { POST } from "./route";
import { rateLimit } from "@/lib/rate-limit";

function req(body?: unknown) {
  return new Request("http://localhost/api/billing/checkout", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function formReq(priceId: string) {
  const formData = new FormData();
  formData.append("priceId", priceId);
  return new Request("http://localhost/api/billing/checkout", {
    method: "POST",
    body: formData,
  });
}

beforeEach(() => {
  state.clerkId = null;
  state.dbUser = null;
  state.rateAllowed = true;
  state.priceMetadata = { credit_seconds: "18000", tokens: "500" };
  state.createdSessions = [];
  vi.clearAllMocks();
});

afterEach(() => {
  delete process.env.PUBLIC_APP_URL;
});

describe("POST /api/billing/checkout", () => {
  it("401 when unauthenticated", async () => {
    const res = await POST(req({ priceId: "price_small" }));
    expect(res.status).toBe(401);
  });

  it("403 without an authorized users row", async () => {
    state.clerkId = "clerk_1";
    const res = await POST(req({ priceId: "price_small" }));
    expect(res.status).toBe(403);
    expect(rateLimit).not.toHaveBeenCalled();
  });

  it("429 when the checkout rate limit is exceeded", async () => {
    state.clerkId = "clerk_1";
    state.dbUser = { id: "db-user-1", email: "a@b.com" };
    state.rateAllowed = false;
    const res = await POST(req({ priceId: "price_small" }));
    expect(res.status).toBe(429);
    expect(rateLimit).toHaveBeenCalledWith("checkout:clerk_1", 10, 3600);
  });

  it("400 on a missing or malformed body", async () => {
    state.clerkId = "clerk_1";
    state.dbUser = { id: "db-user-1", email: "a@b.com" };
    const res = await POST(req({}));
    expect(res.status).toBe(400);
  });

  it("400 on a missing form-data body", async () => {
    state.clerkId = "clerk_1";
    state.dbUser = { id: "db-user-1", email: "a@b.com" };
    const formData = new FormData();
    const res = await POST(new Request("http://localhost/api/billing/checkout", { method: "POST", body: formData }));
    expect(res.status).toBe(400);
  });

  it("400 on a price outside the allowlist", async () => {
    state.clerkId = "clerk_1";
    state.dbUser = { id: "db-user-1", email: "a@b.com" };
    const res = await POST(req({ priceId: "price_evil" }));
    expect(res.status).toBe(400);
    expect(state.createdSessions).toHaveLength(0);
  });

  it("500 when the allowlisted price is missing tokens metadata", async () => {
    state.clerkId = "clerk_1";
    state.dbUser = { id: "db-user-1", email: "a@b.com" };
    state.priceMetadata = {};
    const res = await POST(req({ priceId: "price_small" }));
    expect(res.status).toBe(500);
    expect(state.createdSessions).toHaveLength(0);
  });

  it("creates the session with server-written metadata and returns its url (JSON)", async () => {
    state.clerkId = "clerk_1";
    state.dbUser = { id: "db-user-1", email: "a@b.com" };

    const res = await POST(req({ priceId: "price_small" }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.url).toContain("checkout.stripe.com");
    expect(state.createdSessions).toHaveLength(1);
    const session = state.createdSessions[0];
    expect(session.mode).toBe("payment");
    expect(session.client_reference_id).toBe("db-user-1");
    expect(session.metadata).toEqual({ userId: "db-user-1", tokens: "500" });
    expect(session.customer_email).toBe("a@b.com");
    expect(session.success_url).toBe("https://ruffcut.example.com/dashboard?checkout=success");
    expect(session.cancel_url).toBe("https://ruffcut.example.com/dashboard?checkout=cancelled");
  });

  it("redirects 303 when requested via form-data", async () => {
    state.clerkId = "clerk_1";
    state.dbUser = { id: "db-user-1", email: "a@b.com" };

    const res = await POST(formReq("price_small"));

    expect(res.status).toBe(303);
    expect(res.headers.get("Location")).toContain("checkout.stripe.com");
    expect(state.createdSessions).toHaveLength(1);
    const session = state.createdSessions[0];
    expect(session.metadata).toEqual({ userId: "db-user-1", tokens: "500" });
  });
});
