import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const state = vi.hoisted(() => ({
  clerkId: null as string | null,
  dbUser: null as { id: string; email: string } | null,
  rateAllowed: true,
  priceMetadata: { credit_seconds: "18000" } as Record<string, string>,
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

import { POST } from "./route";
import { rateLimit } from "@/lib/rate-limit";

function req(body?: unknown) {
  return new Request("http://localhost/api/billing/checkout", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

beforeEach(() => {
  state.clerkId = null;
  state.dbUser = null;
  state.rateAllowed = true;
  state.priceMetadata = { credit_seconds: "18000" };
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

  it("400 on a price outside the allowlist", async () => {
    state.clerkId = "clerk_1";
    state.dbUser = { id: "db-user-1", email: "a@b.com" };
    const res = await POST(req({ priceId: "price_evil" }));
    expect(res.status).toBe(400);
    expect(state.createdSessions).toHaveLength(0);
  });

  it("500 when the allowlisted price is missing credit_seconds metadata", async () => {
    state.clerkId = "clerk_1";
    state.dbUser = { id: "db-user-1", email: "a@b.com" };
    state.priceMetadata = {};
    const res = await POST(req({ priceId: "price_small" }));
    expect(res.status).toBe(500);
    expect(state.createdSessions).toHaveLength(0);
  });

  it("creates the session with server-written metadata and returns its url", async () => {
    state.clerkId = "clerk_1";
    state.dbUser = { id: "db-user-1", email: "a@b.com" };
    process.env.PUBLIC_APP_URL = "https://ruffcut.example.com/";

    const res = await POST(req({ priceId: "price_small" }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.url).toContain("checkout.stripe.com");
    expect(state.createdSessions).toHaveLength(1);
    const session = state.createdSessions[0];
    expect(session.mode).toBe("payment");
    expect(session.client_reference_id).toBe("db-user-1");
    expect(session.metadata).toEqual({ userId: "db-user-1", creditSeconds: "18000" });
    expect(session.customer_email).toBe("a@b.com");
    // Trailing slash on PUBLIC_APP_URL is normalized away.
    expect(session.success_url).toBe("https://ruffcut.example.com/dashboard?checkout=success");
    expect(session.cancel_url).toBe("https://ruffcut.example.com/dashboard?checkout=cancelled");
  });
});
