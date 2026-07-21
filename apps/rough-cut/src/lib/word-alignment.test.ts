import { describe, it, expect } from "vitest";
import {
  refineWords,
  applyManualEditGuard,
  SEARCH_WINDOW_SECONDS,
  type EnergyEnvelope,
} from "./word-alignment";
import type { EDL, TranscriptWord } from "./edl";

const BUCKET_SECONDS = 0.005;

/** Builds a synthetic envelope from a list of [startSeconds, endSeconds, level] speech spans over silence. */
function buildEnvelope(
  durationSeconds: number,
  spans: Array<[number, number, number]>,
  silenceLevel = 0.01
): EnergyEnvelope {
  const buckets = Math.ceil(durationSeconds / BUCKET_SECONDS);
  const rms = new Float32Array(buckets).fill(silenceLevel);
  for (const [start, end, level] of spans) {
    const from = Math.round(start / BUCKET_SECONDS);
    const to = Math.round(end / BUCKET_SECONDS);
    for (let i = from; i < to && i < buckets; i++) rms[i] = level;
  }
  return { rms, bucketSeconds: BUCKET_SECONDS, duration: durationSeconds };
}

function word(w: Partial<TranscriptWord> & { start: number; end: number }): TranscriptWord {
  return { word: "x", confidence: 1, ...w };
}

describe("refineWords", () => {
  it("snaps a word's start/end to the nearest real speech boundary within the search window", async () => {
    // Real speech: 0.5s to 1.0s. Deepgram reported it slightly off on both ends.
    const envelope = buildEnvelope(2, [[0.5, 1.0, 1.0]]);
    const words = [word({ start: 0.53, end: 0.97 })];

    const [refined] = await refineWords(envelope, words);

    expect(refined.aligned).toBe(true);
    expect(refined.start).toBeCloseTo(0.5, 3);
    expect(refined.end).toBeCloseTo(1.0, 3);
  });

  it("leaves the word's original timestamps and no aligned flag when the window is flat (no usable signal)", async () => {
    // Uniform noise floor, no speech-vs-silence contrast anywhere in the window.
    const envelope = buildEnvelope(2, []);
    const original = word({ start: 0.6, end: 0.9 });

    const [refined] = await refineWords(envelope, [original]);

    expect(refined.aligned).toBeUndefined();
    expect(refined.start).toBe(original.start);
    expect(refined.end).toBe(original.end);
  });

  it("ignores a crossing that doesn't hold long enough to be confident (rejects a single noisy sample)", async () => {
    // A single 5ms energy blip, not a sustained onset — should not count as a boundary.
    const envelope = buildEnvelope(2, [[0.5, 0.505, 1.0]]);
    const original = word({ start: 0.5, end: 0.9 });

    const [refined] = await refineWords(envelope, [original]);

    expect(refined.aligned).toBeUndefined();
    expect(refined.start).toBe(original.start);
    expect(refined.end).toBe(original.end);
  });

  it("never refines only one side: start and end both change together or not at all", async () => {
    // Speech begins cleanly (a real onset in window) but never ends within
    // this word's end-search window (still speech throughout) — no offset
    // candidate exists, so the whole word must stay untouched.
    const envelope = buildEnvelope(2, [[0.5, 2, 1.0]]);
    const original = word({ start: 0.53, end: 0.9 });

    const [refined] = await refineWords(envelope, [original]);

    expect(refined.aligned).toBeUndefined();
    expect(refined.start).toBe(original.start);
    expect(refined.end).toBe(original.end);
  });

  it("does not search past SEARCH_WINDOW_SECONDS from the reported timestamp", async () => {
    const farBoundary = 0.5 + SEARCH_WINDOW_SECONDS + 0.05; // just outside the window
    const envelope = buildEnvelope(2, [[farBoundary, 1.5, 1.0]]);
    const original = word({ start: 0.5, end: 0.9 });

    const [refined] = await refineWords(envelope, [original]);

    expect(refined.aligned).toBeUndefined();
    expect(refined.start).toBe(original.start);
  });

  it("processes a large word list (batched with yields) without dropping or reordering words", async () => {
    const envelope = buildEnvelope(2, [[0.5, 1.0, 1.0]]);
    const words = Array.from({ length: 1200 }, (_, i) =>
      word({ start: 1.2, end: 1.3, word: `w${i}` })
    );

    const refined = await refineWords(envelope, words);

    expect(refined).toHaveLength(1200);
    expect(refined.map((w) => w.word)).toEqual(words.map((w) => w.word));
  });
});

describe("applyManualEditGuard", () => {
  const original = [
    word({ word: "one", start: 0.5, end: 0.8 }),
    word({ word: "two", start: 1.5, end: 1.8 }),
  ];
  const refined = [
    word({ word: "one", start: 0.51, end: 0.79, aligned: true }),
    word({ word: "two", start: 1.49, end: 1.81, aligned: true }),
  ];

  it("reverts a word touched by a manual EDL segment to its pre-refinement timestamp", () => {
    const edl: EDL = {
      segments: [
        { start: 0.4, end: 0.9, status: "cut", reason: "manual" },
        { start: 0.9, end: 2, status: "keep", reason: null },
      ],
    };

    const guarded = applyManualEditGuard(refined, original, edl);

    // Word "one" overlaps the manual cut — reverted to the original.
    expect(guarded[0]).toEqual(original[0]);
    // Word "two" doesn't overlap any manual segment — refinement stands.
    expect(guarded[1]).toEqual(refined[1]);
  });

  it("leaves every word refined when the EDL has no manual segments", () => {
    const edl: EDL = {
      segments: [{ start: 0, end: 2, status: "keep", reason: "silence" }],
    };

    expect(applyManualEditGuard(refined, original, edl)).toEqual(refined);
  });

  it("leaves every word refined when there is no EDL yet", () => {
    expect(applyManualEditGuard(refined, original, null)).toEqual(refined);
  });

  it("does not revert a word whose span merely borders, but doesn't overlap, a manual segment", () => {
    // Manual segment ends exactly where word "one" starts — touching, not overlapping.
    const edl: EDL = {
      segments: [{ start: 0, end: 0.5, status: "cut", reason: "manual" }],
    };

    expect(applyManualEditGuard(refined, original, edl)).toEqual(refined);
  });
});
