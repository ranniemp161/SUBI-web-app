import { describe, it, expect, vi, beforeEach } from "vitest";

const state = vi.hoisted(() => ({
  selectRows: [] as Record<string, unknown>[],
  upsertedUser: {
    id: "db-user-1",
    clerkId: "clerk_1",
    email: "a@b.com",
    tokens: 0,
    isMember: false,
  } as Record<string, unknown>,
  redeemRows: [] as Record<string, unknown>[],
  executeCount: 0,
  deleteCount: 0,
}));

vi.mock("@repo/db", () => {
  // Minimal fluent stub: covers select().from().where().limit(),
  // insert().values().onConflictDoUpdate().returning(), delete().where().
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
    db: {
      select: () => chain(() => state.selectRows),
      insert: () => chain(() => [state.upsertedUser]),
      delete: () => {
        state.deleteCount++;
        return chain(() => []);
      },
      execute: vi.fn(async () => {
        state.executeCount++;
        return { rows: state.redeemRows };
      }),
    },
    withDbRetry: (fn: () => unknown) => fn(),
  };
});

import { isCodeAvailable, provisionMemberWithCode } from "@/lib/access-codes";

beforeEach(() => {
  state.selectRows = [];
  state.redeemRows = [];
  state.executeCount = 0;
  state.deleteCount = 0;
  state.upsertedUser = {
    id: "db-user-1",
    clerkId: "clerk_1",
    email: "a@b.com",
    tokens: 0,
    isMember: false,
  };
  vi.clearAllMocks();
});

describe("isCodeAvailable", () => {
  it("true when an unredeemed, unrevoked code row exists", async () => {
    state.selectRows = [{ code: "SKOOL-AAAA-BBBB" }];
    await expect(isCodeAvailable("SKOOL-AAAA-BBBB")).resolves.toBe(true);
  });

  it("false when the query matches nothing (unknown/redeemed/revoked)", async () => {
    state.selectRows = [];
    await expect(isCodeAvailable("SKOOL-XXXX-YYYY")).resolves.toBe(false);
  });
});

describe("provisionMemberWithCode", () => {
  it("short-circuits for a user who is already a member (stale metadata is fine)", async () => {
    state.upsertedUser = { ...state.upsertedUser, isMember: true };
    const user = await provisionMemberWithCode("clerk_1", "a@b.com", "whatever");
    expect(user?.isMember).toBe(true);
    // Never tries to redeem, never deletes.
    expect(state.executeCount).toBe(0);
    expect(state.deleteCount).toBe(0);
  });

  it("redeems a valid code and returns the user marked a member", async () => {
    state.redeemRows = [{ id: "db-user-1" }];
    const user = await provisionMemberWithCode("clerk_1", "a@b.com", "SKOOL-AAAA-BBBB");
    expect(user).toMatchObject({ id: "db-user-1", isMember: true });
    expect(state.executeCount).toBe(1);
    expect(state.deleteCount).toBe(0);
  });

  it("returns null and cleans up the fresh row when redemption fails", async () => {
    state.redeemRows = [];
    const user = await provisionMemberWithCode("clerk_1", "a@b.com", "SKOOL-USED-CODE");
    expect(user).toBeNull();
    expect(state.executeCount).toBe(1);
    expect(state.deleteCount).toBe(1);
  });

  it("returns null and cleans up without attempting redemption when no code was given", async () => {
    const user = await provisionMemberWithCode("clerk_1", "a@b.com", undefined);
    expect(user).toBeNull();
    expect(state.executeCount).toBe(0);
    expect(state.deleteCount).toBe(1);
  });
});
