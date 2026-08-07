/**
 * Size limits on a transcript the client may send back to the server.
 *
 * Pure and dependency free on purpose, the same reason `blob-path.ts` exists:
 * the studio page is a client component, and importing `lib/validation.ts` for
 * a number would pull zod (and the schemas around it) into the browser bundle.
 * The schema imports these; the client checks against them. One definition, so
 * the guard and the validator cannot drift apart.
 */

/**
 * Cap on the words a client may PATCH back in one transcript body.
 *
 * Vercel's serverless request body limit is ~4.5 MB. A stored word serializes
 * to ~89 bytes (measured against the real shape: millisecond-rounded
 * `start`/`end`, a confidence, an optional `aligned` flag), so the platform
 * itself tops out near 50,000 words; 40,000 lands at ~3.4 MB and leaves roughly
 * a quarter of the budget spare for the `text` and `utteranceEnds` alongside it.
 *
 * The previous cap was 300,000 words and 10 MB of text — about 27 MB, six times
 * more than could ever arrive. That promise was empty: the platform answered a
 * bare 413 long before zod ran, so the caller never saw our error.
 *
 * **Only the client PATCH is bound by this.** The transcription routes write
 * the transcript server-side and never cross a request body, so a recording
 * longer than this still transcribes, edits, and exports normally — it just
 * can't round-trip its refined word boundaries back (see `runWordAlignment`,
 * which checks this before spending the request).
 */
export const MAX_PATCH_TRANSCRIPT_WORDS = 40_000;

/**
 * Matching cap for the flat transcript text. 40,000 words of ordinary English
 * is roughly 240 KB, so this is about double what the word cap implies.
 */
export const MAX_PATCH_TRANSCRIPT_TEXT_CHARS = 500_000;
