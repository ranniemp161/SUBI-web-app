/**
 * Generate a batch of one-time Skool member access codes.
 *
 *   node --env-file=.env.local scripts/generate-access-codes.mjs 25
 *
 * Prints the new codes, one per line, ready to paste into Skool DMs. Codes
 * are crypto-random over an unambiguous alphabet (no 0/O/1/I), 8 chars
 * ≈ 41 bits — far beyond online brute force given verify-code's IP limit.
 */
import { randomInt } from "node:crypto";
import { neon } from "@neondatabase/serverless";

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function generateCode() {
  let body = "";
  for (let i = 0; i < 8; i++) body += ALPHABET[randomInt(ALPHABET.length)];
  return `SKOOL-${body.slice(0, 4)}-${body.slice(4)}`;
}

const count = Number(process.argv[2] ?? 10);
if (!Number.isInteger(count) || count < 1 || count > 500) {
  console.error("Usage: node --env-file=.env.local scripts/generate-access-codes.mjs <count 1-500>");
  process.exit(1);
}
if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set — pass --env-file=.env.local");
  process.exit(1);
}

const sql = neon(process.env.DATABASE_URL);
const codes = Array.from({ length: count }, generateCode);

// ON CONFLICT DO NOTHING: a (vanishingly unlikely) collision with an existing
// code is simply skipped rather than reissued.
const inserted = await sql`
  INSERT INTO "access_codes" ("code")
  SELECT unnest(${codes}::text[])
  ON CONFLICT ("code") DO NOTHING
  RETURNING "code"
`;

for (const row of inserted) console.log(row.code);
console.error(`\n${inserted.length} code(s) created.`);
