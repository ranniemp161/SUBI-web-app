import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const state = vi.hoisted(() => ({
  rateAllowed: true,
  verifyImpl: (() => ({ type: "user.created", data: {} })) as (
    body: string,
    headers: Record<string, string>
  ) => { type: string; data: Record<string, unknown> },
  deletedUserIds: [] as string[],
  provisionCalls: [] as Array<{
    clerkId: string;
    email: string;
    code: string | undefined;
  }>,
  // Emulates provisionMemberWithCode: only this code redeems successfully.
  validCode: "SKOOL-AAAA-BBBB",
}));

vi.mock("@/lib/rate-limit", () => ({
  rateLimit: vi.fn(async () => ({
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

vi.mock("@clerk/nextjs/server", () => ({
  clerkClient: vi.fn(async () => ({
    users: {
      deleteUser: vi.fn(async (id: string) => {
        state.deletedUserIds.push(id);
      }),
    },
  })),
}));

vi.mock("@/lib/access-codes", () => ({
  provisionMemberWithCode: vi.fn(
    async (clerkId: string, email: string, code: string | undefined) => {
      state.provisionCalls.push({ clerkId, email, code });
      if (code !== state.validCode) return null;
      return { id: "db-user-1", clerkId, email, isMember: true, creditSeconds: 0 };
    }
  ),
}));

import { POST } from "./route";
import { rateLimit } from "@/lib/rate-limit";

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
  state.deletedUserIds = [];
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
    expect(rateLimit).not.toHaveBeenCalled();
  });

  it("400 when svix headers are missing (never touches the rate limiter)", async () => {
    const res = await POST(req({}, { headers: false }));
    expect(res.status).toBe(400);
    expect(rateLimit).not.toHaveBeenCalled();
  });

  it("429 once the per-IP limit is exceeded, before the signature is ever verified", async () => {
    state.rateAllowed = false;
    state.verifyImpl = vi.fn(() => ({ type: "user.created", data: {} }));
    const res = await POST(req({}, { ip: "198.51.100.20" }));
    expect(res.status).toBe(429);
    expect(rateLimit).toHaveBeenCalledWith("webhook-clerk:198.51.100.20", 120, 60);
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
  it("deletes the Clerk user when provisioning rejects the code", async () => {
    state.verifyImpl = () => ({
      type: "user.created",
      data: { id: "user_1", unsafe_metadata: { accessCode: "wrong" } },
    });
    const res = await POST(req({}));
    expect(res.status).toBe(200);
    expect(state.deletedUserIds).toEqual(["user_1"]);
    expect(state.provisionCalls).toEqual([
      { clerkId: "user_1", email: "", code: "wrong" },
    ]);
  });

  it("deletes the Clerk user when no code was provided at all", async () => {
    state.verifyImpl = () => ({
      type: "user.created",
      data: { id: "user_3", unsafe_metadata: {} },
    });
    const res = await POST(req({}));
    expect(res.status).toBe(200);
    expect(state.deletedUserIds).toEqual(["user_3"]);
    expect(state.provisionCalls).toEqual([
      { clerkId: "user_3", email: "", code: undefined },
    ]);
  });

  it("provisions a member (users row + redeemed code) when the code is valid", async () => {
    state.verifyImpl = () => ({
      type: "user.created",
      data: {
        id: "user_2",
        unsafe_metadata: { accessCode: ` ${state.validCode} ` },
        email_addresses: [{ id: "e1", email_address: "a@b.com" }],
        primary_email_address_id: "e1",
      },
    });
    const res = await POST(req({}));
    expect(res.status).toBe(200);
    expect(state.deletedUserIds).toEqual([]);
    // The raw metadata code is trimmed before redemption.
    expect(state.provisionCalls).toEqual([
      { clerkId: "user_2", email: "a@b.com", code: state.validCode },
    ]);
  });
});
