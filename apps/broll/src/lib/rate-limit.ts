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

/**
 * Per-user caps on the character pipeline, both checked **before any charge**
 * (AC-68).
 *
 * Five sets an hour is ten dollars an hour of retail and roughly four dollars of
 * vendor cost, which is far past any honest use of a feature that produces one
 * reusable set per project. Thirty regenerations an hour is above the twelve per
 * project cap on purpose: the cap is the real limit on regeneration, and this
 * bucket exists to stop a script, not to second guess a user working across
 * several projects.
 *
 * **Fails closed**, like the planner's. A set run spends real money at the
 * vendor before it produces anything, so a Redis blip that silently disabled the
 * cap here would let a scripted client burn balance and vendor cost together.
 */
const CHARACTER_SET_LIMIT = 5;
const CHARACTER_REGEN_LIMIT = 30;
const CHARACTER_WINDOW_SECONDS = 3600;

export async function characterSetRateLimit(
  clerkId: string
): Promise<RateLimitResult> {
  return rateLimit(
    `broll-character:${clerkId}`,
    CHARACTER_SET_LIMIT,
    CHARACTER_WINDOW_SECONDS,
    { failClosed: true }
  );
}

export async function characterRegenRateLimit(
  clerkId: string
): Promise<RateLimitResult> {
  return rateLimit(
    `broll-character-regen:${clerkId}`,
    CHARACTER_REGEN_LIMIT,
    CHARACTER_WINDOW_SECONDS,
    { failClosed: true }
  );
}

/**
 * Per-user cap on Scene Studio edits.
 *
 * Deliberately generous and deliberately **fail open**, unlike the money paths
 * above. Editing a scene spends nothing at any vendor and writes two columns,
 * so the worst a burst costs is database writes. A Redis blip that blocked a
 * creator from excluding a scene would break the review flow to protect
 * nothing, which is the wrong trade in the other direction.
 */
const SCENE_EDIT_LIMIT = 120;
const SCENE_EDIT_WINDOW_SECONDS = 60;

export async function writeRateLimit(clerkId: string): Promise<RateLimitResult> {
  return rateLimit(`broll-scene-edit:${clerkId}`, SCENE_EDIT_LIMIT, SCENE_EDIT_WINDOW_SECONDS, {
    failClosed: false,
  });
}
