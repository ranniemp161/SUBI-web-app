/**
 * preflight — shows which database you are about to change, and makes you
 * confirm it before drizzle-kit touches anything.
 *
 * Why this exists: dev and prod are separate Neon branches (see MIGRATIONS.md),
 * and the target comes from whatever `DATABASE_URL` happens to be in
 * `packages/db/.env.local` — whichever branch it last pointed at. Neither
 * `drizzle-kit migrate` nor `verify.ts` prints the host, so before this script
 * there was no feedback at all about which database you just altered. The
 * failure mode is silent, irreversible, and lands on live data.
 *
 * Confirmation is the endpoint id rather than a plain "yes" on purpose: typing
 * it back is the only way to be sure the target was actually read, and a
 * y/N prompt is answered from muscle memory.
 *
 * Runs before `db:migrate` and `db:push`. To skip it in a script, set
 * MIGRATE_CONFIRM to the endpoint id.
 */

import { config } from "dotenv";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";

// Same file drizzle.config.ts and verify.ts read.
config({ path: ".env.local" });

/** Neon hosts look like ep-cool-name-123456.us-east-2.aws.neon.tech */
function endpointIdFrom(host: string): string {
  return host.split(".")[0] ?? host;
}

async function main() {
  const raw = process.env.DATABASE_URL;
  if (!raw) {
    console.error("❌  DATABASE_URL is not set in .env.local");
    process.exit(1);
  }

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    console.error("❌  DATABASE_URL is not a valid connection string");
    process.exit(1);
  }

  const endpoint = endpointIdFrom(url.hostname);
  const database = url.pathname.replace(/^\//, "") || "(default)";
  const action = process.argv[2] ?? "migrate";

  // Never print url.password or the full connection string.
  console.log("");
  console.log("  ┌─────────────────────────────────────────────");
  console.log(`  │  About to run: ${action}`);
  console.log(`  │  Host        : ${url.hostname}`);
  console.log(`  │  Endpoint    : ${endpoint}`);
  console.log(`  │  Database    : ${database}`);
  console.log(`  │  User        : ${url.username || "(none)"}`);
  console.log("  └─────────────────────────────────────────────");
  console.log("");

  const preset = process.env.MIGRATE_CONFIRM;
  if (preset) {
    if (preset.trim() === endpoint) {
      console.log("✓  MIGRATE_CONFIRM matches the endpoint. Continuing.\n");
      return;
    }
    console.error(
      `❌  MIGRATE_CONFIRM is "${preset.trim()}" but the target endpoint is "${endpoint}".`
    );
    console.error("    Refusing to run against a database you did not name.");
    process.exit(1);
  }

  if (!stdin.isTTY) {
    console.error(
      "❌  Not an interactive terminal and MIGRATE_CONFIRM is not set."
    );
    console.error(`    Set MIGRATE_CONFIRM=${endpoint} to run this unattended.`);
    process.exit(1);
  }

  const rl = createInterface({ input: stdin, output: stdout });
  try {
    const answer = await rl.question(
      `Type the endpoint id to continue (${endpoint}): `
    );
    if (answer.trim() !== endpoint) {
      console.error("\n❌  Did not match. Nothing was changed.\n");
      process.exit(1);
    }
  } finally {
    rl.close();
  }

  console.log("");
}

main().catch((err) => {
  console.error("❌  preflight failed:", err);
  process.exit(1);
});
