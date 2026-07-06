import { sql } from "drizzle-orm";
import { db } from "@repo/db";
import { rateLimits } from "@repo/db/schema";

export interface RateLimitResult {
  allowed: boolean;
  /** Remaining requests in the current window (0 once the limit is hit). */
  remaining: number;
  limit: number;
}

/**
 * Fixed-window rate limiter backed by a single Postgres row per key.
 *
 * The whole check is one atomic upsert: insert the key at count 1, or on
 * conflict either reset it (if the stored window has elapsed) or increment it.
 * Because the read-modify-write happens inside one statement, concurrent
 * requests can't race past the limit. Returned count > limit ⇒ blocked.
 *
 * `key` should namespace the bucket and the subject, e.g. `transcribe:<userId>`.
 */
export async function rateLimit(
  key: string,
  limit: number,
  windowSeconds: number
): Promise<RateLimitResult> {
  // True when the stored window has already elapsed and the counter should reset.
  const expired = sql`${rateLimits.windowStart} < now() - (interval '1 second' * ${windowSeconds})`;

  const [row] = await db
    .insert(rateLimits)
    .values({ key, count: 1, windowStart: sql`now()` })
    .onConflictDoUpdate({
      target: rateLimits.key,
      set: {
        count: sql`case when ${expired} then 1 else ${rateLimits.count} + 1 end`,
        windowStart: sql`case when ${expired} then now() else ${rateLimits.windowStart} end`,
      },
    })
    .returning({ count: rateLimits.count });

  const count = row?.count ?? 1;
  return { allowed: count <= limit, remaining: Math.max(0, limit - count), limit };
}
