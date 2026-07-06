import { describe, it, expect } from "vitest";
import {
  sanitizeAiRanges,
  applyAiCuts,
  type AiCuts,
  type AiCutRange,
} from "./ai-cuts";
import type { EDL, TranscriptWord } from "./edl";

function w(word: string, start: number, end: number): TranscriptWord {
  return { word, start, end, confidence: 1 };
}

/** Ten contiguous one-second words: [0]w0 0–1, [1]w1 1–2, … [9]w9 9–10. */
const TEN_WORDS: TranscriptWord[] = Array.from({ length: 10 }, (_, i) =>
  w(`w${i}`, i, i + 1)
);

function aiCuts(ranges: AiCutRange[]): AiCuts {
  return { ranges, model: "test", createdAt: "2026-07-04T00:00:00Z" };
}

function keepAll(duration: number): EDL {
  return { segments: [{ start: 0, end: duration, status: "keep", reason: null }] };
}

describe("sanitizeAiRanges", () => {
  it("returns [] for non-array input and for an empty word list", () => {
    expect(sanitizeAiRanges(null, 10)).toEqual([]);
    expect(sanitizeAiRanges({ cuts: [] }, 10)).toEqual([]);
    expect(sanitizeAiRanges("nope", 10)).toEqual([]);
    expect(sanitizeAiRanges([{ startWordIndex: 0, endWordIndex: 1, category: "retake" }], 0)).toEqual([]);
  });

  it("drops malformed entries but keeps the valid ones around them", () => {
    const result = sanitizeAiRanges(
      [
        { startWordIndex: 1, endWordIndex: 2, category: "retake" },
        { startWordIndex: 1.5, endWordIndex: 2, category: "retake" }, // non-integer
        { startWordIndex: -1, endWordIndex: 2, category: "retake" }, // negative
        { startWordIndex: 4, endWordIndex: 5 }, // missing category
        { startWordIndex: 4, endWordIndex: 5, category: "pacing" }, // unknown category
        "garbage",
        { startWordIndex: 7, endWordIndex: 8, category: "stumble", note: "flub" },
      ],
      10
    );
    expect(result).toEqual([
      { startWordIndex: 1, endWordIndex: 2, category: "retake" },
      { startWordIndex: 7, endWordIndex: 8, category: "stumble", note: "flub" },
    ]);
  });

  it("clamps an overrunning end to the last word and drops fully out-of-range or inverted spans", () => {
    const result = sanitizeAiRanges(
      [
        { startWordIndex: 8, endWordIndex: 25, category: "retake" }, // clamped to 9
        { startWordIndex: 10, endWordIndex: 12, category: "retake" }, // start past the words
        { startWordIndex: 5, endWordIndex: 2, category: "retake" }, // inverted
      ],
      10
    );
    expect(result).toEqual([{ startWordIndex: 8, endWordIndex: 9, category: "retake" }]);
  });

  it("sorts and coalesces overlapping/adjacent spans so counts stay honest", () => {
    const result = sanitizeAiRanges(
      [
        { startWordIndex: 6, endWordIndex: 7, category: "stumble" },
        { startWordIndex: 0, endWordIndex: 2, category: "false_start" },
        { startWordIndex: 2, endWordIndex: 4, category: "retake" }, // overlaps the first
      ],
      10
    );
    expect(result).toEqual([
      { startWordIndex: 0, endWordIndex: 4, category: "false_start" },
      { startWordIndex: 6, endWordIndex: 7, category: "stumble" },
    ]);
  });
});

describe("applyAiCuts", () => {
  it("returns the EDL untouched when there are no AI cuts", () => {
    const edl = keepAll(10);
    expect(applyAiCuts(edl, null, TEN_WORDS)).toBe(edl);
    expect(applyAiCuts(edl, aiCuts([]), TEN_WORDS)).toBe(edl);
  });

  it("marks each range's word span as a cut with reason \"ai\"", () => {
    const edl = applyAiCuts(
      keepAll(10),
      aiCuts([{ startWordIndex: 2, endWordIndex: 4, category: "retake" }]),
      TEN_WORDS
    );
    expect(edl.segments).toEqual([
      { start: 0, end: 2, status: "keep", reason: null },
      { start: 2, end: 5, status: "cut", reason: "ai" },
      { start: 5, end: 10, status: "keep", reason: null },
    ]);
  });

  it("skips ranges whose indices no longer resolve to words instead of throwing", () => {
    const edl = keepAll(10);
    const result = applyAiCuts(
      edl,
      aiCuts([{ startWordIndex: 50, endWordIndex: 60, category: "retake" }]),
      TEN_WORDS
    );
    expect(result.segments).toEqual(edl.segments);
  });

  it("never re-cuts a span the user explicitly restored (protectedKeeps wins)", () => {
    const edl: EDL = { ...keepAll(10), protectedKeeps: [{ start: 2, end: 5 }] };
    const result = applyAiCuts(
      edl,
      aiCuts([
        { startWordIndex: 2, endWordIndex: 4, category: "retake" }, // inside the protected span
        { startWordIndex: 7, endWordIndex: 8, category: "stumble" },
      ]),
      TEN_WORDS
    );
    expect(result.segments).toEqual([
      { start: 0, end: 7, status: "keep", reason: null },
      { start: 7, end: 9, status: "cut", reason: "ai" },
      { start: 9, end: 10, status: "keep", reason: null },
    ]);
  });
});

