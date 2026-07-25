/**
 * grant-credits — manually add USD credit to any user's balance, without
 * hand-writing SQL. Adds `amountUsd` on top of whatever the user already has
 * (not a target balance like topup-demo-account.ts) and writes a matching
 * credit_ledger row in the same atomic statement, so users.balance_micros
 * (a cache) and the ledger (the source of truth, see packages/db/AGENTS.md)
 * never drift apart, and the deposit shows up in the wallet's transaction
 * history like any other credit.
 *
 * users.email is NOT a unique column (multiple Clerk instances can each
 * provision their own row for the same email). If more than one row matches,
 * this refuses to guess and lists the candidates so you can re-run with
 * --clerk-id=<id> to disambiguate.
 *
 * Usage (run from packages/db):
 *   npm run grant-credits -- <email> <amountUsd> [--clerk-id=<id>]
 *
 * Example:
 *   npm run grant-credits -- someone@example.com 5
 */

import { config } from "dotenv";
config({ path: ".env.local" });

// Deliberately NOT importing the `db` singleton from ../src/index — see
// topup-demo-account.ts for why (tsx/ESM import hoisting would build the
// connection off the dummy fallback URL before .env.local loads).
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { sql } from "drizzle-orm";
import * as schema from "../src/schema";
import { users } from "../src/schema";

const positional = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const flags = new Map(
  process.argv
    .slice(2)
    .filter((a) => a.startsWith("--"))
    .map((a) => {
      const [k, v] = a.replace(/^--/, "").split("=");
      return [k, v ?? "true"];
    })
);
const [emailArg, amountArg] = positional;
const explicitClerkId = flags.get("clerk-id");

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("DATABASE_URL is not set in .env.local.");
    process.exit(1);
  }
  const db = drizzle(neon(databaseUrl), { schema });

  const email = emailArg?.trim().toLowerCase();
  if (!email) {
    console.error("Usage: npm run grant-credits -- <email> <amountUsd> [--clerk-id=<id>]");
    process.exit(1);
  }

  const amountUsd = Number(amountArg);
  if (!Number.isFinite(amountUsd) || amountUsd <= 0) {
    console.error(`Invalid amount: ${amountArg}. Must be a positive number of USD, e.g. 5 or 12.50.`);
    process.exit(1);
  }
  const amountMicros = Math.round(amountUsd * 1_000_000);

  const candidates = await db
    .select({
      id: users.id,
      clerkId: users.clerkId,
      email: users.email,
      balanceMicros: users.balanceMicros,
      isMember: users.isMember,
      createdAt: users.createdAt,
    })
    .from(users)
    .where(sql`lower(${users.email}) = ${email}`);

  if (candidates.length === 0) {
    console.error(
      `No user row found for ${email}. They need to sign in at least once first so it's provisioned.`
    );
    process.exit(1);
  }

  let account = candidates[0];
  if (candidates.length > 1) {
    if (!explicitClerkId) {
      console.error(
        `${candidates.length} rows share ${email} — refusing to guess which one is live. Re-run with --clerk-id=<id>:\n` +
          candidates
            .map(
              (c) =>
                `  clerk_id=${c.clerkId}  isMember=${c.isMember}  balance=$${(c.balanceMicros / 1_000_000).toFixed(2)}  created=${c.createdAt.toISOString()}`
            )
            .join("\n")
      );
      process.exit(1);
    }
    const match = candidates.find((c) => c.clerkId === explicitClerkId);
    if (!match) {
      console.error(`No row with clerk_id=${explicitClerkId} among the ${candidates.length} matching ${email}.`);
      process.exit(1);
    }
    account = match;
  }

  const result = await db.execute(sql`
    WITH led AS (
      INSERT INTO credit_ledger (user_id, delta_micros, reason)
      VALUES (${account.id}, ${amountMicros}, 'purchase')
      RETURNING user_id, delta_micros
    )
    UPDATE users u
    SET balance_micros = u.balance_micros + led.delta_micros
    FROM led
    WHERE u.id = led.user_id
    RETURNING u.balance_micros
  `);

  const rows = (result as unknown as { rows: { balance_micros: number }[] }).rows;
  const newBalance = rows[0]?.balance_micros ?? account.balanceMicros + amountMicros;

  console.log(
    `Granted ${email} (clerk_id=${account.clerkId}): +$${amountUsd.toFixed(2)} -> new balance $${(newBalance / 1_000_000).toFixed(2)}`
  );
}

main().catch((err) => {
  console.error("grant-credits failed:", (err as Error).message);
  process.exit(1);
});
