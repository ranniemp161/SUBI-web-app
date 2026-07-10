import { describe, it, expect, vi, beforeEach } from "vitest";

const state = vi.hoisted(() => {
  return {
    rows: [] as { id: string; clerkId: string; email: string }[],
    clerkUser: null as { emailAddresses: { emailAddress: string }[] } | null,
    provisionedUser: null as { id: string; clerkId: string; email: string } | null,
  };
});

vi.mock("@repo/db", () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn(async () => state.rows),
        })),
      })),
    })),
  },
  withDbRetry: vi.fn(async (fn) => fn()),
}));

vi.mock("@repo/db/schema", () => ({
  users: { clerkId: "mock-users-clerkId" },
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((col, val) => ({ col, val })),
}));

vi.mock("@clerk/nextjs/server", () => ({
  currentUser: vi.fn(async () => state.clerkUser),
}));

vi.mock("@/lib/users", () => ({
  provisionUser: vi.fn(async () => state.provisionedUser),
}));

import { getAuthorizedDbUser } from "./authz";
import { provisionUser } from "@/lib/users";
import { withDbRetry } from "@repo/db";

beforeEach(() => {
  vi.clearAllMocks();
  state.rows = [];
  state.clerkUser = null;
  state.provisionedUser = null;
});

describe("getAuthorizedDbUser", () => {
  it("returns the user directly from the database if found", async () => {
    state.rows = [{ id: "u1", clerkId: "clerk_123", email: "test@example.com" }];
    
    const user = await getAuthorizedDbUser("clerk_123");
    
    expect(user).toEqual({ id: "u1", clerkId: "clerk_123", email: "test@example.com" });
    expect(withDbRetry).toHaveBeenCalled();
  });

  it("provisions and returns the user if not in database but present in Clerk with an email", async () => {
    state.rows = [];
    state.clerkUser = {
      emailAddresses: [{ emailAddress: "clerk@example.com" }],
    };
    state.provisionedUser = { id: "u2", clerkId: "clerk_123", email: "clerk@example.com" };

    const user = await getAuthorizedDbUser("clerk_123");

    expect(user).toEqual(state.provisionedUser);
    expect(provisionUser).toHaveBeenCalledWith("clerk_123", "clerk@example.com");
  });

  it("returns null if not in database and Clerk returns no user", async () => {
    state.rows = [];
    state.clerkUser = null;

    const user = await getAuthorizedDbUser("clerk_123");

    expect(user).toBeNull();
    expect(provisionUser).not.toHaveBeenCalled();
  });

  it("returns null if not in database and Clerk user has no email addresses", async () => {
    state.rows = [];
    state.clerkUser = { emailAddresses: [] };

    const user = await getAuthorizedDbUser("clerk_123");

    expect(user).toBeNull();
    expect(provisionUser).not.toHaveBeenCalled();
  });

  it("returns null if not in database and Clerk user's first email is empty", async () => {
    state.rows = [];
    state.clerkUser = { emailAddresses: [{ emailAddress: "" }] };

    const user = await getAuthorizedDbUser("clerk_123");

    expect(user).toBeNull();
    expect(provisionUser).not.toHaveBeenCalled();
  });

  it("throws if withDbRetry throws (dependency failure)", async () => {
    vi.mocked(withDbRetry).mockRejectedValueOnce(new Error("DB Error"));
    
    await expect(getAuthorizedDbUser("clerk_123")).rejects.toThrow("DB Error");
  });
});
