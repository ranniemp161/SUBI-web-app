import { db } from "@repo/db";
import { users, creditLedger } from "@repo/db/schema";
import { depositPurchase } from "../apps/wallet/src/lib/credits";
import { eq } from "drizzle-orm";

async function run() {
  console.log("Creating dummy user...");
  const [user] = await db.insert(users).values({
    clerkId: "test_clerk_" + Date.now(),
    email: "test@example.com",
    tokens: 0,
    isMember: false
  }).returning();

  console.log("User created:", user.id, "Tokens:", user.tokens);

  const sessionId = "cs_test_" + Date.now();
  const tokensToBuy = 300;

  console.log("Simulating webhook depositPurchase...");
  const deposited = await depositPurchase(user.id, tokensToBuy, sessionId);
  
  console.log("Deposit result:", deposited);

  const [updatedUser] = await db.select().from(users).where(eq(users.id, user.id));
  console.log("Updated user tokens:", updatedUser.tokens);

  const ledgerRows = await db.select().from(creditLedger).where(eq(creditLedger.userId, user.id));
  console.log("Ledger rows:", ledgerRows.length);
  
  if (updatedUser.tokens === tokensToBuy && ledgerRows.length === 1) {
    console.log("SUCCESS: Logic works perfectly.");
  } else {
    console.error("FAILED: DB did not update as expected.");
  }

  process.exit(0);
}

run().catch(console.error);
