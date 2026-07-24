import { describe, it, expect } from "vitest";
import {
  sanitizeAiRanges,
  applyAiCuts,
  selectBorderlineRanges,
  applyVerifyVerdicts,
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
    expect(sanitizeAiRanges(null, TEN_WORDS)).toEqual([]);
    expect(sanitizeAiRanges({ cuts: [] }, TEN_WORDS)).toEqual([]);
    expect(sanitizeAiRanges("nope", TEN_WORDS)).toEqual([]);
    expect(sanitizeAiRanges([{ startWordIndex: 0, endWordIndex: 1, category: "retake" }], [])).toEqual([]);
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
      TEN_WORDS
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
      TEN_WORDS
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
      TEN_WORDS
    );
    expect(result).toEqual([
      { startWordIndex: 0, endWordIndex: 4, category: "false_start" },
      { startWordIndex: 6, endWordIndex: 7, category: "stumble" },
    ]);
  });

  it("drops a range whose words the ASR wasn't confident about", () => {
    const shaky: TranscriptWord[] = TEN_WORDS.map((word, i) =>
      i >= 2 && i <= 4 ? { ...word, confidence: 0.3 } : word
    );
    const result = sanitizeAiRanges(
      [{ startWordIndex: 2, endWordIndex: 4, category: "retake" }],
      shaky
    );
    expect(result).toEqual([]);
  });

  it("keeps or drops a mixed-confidence range based on the average against the threshold", () => {
    // Average (0.7 + 0.7) / 2 = 0.7 — at/above threshold, kept.
    const justAbove: TranscriptWord[] = TEN_WORDS.map((word, i) =>
      i === 2 || i === 3 ? { ...word, confidence: 0.7 } : word
    );
    expect(
      sanitizeAiRanges([{ startWordIndex: 2, endWordIndex: 3, category: "retake" }], justAbove)
    ).toEqual([{ startWordIndex: 2, endWordIndex: 3, category: "retake" }]);

    // Average (0.2 + 0.2) / 2 = 0.2 — below threshold, dropped.
    const belowThreshold: TranscriptWord[] = TEN_WORDS.map((word, i) =>
      i === 2 || i === 3 ? { ...word, confidence: 0.2 } : word
    );
    expect(
      sanitizeAiRanges([{ startWordIndex: 2, endWordIndex: 3, category: "retake" }], belowThreshold)
    ).toEqual([]);
  });

  it("doesn't let one shaky word sink an otherwise confident range's average", () => {
    // Range covers indices 0-4: four words at confidence 1, one at 0.3.
    // Average = (1+1+1+1+0.3)/5 = 0.86 — comfortably above threshold.
    const oneShakyWord: TranscriptWord[] = TEN_WORDS.map((word, i) =>
      i === 2 ? { ...word, confidence: 0.3 } : word
    );
    const result = sanitizeAiRanges(
      [{ startWordIndex: 0, endWordIndex: 4, category: "retake" }],
      oneShakyWord
    );
    expect(result).toEqual([{ startWordIndex: 0, endWordIndex: 4, category: "retake" }]);
  });

  it("drops a range whose model-reported confidence is low", () => {
    const result = sanitizeAiRanges(
      [{ startWordIndex: 1, endWordIndex: 2, category: "retake", modelConfidence: 0.2 }],
      TEN_WORDS
    );
    expect(result).toEqual([]);
  });

  it("keeps a range whose model-reported confidence is high", () => {
    const result = sanitizeAiRanges(
      [{ startWordIndex: 1, endWordIndex: 2, category: "retake", modelConfidence: 0.9 }],
      TEN_WORDS
    );
    expect(result).toEqual([
      { startWordIndex: 1, endWordIndex: 2, category: "retake", modelConfidence: 0.9 },
    ]);
  });

  it("keeps a range with no model-reported confidence at all (defensive default)", () => {
    const result = sanitizeAiRanges(
      [{ startWordIndex: 1, endWordIndex: 2, category: "retake" }],
      TEN_WORDS
    );
    expect(result).toEqual([{ startWordIndex: 1, endWordIndex: 2, category: "retake" }]);
  });
});

describe("selectBorderlineRanges", () => {
  const range = (startWordIndex: number, modelConfidence?: number): AiCutRange => ({
    startWordIndex,
    endWordIndex: startWordIndex,
    category: "retake",
    modelConfidence,
  });

  it("selects a range whose confidence sits inside [min, maxConfidence)", () => {
    const result = selectBorderlineRanges([range(1, 0.6)], 0.8, 30);
    expect(result).toEqual([range(1, 0.6)]);
  });

  it("excludes a range at or above the confidence ceiling", () => {
    const result = selectBorderlineRanges([range(1, 0.9)], 0.8, 30);
    expect(result).toEqual([]);
  });

  it("excludes a range with no modelConfidence at all", () => {
    const result = selectBorderlineRanges([range(1, undefined)], 0.8, 30);
    expect(result).toEqual([]);
  });

  it("truncates to the first N matches in array order", () => {
    const ranges = [range(1, 0.6), range(2, 0.65), range(3, 0.7)];
    const result = selectBorderlineRanges(ranges, 0.8, 2);
    expect(result).toEqual([range(1, 0.6), range(2, 0.65)]);
  });
});

describe("applyVerifyVerdicts", () => {
  const range = (startWordIndex: number): AiCutRange => ({
    startWordIndex,
    endWordIndex: startWordIndex,
    category: "retake",
  });

  it("drops a range flagged to restore", () => {
    const result = applyVerifyVerdicts([range(1), range(2)], new Set([1]));
    expect(result).toEqual([range(2)]);
  });

  it("keeps a range not flagged to restore", () => {
    const result = applyVerifyVerdicts([range(1), range(2)], new Set([3]));
    expect(result).toEqual([range(1), range(2)]);
  });

  it("changes nothing when the restore set is empty", () => {
    const ranges = [range(1), range(2)];
    expect(applyVerifyVerdicts(ranges, new Set())).toEqual(ranges);
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

