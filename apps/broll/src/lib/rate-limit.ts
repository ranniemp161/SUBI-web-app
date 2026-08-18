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
 * Per-user cap on generated object illustrations (spec `broll/0008`).
 *
 * Its own bucket rather than sharing the character regeneration one: they are
 * different spends on different rows, and a creator who redrew a character six
 * times should not find themselves unable to illustrate a scene.
 *
 * Sized against the batch action. A plan of twenty scenes where most name
 * something could reasonably want fifteen illustrations in one go, so the cap
 * has to sit above a legitimate whole-project generate and below a script. Sixty
 * an hour is roughly three full projects.
 *
 * **Fails closed**, like every money path here.
 */
const OBJECT_IMAGE_LIMIT = 60;
const OBJECT_IMAGE_WINDOW_SECONDS = 3600;

export async function objectImageRateLimit(clerkId: string): Promise<RateLimitResult> {
  return rateLimit(
    `broll-object:${clerkId}`,
    OBJECT_IMAGE_LIMIT,
    OBJECT_IMAGE_WINDOW_SECONDS,
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

/**
 * Per-user cap on creating and deleting scenes (spec `0005` AC-83).
 *
 * **Fails closed, unlike the edit path right above it, and the difference is
 * the point.** Editing toggles two columns on a row that already exists;
 * creating and deleting bring rows into being and destroy them. The fail open
 * reasoning is that a Redis blip must not stop a creator excluding a scene,
 * which is true and does not carry over to a path that can write forty rows a
 * second into someone's project. There is still no vendor spend here, so this
 * is about the database rather than about money.
 *
 * Thirty a minute is far above deliberate use — a creator adds a handful of
 * scenes by hand across a whole review — and far below what a script wants.
 */
const SCENE_CREATE_LIMIT = 30;
const SCENE_CREATE_WINDOW_SECONDS = 60;

export async function sceneCreateRateLimit(clerkId: string): Promise<RateLimitResult> {
  return rateLimit(
    `broll-scene-create:${clerkId}`,
    SCENE_CREATE_LIMIT,
    SCENE_CREATE_WINDOW_SECONDS,
    { failClosed: true }
  );
}
