/**
 * Builds a validated transcript document (spec _root/0001, AC-4, AC-12).
 *
 * Two surfaces call this: the export modal's download, in the browser, and
 * `GET /api/projects/:id/transcript`, on the server. Both live inside
 * `apps/rough-cut`, and both hand this function segments that Rough Cut has
 * **already collapsed** against its own EDL. That is the boundary AC-16 draws:
 * turning raw times into post cut times needs the EDL, the EDL is Rough Cut's
 * private editing model, and this package must never learn what one is. So
 * nothing here knows how a cut is represented — it receives post cut segments
 * and shapes, validates, and serializes them.
 *
 * One builder serving both surfaces is what makes the download and the route
 * agree field for field, which is the whole point of AC-9.
 */
import {
  transcriptDocumentSchema,
  TRANSCRIPT_DOCUMENT_VERSION,
  type TranscriptDocument,
  type TranscriptFps,
  type TranscriptSegment,
  type TranscriptSource,
} from "./document";

export interface BuildTranscriptDocumentInput {
  /**
   * Post cut segments, times in seconds with zero at the first frame of the
   * final cut. The caller has already applied its cuts; this function does not
   * and cannot.
   */
  segments: TranscriptSegment[];
  /**
   * The source's detected frame rate, or null for an import. Never a guess:
   * `DEFAULT_FPS` is a definitional default for the timecode helpers and their
   * tests, never a live fallback on an export path.
   */
  fps: TranscriptFps | null;
  /** Total runtime after cuts, seconds. Runtime, not speech — see below. */
  duration: number;
  /** Whether word timings were tightened against real audio (rough-cut spec 0003). */
  wordsAligned: boolean;
  source: TranscriptSource;
  /**
   * Clock read, ISO 8601. Injectable so a test can pin it; the two real
   * callers both let it default. This is the one field the download and the
   * route cannot match on, which is exactly why AC-9 excludes it.
   */
  generatedAt?: string;
}

/**
 * Shapes the input into a document and validates it before returning, so an
 * invalid document can never leave this function and reach a file or a wire.
 * Throws Zod's error on a violated invariant — a caller that produced
 * backwards times has a bug, and serving the file anyway would put a wrong
 * number in front of a creator.
 */
export function buildTranscriptDocument(
  input: BuildTranscriptDocumentInput
): TranscriptDocument {
  return transcriptDocumentSchema.parse({
    version: TRANSCRIPT_DOCUMENT_VERSION,
    fps: input.fps,
    duration: input.duration,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    wordsAligned: input.wordsAligned,
    source: input.source,
    segments: input.segments,
  });
}

/** The document as the JSON text that gets downloaded or served. */
export function serializeTranscriptDocument(document: TranscriptDocument): string {
  return JSON.stringify(document, null, 2);
}

/** Media type for the document, used by both the download and the route. */
export const TRANSCRIPT_MEDIA_TYPE = "application/json";

/** Precision every number is rounded to before hashing: the millisecond grid. */
const FINGERPRINT_DECIMALS = 3;

/**
 * Canonical JSON: object keys in a fixed (sorted) order and every number
 * rounded to the millisecond grid. Both rules exist because the fingerprint is
 * compared across time to detect whether an edit changed, so a difference that
 * is not a real change must not alter the hash — an optional key appearing,
 * keys serializing in a different order, or a float formatting difference
 * would each otherwise read as a changed edit.
 */
function canonicalize(value: unknown): unknown {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return null;
    const factor = 10 ** FINGERPRINT_DECIMALS;
    // `+ 0` normalizes -0 to 0, which JSON.stringify would otherwise keep.
    return Math.round(value * factor) / factor + 0;
  }
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    const source = value as Record<string, unknown>;
    const canonical: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) {
      if (source[key] === undefined) continue;
      canonical[key] = canonicalize(source[key]);
    }
    return canonical;
  }
  return value;
}

// Two independent 32-bit FNV-1a passes with different offset bases, joined
// into one 64-bit hex string. Deliberately not BigInt: this package is
// consumed as raw TypeScript, so it compiles under each consuming app's
// tsconfig, and rough-cut targets below ES2020 where BigInt literals are not
// available. `Math.imul` gives the 32-bit wrapping multiply the algorithm
// needs without that dependency.
const FNV_OFFSET_A = 0x811c9dc5;
const FNV_OFFSET_B = 0x01000193;
const FNV_PRIME_32 = 0x01000193;

/**
 * Stable fingerprint of any JSON-serializable value, over its canonical form.
 *
 * Rough Cut calls this with `edl.segments` to produce a document's
 * `source.edlFingerprint`. The canonicalization and the hashing live here so
 * the download path and the route path can never compute different hashes for
 * the same edit — but the function itself knows nothing about EDLs, cuts, or
 * segments, which is what keeps AC-16 intact. Scoping the hash to the segment
 * list (rather than the whole row) is the caller's decision, and it is what
 * stops an unrelated column write from reading as a changed edit.
 *
 * FNV-1a, not a cryptographic digest: this detects drift between two versions
 * of the same user's own edit, it is not a security boundary, and being
 * synchronous means the browser download path does not have to become async
 * for it. Swap in SHA-256 via Web Crypto if this ever needs to resist a
 * deliberate collision.
 */
export function canonicalFingerprint(value: unknown): string {
  const text = JSON.stringify(canonicalize(value)) ?? "null";
  let a = FNV_OFFSET_A;
  let b = FNV_OFFSET_B;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    a = Math.imul(a ^ code, FNV_PRIME_32);
    // The second pass folds in the position as well as the character, so two
    // strings that are anagrams of each other do not collide.
    b = Math.imul(b ^ (code + i), FNV_PRIME_32);
  }
  const hex = (n: number) => (n >>> 0).toString(16).padStart(8, "0");
  return `${hex(a)}${hex(b)}`;
}
