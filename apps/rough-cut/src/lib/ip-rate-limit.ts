import { rateLimit, type RateLimitResult } from "./rate-limit";

/**
 * Best-effort client IP for the three routes Clerk's middleware doesn't
 * protect (see src/proxy.ts's public-route list) — they have no session to
 * key a rate limit on, so IP is the next-best identity. Trusts the first
 * `x-forwarded-for` entry, which is only safe because these routes are only
 * ever reached through Vercel's edge (it sets this header itself and it
 * isn't attacker-spoofable there). Falls back to a shared "unknown" bucket
 * rather than throwing — only relevant locally/in tests, where every request
 * would land in one bucket.
 */
export function getClientIp(request: Request): string {
  const forwardedFor = request.headers.get("x-forwarded-for");
  return forwardedFor?.split(",")[0]?.trim() || "unknown";
}

/** `rateLimit()` keyed by the requester's IP instead of a Clerk user id. */
export async function ipRateLimit(
  request: Request,
  bucket: string,
  limit: number,
  windowSeconds: number
): Promise<RateLimitResult> {
  return rateLimit(`${bucket}:${getClientIp(request)}`, limit, windowSeconds);
}
