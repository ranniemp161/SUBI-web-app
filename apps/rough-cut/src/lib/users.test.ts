import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { User } from "@repo/db/schema";

const state = vi.hoisted(() => {
  const data = { returnedUser: { id: "u1", clerkId: "c1", email: "a@b.com" } };
  const returningMock = vi.fn(async () => [data.returnedUser]);
  const onConflictDoUpdateMock = vi.fn(() => ({ returning: returningMock }));
  const valuesMock = vi.fn(() => ({ onConflictDoUpdate: onConflictDoUpdateMock }));
  const insertMock = vi.fn(() => ({ values: valuesMock }));

  return {
    data,
    returningMock,
    onConflictDoUpdateMock,
    valuesMock,
    insertMock,
  };
});

vi.mock("@repo/db", () => ({
  db: {
    insert: state.insertMock,
  },
}));

import { provisionUser } from "./users";

const ORIGINAL_ALLOWLIST_EMAIL = process.env.MEMBER_ALLOWLIST_EMAIL;

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.MEMBER_ALLOWLIST_EMAIL;
});

afterEach(() => {
  if (ORIGINAL_ALLOWLIST_EMAIL === undefined) {
    delete process.env.MEMBER_ALLOWLIST_EMAIL;
  } else {
    process.env.MEMBER_ALLOWLIST_EMAIL = ORIGINAL_ALLOWLIST_EMAIL;
  }
});

describe("provisionUser", () => {
  it("inserts or updates the user and returns it, non-member when no allowlist is configured", async () => {
    state.data.returnedUser = { id: "u1", clerkId: "clerk_123", email: "test@example.com" } as unknown as User;

    const user = await provisionUser("clerk_123", "test@example.com");

    expect(state.insertMock).toHaveBeenCalled();
    expect(state.valuesMock).toHaveBeenCalledWith({
      clerkId: "clerk_123",
      email: "test@example.com",
      isMember: false,
    });
    expect(state.onConflictDoUpdateMock).toHaveBeenCalled();
    expect(state.returningMock).toHaveBeenCalled();
    expect(user).toEqual(state.data.returnedUser);
  });

  it("grants membership only to the allowlisted email, case-insensitively", async () => {
    process.env.MEMBER_ALLOWLIST_EMAIL = "Demo@Example.com";

    await provisionUser("clerk_123", "demo@example.com");
    expect(state.valuesMock).toHaveBeenCalledWith({
      clerkId: "clerk_123",
      email: "demo@example.com",
      isMember: true,
    });

    await provisionUser("clerk_456", "someone-else@example.com");
    expect(state.valuesMock).toHaveBeenCalledWith({
      clerkId: "clerk_456",
      email: "someone-else@example.com",
      isMember: false,
    });
  });

  it("updates email and isMember together on conflict, so the row can't drift", async () => {
    process.env.MEMBER_ALLOWLIST_EMAIL = "demo@example.com";

    // Existing row, now re-provisioned from a user.updated event whose verified
    // primary address is the allowlisted one.
    await provisionUser("clerk_123", "demo@example.com");

    expect(state.onConflictDoUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        set: { email: "demo@example.com", isMember: true },
      })
    );
  });

  it("revokes membership on conflict when the primary email moves off the allowlist", async () => {
    process.env.MEMBER_ALLOWLIST_EMAIL = "demo@example.com";

    await provisionUser("clerk_123", "moved-on@example.com");

    expect(state.onConflictDoUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        set: { email: "moved-on@example.com", isMember: false },
      })
    );
  });
});
