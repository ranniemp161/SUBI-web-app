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
import { is, Table, getTableName, getTableColumns } from "drizzle-orm";
import * as schema from "../src/schema";

// Load .env.local (same file drizzle.config.ts uses)
config({ path: ".env.local" });

// ---------------------------------------------------------------------------
// Derive expected schema from Drizzle table objects — zero hard-coding.
//
// drizzle-orm ships two stable public helpers that are part of its documented
// API surface:
//   is(value, Table)        — returns true for pgTable() objects, false for
//                             enums, type helpers, and anything else.
//   getTableName(table)     — returns the SQL table name (e.g. "projects").
//   getTableColumns(table)  — returns { tsKey: ColumnDescriptor } for every
//                             column, where ColumnDescriptor.name is the SQL
//                             column name (snake_case).
//
// Using these avoids the Symbol(drizzle:Name) reflection that would silently
// break if Drizzle renames or removes that internal symbol.
// ---------------------------------------------------------------------------

/**
 * Returns { sqlTableName -> [sqlColumnName, ...] } by reading Drizzle's
 * public table and column metadata helpers.
 */
function buildExpectedColumns(): Record<string, string[]> {
  const expected: Record<string, string[]> = {};

  for (const exported of Object.values(schema)) {
    // Skip enums (PgEnum functions) and anything that isn't a pgTable object.
    if (!is(exported, Table)) continue;

    const tableName = getTableName(exported);
    const columnSqlNames = Object.values(getTableColumns(exported)).map(
      (col) => col.name
    );

    if (columnSqlNames.length > 0) {
      expected[tableName] = columnSqlNames;
    }
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
