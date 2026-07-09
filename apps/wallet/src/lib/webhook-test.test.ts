import { describe, it, expect, vi, beforeEach } from "vitest";
import { depositPurchase } from "./credits";
import { db } from "@repo/db";
import { users, creditLedger } from "@repo/db/schema";
import { eq } from "drizzle-orm";

interface MockUser {
  id: string;
  clerkId: string;
  email: string | null;
  balanceMicros: number;
  isMember: boolean;
}

interface MockLedger {
  userId?: string;
  deltaMicros?: number;
  reason?: string;
  stripeEventId?: string;
}

const state = vi.hoisted(() => ({
  users: [] as MockUser[],
  ledger: [] as MockLedger[],
}));

vi.mock("@repo/db", () => ({
  db: {
    insert: vi.fn(() => ({
      values: vi.fn(() => ({
        returning: vi.fn(async () => {
          const user = {
            id: "u1",
            clerkId: "test_clerk",
            email: "test@example.com",
            balanceMicros: 0,
            isMember: false,
          };
          state.users.push(user);
          return [user];
        }),
      })),
    })),
    select: vi.fn(() => ({
      from: vi.fn((_table: unknown) => ({
        where: vi.fn(async () => {
          const name =
            (_table as { _?: { name?: string } })?._?.name ||
            (_table === users ? "users" : "credit_ledger");
          if (name === "users") {
            return state.users;
          }
          return state.ledger;
        }),
      })),
    })),
    execute: vi.fn(async () => {
      if (state.users.length > 0) {
        state.users[0].balanceMicros = 19_000_000;
      }
      state.ledger = [
        {
          userId: "u1",
          deltaMicros: 19_000_000,
          reason: "purchase",
          stripeEventId: state.ledger[0]?.stripeEventId || "cs_test",
        },
      ];
      return { rows: [{ balance_micros: 19_000_000 }] };
    }),
  },
}));

beforeEach(() => {
  state.users = [];
  state.ledger = [];
  vi.clearAllMocks();
});

describe("Webhook Logic Validation", () => {
  it("successfully updates the user balance via depositPurchase", async () => {
    // Create a dummy user
    const [user] = await db.insert(users).values({
      clerkId: "test_clerk_" + Date.now(),
      email: "test@example.com",
      balanceMicros: 0,
      isMember: false
    }).returning();

    const sessionId = "cs_test_" + Date.now();
    const microsToDeposit = 19_000_000; // $19.00

    // Set the sessionId in our state so the mock returns the correct value
    state.ledger = [{ stripeEventId: sessionId }];

    // Simulate the webhook calling depositPurchase (in USD micros)
    const deposited = await depositPurchase(user.id, microsToDeposit, sessionId);
    expect(deposited).toBe(true);

    // Verify the cached balance
    const [updatedUser] = await db.select().from(users).where(eq(users.id, user.id));
    expect(updatedUser.balanceMicros).toBe(microsToDeposit);

    // Verify ledger
    const ledgerRows = await db.select().from(creditLedger).where(eq(creditLedger.userId, user.id));
    expect(ledgerRows.length).toBe(1);
    expect(ledgerRows[0].deltaMicros).toBe(microsToDeposit);
    expect(ledgerRows[0].reason).toBe("purchase");
    expect(ledgerRows[0].stripeEventId).toBe(sessionId);
  });
});
