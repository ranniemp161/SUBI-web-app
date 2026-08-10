export { rateLimit, type RateLimitResult } from "@repo/server-shared/rate-limit";
import { rateLimit, type RateLimitResult } from "@repo/server-shared/rate-limit";

/**
 * Per-user cap on scene plan runs, keyed `broll-plan:<clerkId>` (AC-26).
 *
 * Ten an hour, borrowed from Rough Cut's `aiCutRateLimit` rather than derived
 * from load data for this route — a plan run is cheaper and faster than an AI
 * Cut run, so the number is probably conservative (spec `0003` Follow-up).
 *
 * **Fails closed**, like the route it guards: this is a money path, and on a
 * money path "cannot prove this is safe" has to mean refuse. A Redis blip that
 * silently disabled the cap here would let a scripted client burn real Gemini
 * calls and real balance.
 */
const PLAN_LIMIT = 10;
const PLAN_WINDOW_SECONDS = 3600;

export async function planRateLimit(clerkId: string): Promise<RateLimitResult> {
  return rateLimit(`broll-plan:${clerkId}`, PLAN_LIMIT, PLAN_WINDOW_SECONDS, {
    failClosed: true,
  });
}
