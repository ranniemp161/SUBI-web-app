import { describe, it, expect } from "vitest";
import { formatTimecode } from "@repo/transcript/timebase";
import { collapseTranscriptToCut } from "@/lib/export/transcript-collapse";
import type { EDL, Transcript, TranscriptWord } from "@/lib/edl";

const FPS_30 = { numerator: 30, denominator: 1 };
const NTSC_2997 = { numerator: 30000, denominator: 1001 };

function word(text: string, start: number, end: number, confidence?: number): TranscriptWord {
  return confidence === undefined
    ? { word: text, start, end, confidence: 0.99 }
    : { word: text, start, end, confidence };
}

function transcript(words: TranscriptWord[], utteranceEnds?: number[]): Transcript {
  return {
    words,
    text: words.map((w) => w.word).join(" "),
    duration: words.length ? words[words.length - 1].end : 0,
    ...(utteranceEnds ? { utteranceEnds } : {}),
  };
}

/** An EDL from alternating spans: `[start, end, "keep" | "cut"]`. */
function edl(spans: [number, number, "keep" | "cut"][]): EDL {
  return {
    segments: spans.map(([start, end, status]) => ({ start, end, status, reason: null })),
  };
}

describe("collapseTranscriptToCut — removed time is really subtracted", () => {
  it("shifts everything after a cut back by the cut's length (AC-12)", () => {
    const result = collapseTranscriptToCut(
      edl([
        [0, 2, "keep"],
        [2, 5, "cut"],
        [5, 8, "keep"],
      ]),
      transcript([word("one", 0, 1), word("after", 6, 7)]),
      FPS_30
    );

    expect(result.duration).toBe(5);
    const flat = result.segments.flatMap((s) => s.words ?? []);
    // 6s in the source is 3s on the cut: the 3s cut before it is gone.
    expect(flat.map((w) => [w.word, w.start, w.end])).toEqual([
      ["one", 0, 1],
      ["after", 3, 4],
    ]);
  });

  it("puts no time inside a cut range and never lets times decrease (AC-12)", () => {
    const result = collapseTranscriptToCut(
      edl([
        [0, 1, "keep"],
        [1, 4, "cut"],
        [4, 5, "keep"],
        [5, 9, "cut"],
        [9, 10, "keep"],
      ]),
      transcript([word("a", 0, 0.9), word("b", 4.1, 4.9), word("c", 9.1, 9.9)]),
      FPS_30
    );

    const times = result.segments.flatMap((s) => [s.start, s.end]);
    expect(times).toEqual([...times].sort((a, b) => a - b));
    expect(Math.max(...times)).toBeLessThanOrEqual(result.duration);
  });

  it("lands a word at 2:35 on the cut and names it in drop-frame timecode (AC-12)", () => {
    // 20s of cuts before it, so the word sits at 175s in the source and 155s —
    // 2:35 — on the final cut.
    const result = collapseTranscriptToCut(
      edl([
        [0, 100, "keep"],
        [100, 120, "cut"],
        [120, 200, "keep"],
      ]),
      transcript([word("here", 175, 175.5)]),
      NTSC_2997
    );
    const [only] = result.segments.flatMap((s) => s.words ?? []);
    expect(only.start).toBe(155);
    // 155.000s is frame 4645, which drop-frame labels 00:02:34;29 — the last
    // frame before 00:02:35;00, and the ';' says the count really is
    // drop-frame. Rounding this to a friendlier-looking "2:35" is exactly the
    // silent half-second error the exact rational exists to prevent.
    expect(formatTimecode(only.start, NTSC_2997)).toBe("00:02:34;29");
    expect(formatTimecode(155 + 1 / 30, NTSC_2997)).toBe("00:02:35;00");
  });
});

describe("the clamp rule (AC-11)", () => {
  it("clamps a word a razor cut through its middle, rather than losing it", () => {
    const result = collapseTranscriptToCut(
      edl([
        [0, 1, "keep"],
        [1, 2, "cut"],
      ]),
      transcript([word("split", 0.5, 1.5)]),
      FPS_30
    );
    const [only] = result.segments.flatMap((s) => s.words ?? []);
    expect([only.start, only.end]).toEqual([0.5, 1]);
  });

  it("drops a word whose surviving remainder is under one frame", () => {
    // 1/30s is 0.0333s; 0.02s of this word survives.
    const result = collapseTranscriptToCut(
      edl([
        [0, 1, "keep"],
        [1, 2, "cut"],
      ]),
      transcript([word("gone", 0.98, 1.5)]),
      FPS_30
    );
    expect(result.segments).toEqual([]);
  });

  it("keeps a remainder of exactly one frame", () => {
    const result = collapseTranscriptToCut(
      edl([
        [0, 1, "keep"],
        [1, 2, "cut"],
      ]),
      transcript([word("kept", 1 - 1 / 30, 1.5)]),
      FPS_30
    );
    expect(result.segments.flatMap((s) => s.words ?? [])).toHaveLength(1);
  });

  it("measures the threshold at the document's real rate, not a fixed one", () => {
    // 0.03s survives: under a frame at 30fps, over a frame at 60fps.
    const spans: [number, number, "keep" | "cut"][] = [
      [0, 1, "keep"],
      [1, 2, "cut"],
    ];
    const words = transcript([word("edge", 0.97, 1.4)]);
    expect(collapseTranscriptToCut(edl(spans), words, FPS_30).segments).toEqual([]);
    expect(
      collapseTranscriptToCut(edl(spans), words, { numerator: 60, denominator: 1 }).segments
    ).toHaveLength(1);
  });

  it("collapses a word straddling two kept ranges to its larger fragment, never two entries", () => {
    const result = collapseTranscriptToCut(
      edl([
        [0, 1.2, "keep"],
        [1.2, 1.5, "cut"],
        [1.5, 3, "keep"],
      ]),
      // 0.2s survives on the left, 0.5s on the right — the right wins.
      transcript([word("straddle", 1, 2)]),
      FPS_30
    );
    const words = result.segments.flatMap((s) => s.words ?? []);
    expect(words).toHaveLength(1);
    // The right fragment [1.5, 2) with 0.3s of cut removed lands at [1.2, 1.7).
    expect([words[0].start, words[0].end]).toEqual([1.2, 1.7]);
  });

  it("passes confidence through unchanged, and leaves an absent one absent (AC-6)", () => {
    const measured = word("measured", 0, 0.5, 0.42);
    const unmeasured = { word: "unmeasured", start: 0.6, end: 1 } as TranscriptWord;
    const result = collapseTranscriptToCut(
      edl([[0, 2, "keep"]]),
      transcript([measured, unmeasured]),
      FPS_30
    );
    const [a, b] = result.segments.flatMap((s) => s.words ?? []);
    expect(a.confidence).toBe(0.42);
    expect(b).not.toHaveProperty("confidence");
  });
});

