/**
 * The transcript document: the file that carries timing between Rough Cut and
 * B-Roll (spec _root/0001). This module is the single definition of what a
 * valid document is. The Zod schema is the definition and the TypeScript type
 * is inferred from it, so the runtime check and the compile-time type cannot
 * disagree (AC-3).
 *
 * Two rules run through every field here:
 *
 * 1. **All times are seconds, and zero is the first frame of the final cut.**
 *    Never the source's embedded start timecode, never a raw pre-cut time.
 * 2. **Nothing is ever fabricated.** A measurement that was not taken is
 *    absent, not defaulted to a plausible looking value. That is why
 *    `confidence` is optional rather than defaulted, and why `fps` is nullable
 *    rather than falling back to a guess (AC-6).
 *
 * This package never learns what an EDL is (AC-16). Cuts are applied by
 * Rough Cut before a document is built, so the document shape and the editing
 * model can change independently of each other.
 */
import { z } from "zod";

/** Format version of the document. Bump only on a breaking shape change. */
export const TRANSCRIPT_DOCUMENT_VERSION = 1;

/**
 * Largest document accepted by `parseTranscriptDocument`, measured on the raw
 * UTF-8 bytes before parsing (see `read.ts`).
 *
 * PROVISIONAL. Spec _root/0001's follow-up asks for this to be sized against a
 * real ten minute transcript rather than guessed; that measurement has not been
 * taken yet. The arithmetic behind the placeholder: speech runs about 150 words
 * a minute, a word entry serializes to roughly 60 bytes, so ten minutes is
 * about 200 KB. 5 MiB therefore clears a multi hour video with room to spare
 * and works as an abuse guard, which is all this cap is for. Retune it here
 * when the real measurement exists — nothing else reads the number.
 */
export const MAX_DOCUMENT_BYTES = 5 * 1024 * 1024;

/**
 * Largest number of segments accepted. Same provisional status and same
 * purpose as `MAX_DOCUMENT_BYTES`: far past any real speech, so it bounds a
 * hostile or corrupt file without ever rejecting a genuine one.
 */
export const MAX_SEGMENT_COUNT = 20_000;

/** A frame rate as an exact rational, so 29.97 stays 30000/1001 and never drifts. */
export const videoFpsSchema = z.object({
  numerator: z.number().int().positive(),
  denominator: z.number().int().positive(),
});

/**
 * One word with its own timing. `confidence` is optional and is **omitted**,
 * never defaulted, when the source never measured it — an imported subtitle
 * has no confidence to report, and inventing one would be a fabricated number
 * in a product whose whole selling point is that its numbers are real (AC-6).
 */
export const transcriptWordSchema = z.object({
  word: z.string(),
  start: z.number().nonnegative(),
  end: z.number().nonnegative(),
  confidence: z.number().min(0).max(1).optional(),
});

/**
 * A run of speech, post cut. `words` may be absent: a Rough Cut export always
 * carries them, a plain SRT import never does, and a WebVTT file carries them
 * on exactly the cues that hold inline timestamps (AC-5). Consumers must
 * handle both shapes — that branch is permanent, and deliberately so.
 */
export const transcriptSegmentSchema = z.object({
  start: z.number().nonnegative(),
  end: z.number().nonnegative(),
  text: z.string(),
  words: z.array(transcriptWordSchema).optional(),
});

/**
 * Where a document came from. `edlFingerprint` is reserved for the staleness
 * work in Phase 3 (does this transcript still match the edit it was cut
 * from?); nothing reads it yet, and it is carried now only so files already in
 * the wild do not need a format change later.
 */
export const transcriptSourceSchema = z.object({
  kind: z.enum(["rough-cut", "import"]),
  projectId: z.string().nullable(),
  edlFingerprint: z.string().nullable(),
});

const baseDocumentSchema = z.object({
  version: z.literal(TRANSCRIPT_DOCUMENT_VERSION),
  /**
   * Null only on an import: a subtitle file carries no frame rate and guessing
   * one would be a fabricated number. A `"rough-cut"` document always carries a
   * real detected rate — enforced below, not just documented.
   */
  fps: videoFpsSchema.nullable(),
  /** Total runtime after cuts, seconds. */
  duration: z.number().nonnegative(),
  generatedAt: z.iso.datetime(),
  /** Whether timings were tightened against real audio (rough-cut spec 0003). */
  wordsAligned: z.boolean(),
  source: transcriptSourceSchema,
  /**
   * May be empty. A document with zero segments is structurally valid and
   * parses (AC-14) — refusing to plan against an empty transcript is the
   * planner's judgement to make, not the parser's.
   */
  segments: z
    .array(transcriptSegmentSchema)
    .max(
      MAX_SEGMENT_COUNT,
      `Transcript exceeds the segment count limit of ${MAX_SEGMENT_COUNT} segments.`
    ),
});

