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

/** Raised when a query overruns its per-attempt budget so we can retry it. */
class DbTimeoutError extends Error {
  constructor(ms: number) {
    super(`DB query exceeded ${ms}ms`);
    this.name = "DbTimeoutError";
  }
}

// Connection-establishment failures — safe to retry because no query committed.
// The Neon HTTP driver surfaces these as `fetch failed` (undici) or a
// NeonDbError whose cause chain carries the socket/DNS error.
const RETRYABLE = /fetch failed|ECONNRESET|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|socket hang up|Connection terminated|terminating connection/i;

function isRetryable(err: unknown): boolean {
  let e: unknown = err;
  // Walk the cause/sourceError chain the Neon driver nests errors under.
  for (let i = 0; i < 6 && e; i++) {
    const msg = e instanceof Error ? e.message : String(e);
    if (RETRYABLE.test(msg)) return true;
    e = (e as { cause?: unknown; sourceError?: unknown })?.cause
      ?? (e as { sourceError?: unknown })?.sourceError;
  }
  return false;
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new DbTimeoutError(ms)), ms);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error) => { clearTimeout(timer); reject(error); }
    );
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Run an **idempotent read** with retries on transient connection failures.
 *
 * The Neon HTTP driver opens a fresh fetch per query and does no retrying, so a
 * momentarily starved process (e.g. under a large in-memory upload) can turn one
 * stalled TLS handshake into a hard 500. Each attempt gets its own timeout — we
 * abandon a stuck connection early rather than waiting out undici's ~10s connect
 * timeout — and calls the thunk again to build a brand-new query.
 *
 * Only use this for SELECTs. Do NOT wrap writes: a timed-out INSERT may have
 * committed server-side, so retrying it could duplicate rows.
 */
export async function withDbRetry<T>(
  query: () => Promise<T>,
  { attempts = 3, timeoutMs = 4000, baseDelayMs = 150 }: {
    attempts?: number;
    timeoutMs?: number;
    baseDelayMs?: number;
  } = {}
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await withTimeout(query(), timeoutMs);
    } catch (error) {
      lastError = error;
      const retryable = error instanceof DbTimeoutError || isRetryable(error);
      if (!retryable || attempt === attempts) break;
      // A transient DB connection stall — worth a breadcrumb since it usually
      // means the process was momentarily starved (e.g. a large upload in flight).
      console.warn(
        `[db] transient query failure (attempt ${attempt}/${attempts}), retrying: ${
          lastError instanceof Error ? lastError.message : String(lastError)
        }`
      );
      await sleep(baseDelayMs * attempt);
    }
  }
  throw lastError;
}
