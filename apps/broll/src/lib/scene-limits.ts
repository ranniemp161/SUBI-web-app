/**
 * Pure, zero dependency limits shared by the server and the browser.
 *
 * This file exists for the same reason `blob-path.ts` and `transcript-limits.ts`
 * exist in Rough Cut: `scenes.ts` carries `import "server-only"`, so a client
 * component importing a constant from it drags the database client into the
 * browser bundle. The build refuses, which is the good outcome, but the fix is
 * always the same, so the constant lives here and both sides import it.
 */

/** Longest burned in caption Scene Studio will store, in characters. */
export const MAX_OVERLAY_TEXT_CHARS = 240;

/**
 * How many scenes one project may have added by hand (spec `broll/0005`
 * AC-82).
 *
 * Not a technical limit and not a price: rendering is free and happens in the
 * creator's own browser. It bounds what one project can cost this app in rows
 * and what one export can cost the creator in patience, at a number no honest
 * review of a talking head video comes near. A ten minute transcript plans
 * about twelve scenes, so forty added by hand is already far past "the planner
 * missed a few".
 */
export const MAX_MANUAL_SCENES_PER_PROJECT = 40;
