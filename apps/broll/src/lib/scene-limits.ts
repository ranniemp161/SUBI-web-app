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