describe("segment boundaries (AC-12)", () => {
  it("splits a kept range at an utterance end, snapped to a real word end", () => {
    // The raw utterance end (1.04) is not any word's time; the boundary must
    // be the last word end at or before it, which is 1.0.
    const result = collapseTranscriptToCut(
      edl([[0, 4, "keep"]]),
      transcript(
        [word("first", 0, 0.5), word("utterance", 0.6, 1), word("second", 2, 2.5)],
        [1.04]
      ),
      FPS_30
    );
    expect(result.segments).toHaveLength(2);
    expect(result.segments[0].end).toBe(1);
    expect(result.segments[1].start).toBe(1);
    expect(result.segments[0].text).toBe("first utterance");
    expect(result.segments[1].text).toBe("second");
  });

  it("never uses a raw utteranceEnd that matches no word", () => {
    const result = collapseTranscriptToCut(
      edl([[0, 4, "keep"]]),
      transcript([word("a", 0, 0.5), word("b", 1, 1.5)], [0.73]),
      FPS_30
    );
    const boundaries = result.segments.flatMap((s) => [s.start, s.end]);
    expect(boundaries).not.toContain(0.73);
    expect(boundaries).toContain(0.5);
  });

  it("breaks segments at kept-range edges too", () => {
    const result = collapseTranscriptToCut(
      edl([
        [0, 1, "keep"],
        [1, 2, "cut"],
        [2, 3, "keep"],
      ]),
      transcript([word("a", 0.1, 0.9), word("b", 2.1, 2.9)]),
      FPS_30
    );
    expect(result.segments).toHaveLength(2);
  });

  it("keeps a segment around a word that ends after the next word ends", () => {
    // Real shape from a live transcript: "and"[7.71, 7.805] then
    // "then"[7.71, 7.77]. Words are ordered by start, so with an overlap the
    // last entry is not the one that ends last. Taking the segment's end from
    // the last entry left "and" hanging outside its own segment.
    //
    // The utterance end has to sit just past 7.805 for this to bite: the
    // boundary snaps to the end of the last word at or before it, which is
    // "then" at 7.77 — putting the segment edge *inside* "and".
    const result = collapseTranscriptToCut(
      edl([[0, 10, "keep"]]),
      transcript(
        [word("and", 7.71, 7.805), word("then", 7.71, 7.77), word("we", 7.9, 8.1)],
        [7.81]
      ),
      FPS_30
    );
    // The boundary really did land mid word — otherwise this proves nothing.
    expect(result.segments.length).toBeGreaterThan(1);
    expect(result.segments[0].end).toBeGreaterThanOrEqual(7.805);
    for (const segment of result.segments) {
      for (const w of segment.words ?? []) {
        expect(w.start).toBeGreaterThanOrEqual(segment.start);
        expect(w.end).toBeLessThanOrEqual(segment.end);
      }
    }
  });

  it("places every word inside the segment holding it", () => {
    const result = collapseTranscriptToCut(
      edl([[0, 10, "keep"]]),
      transcript(
        [word("a", 0, 1), word("b", 1.2, 2), word("c", 3, 4)],
        [2.1]
      ),
      FPS_30
    );
    for (const segment of result.segments) {
      for (const w of segment.words ?? []) {
        expect(w.start).toBeGreaterThanOrEqual(segment.start);
        expect(w.end).toBeLessThanOrEqual(segment.end);
      }
    }
  });
});

describe("kept ranges with no speech", () => {
  it("emits no segment for a wordless kept range but still counts its runtime", () => {
    const result = collapseTranscriptToCut(
      edl([
        [0, 1, "keep"],
        [1, 2, "cut"],
        [2, 3, "keep"],
      ]),
      transcript([word("only", 0.1, 0.9)]),
      FPS_30
    );
    expect(result.segments).toHaveLength(1);
    // The silent kept range still ran, so it still counts toward duration.
    expect(result.duration).toBe(2);
  });

  it("returns an empty, valid result for a transcript with no words (AC-14)", () => {
    const result = collapseTranscriptToCut(edl([[0, 5, "keep"]]), transcript([]), FPS_30);
    expect(result.segments).toEqual([]);
    expect(result.duration).toBe(5);
  });

  it("returns nothing when every segment is cut", () => {
    const result = collapseTranscriptToCut(
      edl([[0, 5, "cut"]]),
      transcript([word("gone", 1, 2)]),
      FPS_30
    );
    expect(result.segments).toEqual([]);
    expect(result.duration).toBe(0);
  });
});
