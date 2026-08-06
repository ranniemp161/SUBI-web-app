import { describe, it, expect } from "vitest";
import {
  MAX_SEGMENT_COUNT,
  TRANSCRIPT_DOCUMENT_VERSION,
  transcriptDocumentSchema,
  type TranscriptDocument,
} from "./document";

const NTSC_2997 = { numerator: 30000, denominator: 1001 };

function doc(overrides: Partial<TranscriptDocument> = {}): unknown {
  return {
    version: TRANSCRIPT_DOCUMENT_VERSION,
    fps: NTSC_2997,
    duration: 10,
    generatedAt: "2026-08-05T12:00:00.000Z",
    wordsAligned: false,
    source: { kind: "rough-cut", projectId: "p1", edlFingerprint: "abc" },
    segments: [{ start: 0, end: 2, text: "hello there" }],
    ...overrides,
  };
}

describe("transcriptDocumentSchema", () => {
  it("accepts a well-formed rough-cut document", () => {
    expect(transcriptDocumentSchema.parse(doc())).toMatchObject({ version: 1 });
  });

  it("accepts a document with zero segments — refusing an empty transcript is the planner's job (AC-14)", () => {
    const parsed = transcriptDocumentSchema.parse(doc({ segments: [] }));
    expect(parsed.segments).toEqual([]);
  });

  it("accepts a segment with no words, the shape a plain SRT import produces (AC-5)", () => {
    const parsed = transcriptDocumentSchema.parse(
      doc({
        fps: null,
        source: { kind: "import", projectId: null, edlFingerprint: null },
      })
    );
    expect(parsed.segments[0].words).toBeUndefined();
  });

  it("never defaults a missing confidence — an absent measurement stays absent (AC-6)", () => {
    const parsed = transcriptDocumentSchema.parse(
      doc({
        segments: [
          { start: 0, end: 2, text: "hi", words: [{ word: "hi", start: 0, end: 2 }] },
        ],
      })
    );
    expect(parsed.segments[0].words![0]).not.toHaveProperty("confidence");
  });

  it("rejects a rough-cut document with no frame rate", () => {
    const result = transcriptDocumentSchema.safeParse(doc({ fps: null }));
    expect(result.success).toBe(false);
    expect(result.error!.issues[0].message).toMatch(/must carry the detected frame rate/);
  });

  it("allows a null frame rate only on an import", () => {
    const result = transcriptDocumentSchema.safeParse(
      doc({ fps: null, source: { kind: "import", projectId: null, edlFingerprint: null } })
    );
    expect(result.success).toBe(true);
  });

  it("accepts adjacent words that overlap, which real speech recognition produces", () => {
    // Taken verbatim from a real export that this schema used to reject:
    // Deepgram gave "United" and "States" the same start, and the word
    // boundary refinement pass left them that way. Rejecting this would force
    // either dropping a spoken word or inventing a boundary between the two.
    const result = transcriptDocumentSchema.safeParse(
      doc({
        segments: [
          {
            start: 0,
            end: 2,
            text: "United States",
            words: [
              { word: "United", start: 0.765, end: 0.865 },
              { word: "States", start: 0.765, end: 1.29 },
            ],
          },
        ],
      })
    );
    expect(result.success).toBe(true);
  });

  it("accepts a word that ends after the next word ends, the same overlap the other way", () => {
    // Also real: "and"[7.71, 7.805] then "then"[7.71, 7.77].
    const result = transcriptDocumentSchema.safeParse(
      doc({
        segments: [
          {
            start: 7.7,
            end: 8.1,
            text: "and then",
            words: [
              { word: "and", start: 7.71, end: 7.805 },
              { word: "then", start: 7.71, end: 7.77 },
            ],
          },
        ],
      })
    );
    expect(result.success).toBe(true);
  });

  it("still rejects a word that genuinely starts before the previous one did", () => {
    const result = transcriptDocumentSchema.safeParse(
      doc({
        segments: [
          {
            start: 0,
            end: 2,
            text: "backwards",
            words: [
              { word: "second", start: 1, end: 1.5 },
              { word: "first", start: 0.2, end: 0.5 },
            ],
          },
        ],
      })
    );
    expect(result.success).toBe(false);
    expect(result.error!.issues[0].message).toMatch(/before the previous word did/);
  });

  it("rejects segments whose times decrease (AC-12)", () => {
    const result = transcriptDocumentSchema.safeParse(
      doc({
        segments: [
          { start: 0, end: 5, text: "one" },
          { start: 3, end: 8, text: "two" },
        ],
      })
    );
    expect(result.success).toBe(false);
    expect(result.error!.issues[0].message).toMatch(/times must never decrease/);
  });

  it("rejects an inverted span", () => {
    const result = transcriptDocumentSchema.safeParse(
      doc({ segments: [{ start: 5, end: 2, text: "backwards" }] })
    );
    expect(result.success).toBe(false);
  });

  it("rejects a word that escapes the segment holding it", () => {
    const result = transcriptDocumentSchema.safeParse(
      doc({
        segments: [
          { start: 0, end: 2, text: "hi", words: [{ word: "hi", start: 0, end: 9 }] },
        ],
      })
    );
    expect(result.success).toBe(false);
    expect(result.error!.issues[0].message).toMatch(/outside the span of the segment/);
  });

  it("rejects a document over the segment count cap, naming the limit (AC-13)", () => {
    const segments = Array.from({ length: MAX_SEGMENT_COUNT + 1 }, (_, i) => ({
      start: i,
      end: i + 0.5,
      text: "x",
    }));
    const result = transcriptDocumentSchema.safeParse(doc({ segments }));
    expect(result.success).toBe(false);
    expect(result.error!.issues.some((i) => /segment count limit/.test(i.message))).toBe(true);
  });

  it("rejects an unknown format version", () => {
    expect(transcriptDocumentSchema.safeParse(doc({ version: 2 as never })).success).toBe(false);
  });
});
