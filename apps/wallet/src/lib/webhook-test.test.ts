import { describe, it, expect } from "vitest";
import { depositPurchase } from "./credits";
import { db } from "@repo/db";
import { users, creditLedger } from "@repo/db/schema";
import { eq } from "drizzle-orm";

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
