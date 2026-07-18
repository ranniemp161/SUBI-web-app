import { config } from "dotenv";
import { resolve } from "path";

// Load environment variables from apps/wallet/.env.local
config({ path: resolve("../../apps/wallet/.env.local") });

import { db } from "../src/index";
import { creditLedger, projects, users } from "../src/schema";
import { eq, desc } from "drizzle-orm";
import { getBundles, getSavedCard } from "../../apps/wallet/src/lib/stripe";

async function run() {
  const clerkId = "user_3Fog4cQksW2slAvD74Ed9nrgS4t"; // One of the users in DB
  console.log("Testing data fetching for clerkId:", clerkId);

  try {
    const userRows = await db.select().from(users).where(eq(users.clerkId, clerkId)).limit(1);
    const user = userRows[0];
    if (!user) {
      console.error("User not found in DB");
      return;
    }
    console.log("User found:", user.email);

    console.log("Fetching ledgerHistory, bundles, savedCard...");
    const [ledgerHistory, bundles, savedCard] = await Promise.all([
      db
        .select({
          id: creditLedger.id,
          reason: creditLedger.reason,
          deltaMicros: creditLedger.deltaMicros,
          createdAt: creditLedger.createdAt,
          fileName: projects.fileName,
        })
        .from(creditLedger)
        .leftJoin(projects, eq(creditLedger.projectId, projects.id))
        .where(eq(creditLedger.userId, user.id))
        .orderBy(desc(creditLedger.createdAt))
        .limit(50),
      getBundles(),
      getSavedCard(user.defaultPaymentMethodId),
    ]);

    console.log("Successfully fetched data!");
    console.log("Ledger entries count:", ledgerHistory.length);
    console.log("Bundles count:", bundles.length);
    console.log("Saved card:", savedCard);
  } catch (error) {
    console.error("Data fetching block failed with error:", error);
  }
}

run();
