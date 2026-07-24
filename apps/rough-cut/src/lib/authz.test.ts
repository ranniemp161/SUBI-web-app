import { describe, it, expect, vi, beforeEach } from "vitest";
import type { User } from "@repo/db/schema";

const { selectMock, fromMock, whereMock, limitMock } = vi.hoisted(() => ({
  selectMock: vi.fn(),
  fromMock: vi.fn(),
  whereMock: vi.fn(),
  limitMock: vi.fn(),
}));

vi.mock("@repo/db", () => ({
  db: { select: selectMock },
  withDbRetry: vi.fn(async (cb) => cb()),
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((col, val) => ({ col, val })),
}));

vi.mock("@repo/db/schema", () => ({
  users: {
    clerkId: "users.clerkId",
  },
}));

const { currentUserMock } = vi.hoisted(() => ({
  currentUserMock: vi.fn(),
}));

vi.mock("@clerk/nextjs/server", () => ({
  currentUser: currentUserMock,
}));

vi.mock("@/lib/users", () => ({
  provisionUser: vi.fn(),
  isAllowlistedMember: vi.fn(() => false),
}));

import { getAuthorizedDbUser } from "./authz";
import { provisionUser } from "@/lib/users";

describe("getAuthorizedDbUser", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    currentUserMock.mockResolvedValue(null);

    selectMock.mockReturnValue({ from: fromMock });
    fromMock.mockReturnValue({ where: whereMock });
    whereMock.mockReturnValue({ limit: limitMock });
  });

  it("returns user if found in database", async () => {
    const dbUser = { id: "u1", clerkId: "c1", email: "a@b.com" };
    limitMock.mockResolvedValue([dbUser]);

    const result = await getAuthorizedDbUser("c1");

    expect(result).toEqual(dbUser);
    expect(limitMock).toHaveBeenCalledWith(1);
    expect(provisionUser).not.toHaveBeenCalled();
  });

  it("re-provisions user if existing in db as non-member but email is allowlisted", async () => {
    const dbUser = { id: "u1", clerkId: "c1", email: "a@b.com", isMember: false };
    limitMock.mockResolvedValue([dbUser]);
    currentUserMock.mockResolvedValue({
      emailAddresses: [{ emailAddress: "a@b.com" }],
    });
    const updatedUser = { ...dbUser, isMember: true };
    const { isAllowlistedMember } = await import("@/lib/users");
    vi.mocked(isAllowlistedMember).mockReturnValue(true);
    vi.mocked(provisionUser).mockResolvedValue(updatedUser as unknown as User);

    const result = await getAuthorizedDbUser("c1");

    expect(result).toEqual(updatedUser);
    expect(provisionUser).toHaveBeenCalledWith("c1", "a@b.com");
  });

  it("provisions user if not in db but found via Clerk currentUser", async () => {
    limitMock.mockResolvedValue([]);
    currentUserMock.mockResolvedValue({
      emailAddresses: [{ emailAddress: "a@b.com" }],
    });
    const dbUser = { id: "u1", clerkId: "c1", email: "a@b.com" };
    vi.mocked(provisionUser).mockResolvedValue(dbUser as unknown as User);

    const result = await getAuthorizedDbUser("c1");

    expect(result).toEqual(dbUser);
    expect(provisionUser).toHaveBeenCalledWith("c1", "a@b.com");
  });

  it("returns null if not in db and Clerk currentUser has no email", async () => {
    limitMock.mockResolvedValue([]);
    currentUserMock.mockResolvedValue({
      emailAddresses: [],
    });

    const result = await getAuthorizedDbUser("c1");

    expect(result).toBeNull();
    expect(provisionUser).not.toHaveBeenCalled();
  });

  it("returns null if not in db and Clerk currentUser is null", async () => {
    limitMock.mockResolvedValue([]);
    currentUserMock.mockResolvedValue(null);

    const result = await getAuthorizedDbUser("c1");

    expect(result).toBeNull();
    expect(provisionUser).not.toHaveBeenCalled();
  });
});
