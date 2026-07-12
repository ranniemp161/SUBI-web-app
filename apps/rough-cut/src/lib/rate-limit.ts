export { rateLimit, type RateLimitResult } from "@repo/server-shared/rate-limit";
import { rateLimit, type RateLimitResult } from "@repo/server-shared/rate-limit";

// One shared bucket across all cheap authenticated GETs (project list/detail,
// credits, status polling). Generous enough that legitimate use never sees it
// — the dashboard polls status every 4s per in-flight project — while bounding
// what a scripted client can burn in Neon compute. Fail-open like other
// abuse caps.
const READ_LIMIT = 600;
const READ_WINDOW_SECONDS = 300;

/** Shared per-user cap for cheap read-only routes, keyed `read:<clerkId>`. */
export async function readRateLimit(clerkId: string): Promise<RateLimitResult> {
  return rateLimit(`read:${clerkId}`, READ_LIMIT, READ_WINDOW_SECONDS);
}

// One shared bucket across all AI Cut routes (run, switch active, delete,
// rename) — only the POST run is a real Gemini charge, but the others are
// capped at the same rate as unwanted request volume against the database
// (ADR 0002-ai-cut-paid-rerun). 10/hour is plenty for legitimate re-runs.
const AI_CUT_LIMIT = 10;
const AI_CUT_WINDOW_SECONDS = 3600;

/** Shared per-user cap for AI Cut routes, keyed `ai-cut:<clerkId>`. */
export async function aiCutRateLimit(clerkId: string): Promise<RateLimitResult> {
  return rateLimit(`ai-cut:${clerkId}`, AI_CUT_LIMIT, AI_CUT_WINDOW_SECONDS);
}