/**
 * Checks the invariants a per-field schema cannot express: times never
 * decrease, spans never invert, words stay inside their segment, and a
 * `"rough-cut"` document always carries a real frame rate. These are what make
 * the parser a genuine contract rather than a shape check — a document that
 * passes here cannot report a position that walks backwards on the timeline
 * (AC-12).
 */
export const transcriptDocumentSchema = baseDocumentSchema.superRefine((doc, ctx) => {
  if (doc.source.kind === "rough-cut" && doc.fps === null) {
    ctx.addIssue({
      code: "custom",
      path: ["fps"],
      message:
        "A rough-cut document must carry the detected frame rate; only an import may have a null fps.",
    });
  }

  // **An imported subtitle's cues are allowed to overlap**, for the same reason
  // adjacent words are (see the long note below).
  //
  // Rough Cut collapses its segments against an EDL, so they come out disjoint
  // by construction and an overlap there really is a bug worth catching. A
  // subtitle file is not built that way. Caption cues routinely overlap by a
  // fraction of a second where one cue is held on screen a moment past the
  // start of the next, and both of those times were measured. Rejecting the
  // overlap would leave only bad options: refuse a real caption file outright,
  // or shorten a cue to a boundary no measurement supports — the second being
  // exactly the fabrication this format exists to prevent.
  //
  // So an import is held to the rule the spec actually states, times never
  // *decrease*, checked on `start` against the previous `start`. A Rough Cut
  // document keeps the stricter disjointness check, because there it is true.
  const cuesMayOverlap = doc.source.kind === "import";

  let previousStart = -Infinity;
  let previousEnd = -Infinity;
  doc.segments.forEach((segment, index) => {
    if (segment.end < segment.start) {
      ctx.addIssue({
        code: "custom",
        path: ["segments", index, "end"],
        message: "Segment end is before its start.",
      });
    }
    if (segment.start < (cuesMayOverlap ? previousStart : previousEnd)) {
      ctx.addIssue({
        code: "custom",
        path: ["segments", index, "start"],
        message: cuesMayOverlap
          ? "Segment starts before the previous segment did; times must never decrease."
          : "Segment starts before the previous segment ended; times must never decrease.",
      });
    }
    previousStart = segment.start;
    previousEnd = Math.max(previousEnd, segment.end);

    // Word ordering is checked on `start`, not against the previous word's
    // `end`, because **adjacent words are allowed to overlap**.
    //
    // Speech recognizers do not report clean, disjoint word spans. A fast
    // compound ("United States", "Patrice Lumumba") routinely comes back with
    // both words sharing a start, or the first word's end reaching past the
    // second word's start. Rough Cut's `sanitizeWords` already knows this and
    // deliberately leaves a shared-start pair alone, because clipping one to
    // the other would produce a zero length word.
    //
    // Rejecting the overlap here would leave only bad options: drop a word the
    // creator really said, or invent a boundary between two words that no
    // measurement separates. The second is precisely the fabrication this
    // format exists to prevent. So the honest rule is the one the spec
    // actually states — times never *decrease* — and an overlap is not a
    // decrease. Positions still march forward; two of them just share a moment.
    let previousWordStart = -Infinity;
    segment.words?.forEach((word, wordIndex) => {
      const at = ["segments", index, "words", wordIndex] as const;
      if (word.end < word.start) {
        ctx.addIssue({
          code: "custom",
          path: [...at, "end"],
          message: "Word end is before its start.",
        });
      }
      if (word.start < previousWordStart) {
        ctx.addIssue({
          code: "custom",
          path: [...at, "start"],
          message: "Word starts before the previous word did; times must never decrease.",
        });
      }
      if (word.start < segment.start || word.end > segment.end) {
        ctx.addIssue({
          code: "custom",
          path: [...at],
          message: "Word falls outside the span of the segment holding it.",
        });
      }
      previousWordStart = word.start;
    });
  });
});

export type TranscriptDocument = z.infer<typeof transcriptDocumentSchema>;
export type TranscriptSegment = z.infer<typeof transcriptSegmentSchema>;
export type TranscriptWord = z.infer<typeof transcriptWordSchema>;
export type TranscriptSource = z.infer<typeof transcriptSourceSchema>;
export type TranscriptFps = z.infer<typeof videoFpsSchema>;
