import { describe, it, expect, vi, beforeEach } from "vitest";

const state = vi.hoisted(() => ({
  clerkId: null as string | null,
  dbUser: null as { id: string; creditSeconds: number; isMember: boolean } | null,
  freshRows: [] as Record<string, unknown>[],
  grantCalls: [] as Array<{ userId: string; seconds: number }>,
}));

vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn(async () => ({ userId: state.clerkId })),
  currentUser: vi.fn(async () => null),
}));

vi.mock("@/lib/authz", () => ({
  getAuthorizedDbUser: vi.fn(async () => state.dbUser),
}));

vi.mock("@/lib/credits", () => ({
  memberGrantSeconds: vi.fn(() => 3600),
  ensureMonthlyGrant: vi.fn(async (userId: string, seconds: number) => {
    state.grantCalls.push({ userId, seconds });
  }),
}));

vi.mock("@/lib/observability", () => ({ reportError: vi.fn() }));

vi.mock("@/db", () => {
  function chain(result: () => unknown) {
    const proxy: unknown = new Proxy(function () {}, {
      get(_t, prop) {
        if (prop === "then") {
          return (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
            Promise.resolve(result()).then(res, rej);
        }
        return () => proxy;
      },
    });
    return proxy;
  }
  return {
    db: { select: () => chain(() => state.freshRows) },
    withDbRetry: (fn: () => unknown) => fn(),
  };
});

import { GET } from "./route";

beforeEach(() => {
  state.clerkId = null;
  state.dbUser = null;
  state.freshRows = [];
  state.grantCalls = [];
  vi.clearAllMocks();
});

describe("GET /api/credits", () => {
  it("401 when unauthenticated", async () => {
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it("403 without an authorized users row", async () => {
    state.clerkId = "clerk_1";
    const res = await GET();
    expect(res.status).toBe(403);
    expect(state.grantCalls).toEqual([]);
  });

  it("applies the lazy grant, then returns the post-grant balance", async () => {
    state.clerkId = "clerk_1";
    state.dbUser = { id: "db-user-1", creditSeconds: 0, isMember: true };
    state.freshRows = [{ creditSeconds: 3600, isMember: true }];

    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(state.grantCalls).toEqual([{ userId: "db-user-1", seconds: 3600 }]);
    expect(body).toEqual({ creditSeconds: 3600, isMember: true });
  });

  it("falls back to the pre-grant row if the re-read comes back empty", async () => {
    state.clerkId = "clerk_1";
    state.dbUser = { id: "db-user-1", creditSeconds: 120, isMember: false };
    state.freshRows = [];

    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ creditSeconds: 120, isMember: false });
  });
});
