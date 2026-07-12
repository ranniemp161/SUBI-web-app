import { Redis } from "@upstash/redis";
import { Ratelimit } from "@upstash/ratelimit";
import { reportError } from "./observability";

export interface RateLimitResult {
  allowed: boolean;
  /** Remaining requests in the current window (0 once the limit is hit). */
  remaining: number;
  limit: number;
}

// Cache ratelimiters by their config
const ratelimiters = new Map<string, Ratelimit>();

function getRatelimiter(limit: number, windowSeconds: number): Ratelimit | null {
  if (!process.env.KV_REST_API_URL || !process.env.KV_REST_API_TOKEN) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("KV_REST_API_URL and KV_REST_API_TOKEN must be set in production.");
    }
    return null;
  }

  const cacheKey = `${limit}:${windowSeconds}`;
  if (!ratelimiters.has(cacheKey)) {
    // Ratelimit expects the duration formatted as `${number} s`
    const window = `${windowSeconds} s` as const;
    ratelimiters.set(
      cacheKey,
      new Ratelimit({
        redis: new Redis({
          url: process.env.KV_REST_API_URL,
          token: process.env.KV_REST_API_TOKEN,
        }),
        limiter: Ratelimit.fixedWindow(limit, window),
      })
    );
  }
  return ratelimiters.get(cacheKey)!;
}

/**
 * Fixed-window rate limiter backed by Vercel KV (Upstash Redis).
 *
 * `key` should namespace the bucket and the subject, e.g. `transcribe:<userId>`.
 *
 * `failClosed` controls what happens when Redis itself errors mid-request
 * (not "unconfigured" — that's always a dev-only allow). Leave it false for
 * ordinary abuse caps, where an outage should degrade to unlimited rather
 * than lock users out. Set it true for a limiter that is also the only guard
 * against a money-moving action repeating (a checkout/charge cap, or an
 * idempotency lock) — there, "can't prove this is safe" must mean refuse,
 * not allow, or a Redis blip turns into free double-charges.
 */
export async function rateLimit(
  key: string,
  limit: number,
  windowSeconds: number,
  options?: { failClosed?: boolean }
): Promise<RateLimitResult> {
  const limiter = getRatelimiter(limit, windowSeconds);

  // If KV is not configured (e.g. local dev without env vars), allow the request.
  if (!limiter) {
    console.warn("KV_REST_API_URL is not set. Rate limiting is disabled.");
    return { allowed: true, remaining: limit, limit };
  }

  try {
    const { success, remaining } = await limiter.limit(key);

    return {
      allowed: success,
      remaining,
      limit,
    };
  } catch (error) {
    // Sentry-visible (not just console): a sustained Redis outage silently
    // disables every fail-open abuse cap, which must page someone.
    if (options?.failClosed) {
      reportError("Redis rate limit failed, failing closed (money-moving path)", error, { key });
      return { allowed: false, remaining: 0, limit };
    }
    reportError("Redis rate limit failed, failing open", error, { key });
    return { allowed: true, remaining: limit, limit };
  }
}
