import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const state = vi.hoisted(() => ({
  rateAllowed: true,
  verifyImpl: (() => ({ type: "user.created", data: {} })) as (
    body: string,
    headers: Record<string, string>
  ) => { type: string; data: Record<string, unknown> },
  provisionCalls: [] as Array<{
    clerkId: string;
    email: string;
  }>,
}));

vi.mock("@/lib/ip-rate-limit", () => ({
  ipRateLimit: vi.fn(async () => ({
    allowed: state.rateAllowed,
    remaining: state.rateAllowed ? 119 : 0,
    limit: 120,
  })),
}));

vi.mock("svix", () => ({
  Webhook: class {
    verify(body: string, headers: Record<string, string>) {
      return state.verifyImpl(body, headers);
    }
  },
}));

vi.mock("@/lib/users", () => ({
  provisionUser: vi.fn(
    async (clerkId: string, email: string) => {
      state.provisionCalls.push({ clerkId, email });
      return { id: "db-user-1", clerkId, email, isMember: true, balanceMicros: 0 };
    }
  ),
}));

import { POST } from "./route";
import { ipRateLimit } from "@/lib/ip-rate-limit";

function req(
  body: unknown,
  { headers = true, ip = "203.0.113.7" }: { headers?: boolean; ip?: string } = {}
) {
  return new Request("http://localhost/api/webhooks/clerk", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": ip,
      ...(headers
        ? { "svix-id": "id", "svix-timestamp": "ts", "svix-signature": "sig" }
        : {}),
    },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  state.rateAllowed = true;
  state.provisionCalls = [];
  state.verifyImpl = () => ({ type: "user.created", data: {} });
  vi.clearAllMocks();
  process.env.CLERK_WEBHOOK_SECRET = "whsec_test";
});

afterEach(() => {
  delete process.env.CLERK_WEBHOOK_SECRET;
});

describe("POST /api/webhooks/clerk — request guards", () => {
  it("500 when CLERK_WEBHOOK_SECRET is unset (never touches the rate limiter)", async () => {
    delete process.env.CLERK_WEBHOOK_SECRET;
    const res = await POST(req({}));
    expect(res.status).toBe(500);
    expect(ipRateLimit).not.toHaveBeenCalled();
  });

  it("400 when svix headers are missing (never touches the rate limiter)", async () => {
    const res = await POST(req({}, { headers: false }));
    expect(res.status).toBe(400);
    expect(ipRateLimit).not.toHaveBeenCalled();
  });

  it("429 once the per-IP limit is exceeded, before the signature is ever verified", async () => {
    state.rateAllowed = false;
    state.verifyImpl = vi.fn(() => ({ type: "user.created", data: {} }));
    const res = await POST(req({}, { ip: "198.51.100.20" }));
    expect(res.status).toBe(429);
    // Note: the test mock now intercepts ipRateLimit, which takes the Request object directly
    expect(ipRateLimit).toHaveBeenCalledWith(expect.any(Request), "webhook-clerk", 120, 60);
    expect(state.verifyImpl).not.toHaveBeenCalled();
  });

  it("400 on an invalid signature", async () => {
    state.verifyImpl = () => {
      throw new Error("bad signature");
    };
    const res = await POST(req({}));
    expect(res.status).toBe(400);
  });
});

describe("POST /api/webhooks/clerk — user.created handling", () => {
  it("provisions a user row when created", async () => {
    state.verifyImpl = () => ({
      type: "user.created",
      data: {
        id: "user_2",
        email_addresses: [{ id: "e1", email_address: "a@b.com" }],
        primary_email_address_id: "e1",
      },
    });
    const res = await POST(req({}));
    expect(res.status).toBe(200);
    expect(state.provisionCalls).toEqual([
      { clerkId: "user_2", email: "a@b.com" },
    ]);
  });

  it("falls back to the first email address if primary_email_address_id is not found", async () => {
    state.verifyImpl = () => ({
      type: "user.created",
      data: {
        id: "user_3",
        email_addresses: [{ id: "e1", email_address: "first@example.com" }, { id: "e2", email_address: "second@example.com" }],
        primary_email_address_id: "missing",
      },
    });
    const res = await POST(req({}));
    expect(res.status).toBe(200);
    expect(state.provisionCalls).toEqual([
      { clerkId: "user_3", email: "first@example.com" },
    ]);
  });

  it("skips provisioning and returns 200 when no email_addresses are present", async () => {
    state.verifyImpl = () => ({
      type: "user.created",
      data: {
        id: "user_4",
      },
    });
    const res = await POST(req({}));
    // The new behaviour: empty email guard fires, provisionUser is never called,
    // but we still return 200 so Clerk does not retry an unresolvable event.
    expect(res.status).toBe(200);
    expect(state.provisionCalls).toEqual([]);
  });
});
