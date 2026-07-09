/**
 * db:verify — post-migration schema guard.
 *
 * Reads the expected column set directly from the Drizzle table objects in
 * src/schema.ts (so it never goes stale) then queries information_schema to
 * confirm every column exists in the live database.  Exits 1 (and prints a
 * clear remediation message) if anything is missing, so a silent migration
 * failure can never reach the application layer.
 *
 * Run automatically after db:migrate via the "db:migrate" npm script.
 * Can also be run standalone: `npm run db:verify`
 */

import { config } from "dotenv";
import { neon } from "@neondatabase/serverless";
import * as schema from "../src/schema";

// Load .env.local (same file drizzle.config.ts uses)
config({ path: ".env.local" });

// ---------------------------------------------------------------------------
// Derive expected schema from Drizzle table objects — zero hard-coding.
//
// A pgTable() object is a plain object whose own keys are TS field names, each
// value being a column descriptor with:
//   .name        — the SQL column name (snake_case)
//   .columnType  — e.g. "PgText", "PgUUID", "PgBigInt64" …
//
// The object also has a non-enumerable Symbol-keyed internal bag and an
// `enableRLS` key; we filter those out by checking for `columnType`.
//
// To get the SQL table name we look at any column's `.table[Symbol]` — but the
// simpler path is: every column object carries a `.table` back-reference whose
// own name is the SQL table name, accessible as the value held in the
// drizzle-orm Table Symbol. We use the reliable pattern of reading column[0]
// and reflecting table name from it.
// ---------------------------------------------------------------------------

interface DrizzleColumnDescriptor {
  name: string;      // SQL column name
  columnType: string; // e.g. "PgText"
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  table: any;        // back-reference to the owning table object
}

function isDrizzleColumn(v: unknown): v is DrizzleColumnDescriptor {
  return (
    v !== null &&
    typeof v === "object" &&
    "name" in (v as object) &&
    "columnType" in (v as object) &&
    typeof (v as DrizzleColumnDescriptor).name === "string" &&
    typeof (v as DrizzleColumnDescriptor).columnType === "string"
  );
}

/**
 * Returns { sqlTableName -> [sqlColumnName, ...] } by reading Drizzle's
 * runtime table/column objects directly.  The table name is extracted from
 * the Symbol-keyed metadata on the back-reference column.table.
 */
function buildExpectedColumns(): Record<string, string[]> {
  const expected: Record<string, string[]> = {};

  for (const exported of Object.values(schema)) {
    // Skip enums (functions) and anything that isn't a plain object
    if (exported === null || typeof exported !== "object") continue;

    // Collect column descriptors from the top-level keys
    const columns: DrizzleColumnDescriptor[] = Object.values(
      exported as Record<string, unknown>
    ).filter(isDrizzleColumn);

    if (columns.length === 0) continue;

    // Derive the SQL table name from the first column's table back-reference.
    // drizzle-orm stores the table name as Symbol(drizzle:Name) on the table.
    const firstCol = columns[0];
    const tableObj = firstCol.table as Record<symbol, unknown>;
    const nameSymbol = Object.getOwnPropertySymbols(tableObj).find(
      (s) => s.toString() === "Symbol(drizzle:Name)"
    );
    const tableName =
      nameSymbol !== undefined
        ? (tableObj[nameSymbol] as string)
        : undefined;

    if (!tableName) continue;

    expected[tableName] = columns.map((c) => c.name);
  }

  return expected;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("❌  DATABASE_URL is not set in .env.local");
    process.exit(1);
  }

  const expected = buildExpectedColumns();
  const tableNames = Object.keys(expected);

  if (tableNames.length === 0) {
    console.error("❌  No tables found in schema — check the import path.");
    process.exit(1);
  }

  const sql = neon(url);

  // One round-trip: fetch all columns for the tables we care about.
  const rows = await sql`
    SELECT table_name, column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = ANY(${tableNames})
  `;

  // Build a lookup: tableName -> Set<columnName>
  const actual: Record<string, Set<string>> = {};
  for (const row of rows) {
    const tableName = row["table_name"] as string;
    const columnName = row["column_name"] as string;
    (actual[tableName] ??= new Set()).add(columnName);
  }

  let ok = true;

  for (const [tableName, cols] of Object.entries(expected)) {
    const liveColumns = actual[tableName];

    if (!liveColumns) {
      console.error(`\n❌  Table "${tableName}" is MISSING from the database.`);
      ok = false;
      continue;
    }

    const missing = cols.filter((c) => !liveColumns.has(c));
    if (missing.length > 0) {
      console.error(
        `\n❌  Table "${tableName}" is missing columns: ${missing.map((c) => `"${c}"`).join(", ")}`
      );
      ok = false;
    } else {
      console.log(`✓  ${tableName} (${cols.length} columns)`);
    }
  }

  if (!ok) {
    console.error(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Schema drift detected — the migration was tracked as
  applied but the DDL did not execute in the live database.

  To fix, apply the missing columns manually, then re-run:
    npm run db:verify

  Never run db:push against prod. See MIGRATIONS.md.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    process.exit(1);
  }

  console.log("\n✅  Live database schema matches Drizzle schema. All good.");
}

main().catch((err) => {
  console.error("❌  db:verify failed:", (err as Error).message);
  process.exit(1);
});
