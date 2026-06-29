import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "./schema";

/**
 * Creates a Neon HTTP database connection with Drizzle ORM.
 *
 * Uses the serverless HTTP driver which is ideal for edge/serverless
 * environments — each request gets its own stateless connection over HTTP,
 * no persistent connection pool needed.
 */
function createDb() {
  const databaseUrl = process.env.DATABASE_URL || "postgresql://dummy:dummy@localhost:5432/dummy";

  if (!process.env.DATABASE_URL) {
    console.warn(
      "Warning: DATABASE_URL environment variable is not set. Database queries will fail at runtime."
    );
  }

  const sql = neon(databaseUrl);
  return drizzle(sql, { schema });
}

/** Singleton database instance — reused across requests within the same process. */
export const db = createDb();
