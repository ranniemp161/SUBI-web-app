import { config } from "dotenv";
import path from "path";
config({ path: path.resolve(process.cwd(), "apps/wallet/.env.local") });

import { db } from "@repo/db";
import { users, creditLedger } from "@repo/db/schema";
import { eq } from "drizzle-orm";

async function run() {
  const email = "rannieperalta06@gmail.com";
  console.log(`Looking up user: ${email}...`);
  
  const userRows = await db.select().from(users).where(eq(users.email, email));
  if (userRows.length === 0) {
    console.log("User not found!");
    process.exit(0);
  }

  const user = userRows[0];
  console.log("User:", { id: user.id, email: user.email, tokens: user.tokens });

  const ledgerRows = await db.select().from(creditLedger).where(eq(creditLedger.userId, user.id));
  console.log(`Found ${ledgerRows.length} ledger entries.`);
  
  for (const row of ledgerRows) {
    console.log(`- Date: ${row.createdAt}, Reason: ${row.reason}, Delta: ${row.deltaTokens}, Event: ${row.stripeEventId}`);
  }

  process.exit(0);
}

run().catch(console.error);
