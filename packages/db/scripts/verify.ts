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
    // Also runs in CI (.github/workflows/db-verify.yml), where there is no
    // .env.local and the variable comes from the environment instead.
    console.error(
      "❌  DATABASE_URL is not set (checked .env.local and the environment)"
    );
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
  //
  // Reads pg_catalog, NOT information_schema. The SQL standard requires
  // information_schema views to show only objects the current role holds some
  // privilege on, so a role with no table grants sees zero rows there and every
  // table looks "missing". pg_catalog applies no such filter.
  //
  // That difference is what lets the CI role (ci_verify, used by
  // .github/workflows/db-verify.yml) hold CONNECT and USAGE and nothing else:
  // it can confirm a column exists without being able to read a single row.
  // Switching this query back to information_schema would silently require
  // granting SELECT on every table to CI.
  const rows = await sql`
    SELECT c.relname AS table_name, a.attname AS column_name
    FROM pg_catalog.pg_attribute a
    JOIN pg_catalog.pg_class c ON c.oid = a.attrelid
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind IN ('r', 'p')   -- ordinary + partitioned tables
      AND a.attnum > 0              -- exclude system columns
      AND NOT a.attisdropped
      AND c.relname = ANY(${tableNames})
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
  Schema drift detected — the live database is missing
  columns that schema.ts declares.

  Either a migration was never applied to this database, or
  it was tracked as applied but the DDL did not execute.

  Check for pending migrations first:
    npm run db:migrate     (prompts for the endpoint id)

  If nothing is pending, the DDL silently failed. Write a
  corrective migration rather than patching columns by hand —
  a hand-applied column can differ from the intended one in
  type, default, constraints or indexes, and leaves migration
  history claiming work that was never done:
    npm run db:generate   # review the emitted SQL
    npm run db:migrate

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
