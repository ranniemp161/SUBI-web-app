import { describe, it, expect, vi, beforeEach } from "vitest";

const state = vi.hoisted(() => ({
  clerkId: null as string | null,
  dbUser: null as { id: string; balanceMicros: number; isMember: boolean } | null,
  freshRows: [] as Record<string, unknown>[],
  grantCalls: [] as Array<{ userId: string; micros: number }>,
  readAllowed: true,
}));

vi.mock("@/lib/rate-limit", () => ({
  readRateLimit: vi.fn(async () => ({
    allowed: state.readAllowed,
    remaining: state.readAllowed ? 599 : 0,
    limit: 600,
  })),
}));

vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn(async () => ({ userId: state.clerkId })),
  currentUser: vi.fn(async () => null),
}));

vi.mock("@/lib/authz", () => ({
  getAuthorizedDbUser: vi.fn(async () => state.dbUser),
}));

vi.mock("@/lib/credits", () => ({
  memberGrantMicros: vi.fn(() => 19_000_000),
  ensureMonthlyGrant: vi.fn(async (userId: string, micros: number) => {
    state.grantCalls.push({ userId, micros });
  }),
}));

vi.mock("@/lib/observability", () => ({ reportError: vi.fn() }));

vi.mock("@repo/db", () => {
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
  state.readAllowed = true;
  vi.clearAllMocks();
});

describe("GET /api/credits", () => {
  it("401 when unauthenticated", async () => {
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it("429 when the shared read limit is exhausted", async () => {
    state.clerkId = "clerk_1";
    state.readAllowed = false;
    const res = await GET();
    expect(res.status).toBe(429);
  });

  it("403 without an authorized users row", async () => {
    state.clerkId = "clerk_1";
    const res = await GET();
    expect(res.status).toBe(403);
    expect(state.grantCalls).toEqual([]);
  });

  it("applies the lazy grant, then returns the post-grant balance", async () => {
    state.clerkId = "clerk_1";
    state.dbUser = { id: "db-user-1", balanceMicros: 0, isMember: true };
    state.freshRows = [{ balanceMicros: 19_000_000, isMember: true }];

    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(state.grantCalls).toEqual([{ userId: "db-user-1", micros: 19_000_000 }]);
    expect(body).toEqual({ balanceMicros: 19_000_000, isMember: true });
    // Per-user balance must never be cached by any proxy in front of the app.
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });

  it("falls back to the pre-grant row if the re-read comes back empty", async () => {
    state.clerkId = "clerk_1";
    state.dbUser = { id: "db-user-1", balanceMicros: 120_000, isMember: false };
    state.freshRows = [];

    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ balanceMicros: 120_000, isMember: false });
  });
});
