import { describe, it, expect, vi, beforeEach } from "vitest";

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

beforeEach(() => {
  vi.clearAllMocks();
});

describe("provisionUser", () => {
  it("inserts or updates the user and returns it", async () => {
    state.data.returnedUser = { id: "u1", clerkId: "clerk_123", email: "test@example.com" };
    
    const user = await provisionUser("clerk_123", "test@example.com");
    
    expect(state.insertMock).toHaveBeenCalled();
    expect(state.valuesMock).toHaveBeenCalledWith({ clerkId: "clerk_123", email: "test@example.com" });
    expect(state.onConflictDoUpdateMock).toHaveBeenCalled();
    expect(state.returningMock).toHaveBeenCalled();
    expect(user).toEqual(state.data.returnedUser);
  });

  it("throws if the database operation fails", async () => {
    state.insertMock.mockImplementationOnce(() => {
      throw new Error("DB insert failed");
    });

    await expect(provisionUser("clerk_fail", "fail@example.com")).rejects.toThrow("DB insert failed");
  });
});
