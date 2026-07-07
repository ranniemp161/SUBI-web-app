import { describe, it, expect, vi } from "vitest";
import { depositPurchase } from "./credits";
import { db } from "@repo/db";
import { users, creditLedger } from "@repo/db/schema";
import { eq } from "drizzle-orm";

describe("Webhook Logic Validation", () => {
  it("successfully updates user tokens via depositPurchase", async () => {
    // Create a dummy user
    const [user] = await db.insert(users).values({
      clerkId: "test_clerk_" + Date.now(),
      email: "test@example.com",
      tokens: 0,
      isMember: false
    }).returning();

    const sessionId = "cs_test_" + Date.now();
    const tokensToBuy = 300;

    // Simulate the webhook calling depositPurchase
    const deposited = await depositPurchase(user.id, tokensToBuy, sessionId);
    expect(deposited).toBe(true);

    // Verify token count
    const [updatedUser] = await db.select().from(users).where(eq(users.id, user.id));
    expect(updatedUser.tokens).toBe(tokensToBuy);

    // Verify ledger
    const ledgerRows = await db.select().from(creditLedger).where(eq(creditLedger.userId, user.id));
    expect(ledgerRows.length).toBe(1);
    expect(ledgerRows[0].deltaTokens).toBe(tokensToBuy);
    expect(ledgerRows[0].reason).toBe("purchase");
    expect(ledgerRows[0].stripeEventId).toBe(sessionId);
  });
});
