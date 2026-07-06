import { describe, it, expect } from "vitest";
import {
  absorbCutResidue,
  changedSpan,
  splitAt,
  setRangeStatus,
  generateInitialEDL,
  buildInitialEDL,
  reRoughCut,
  restoreSegment,
  pinTrimmedBoundary,
  trimBoundary,
  keptDuration,
  cutEachWord,
  isFillerWord,
  findFillerWords,
  groupWordsIntoParagraphs,
  type EDL,
  type TranscriptWord,
} from "./edl";

/** A single full-length kept clip — the common starting point. */
function keep(durationSeconds: number): EDL {
  return {
    segments: [
      { start: 0, end: durationSeconds, status: "keep", reason: null },
    ],
  };
}

function word(start: number, end: number): TranscriptWord {
  return { word: "x", start, end, confidence: 1 };
}

describe("buildInitialEDL — repetition pass integration", () => {
  it("labels a stutter cut with reason \"repetition\", keeping the last instance", () => {
    const words: TranscriptWord[] = [
      { word: "cut", start: 0, end: 0.2, confidence: 1 },
      { word: "the", start: 0.25, end: 0.45, confidence: 1 },
      { word: "the", start: 0.5, end: 0.7, confidence: 1 },
      { word: "clip", start: 0.75, end: 0.95, confidence: 1 },
    ];
    const edl = buildInitialEDL(words, 1);
    expect(edl.segments).toContainEqual({
      start: 0.25,
      end: 0.45,
      status: "cut",
      reason: "repetition",
    });
    // The second "the" stays kept.
    expect(
      edl.segments.find((s) => s.start <= 0.5 && s.end >= 0.7)?.status
    ).toBe("keep");
  });
});

describe("splitAt (razor)", () => {
  it("divides a kept clip into two, flagging the right half as a split", () => {
    const result = splitAt(keep(10), 5);
    expect(result.segments).toEqual([
      { start: 0, end: 5, status: "keep", reason: null },
      { start: 5, end: 10, status: "keep", reason: null, split: true },
    ]);
  });

  it("is a no-op when the playhead is inside a cut span", () => {
    const edl: EDL = {
      segments: [{ start: 0, end: 10, status: "cut", reason: "silence" }],
    };
    expect(splitAt(edl, 5)).toBe(edl);
  });

  it("is a no-op at (or within epsilon of) an existing boundary", () => {
    const edl = splitAt(keep(10), 5);
    expect(splitAt(edl, 5)).toBe(edl);
    expect(splitAt(edl, 0)).toBe(edl);
    expect(splitAt(edl, 10)).toBe(edl);
  });

  it("keeps the razor boundary from re-merging when a cut is made elsewhere", () => {
    const split = splitAt(keep(10), 5); // [0,5] | [5,10 split]
    const cut = setRangeStatus(split, 2, 3, "cut", "manual");
    // The boundary at 5 must survive: the two kept halves stay separate.
    expect(cut.segments).toEqual([
      { start: 0, end: 2, status: "keep", reason: null },
      { start: 2, end: 3, status: "cut", reason: "manual" },
      { start: 3, end: 5, status: "keep", reason: null },
      { start: 5, end: 10, status: "keep", reason: null, split: true },
    ]);
  });
});

describe("setRangeStatus split-flag handling", () => {
  it("does not leave a phantom split on the right remainder of a cut", () => {
    const split = splitAt(keep(10), 5); // [0,5] | [5,10 split]
    const cut = setRangeStatus(split, 7, 8, "cut", "manual");
    const rightRemainder = cut.segments.find((s) => s.start === 8);
    expect(rightRemainder).toBeDefined();
    expect(rightRemainder!.split).toBeUndefined();
    // The razor boundary at 5 is still intact.
    expect(cut.segments.some((s) => s.start === 5 && s.split)).toBe(true);
  });

  it("preserves a razor boundary across cut-then-restore of an inner span", () => {
    const split = splitAt(keep(10), 5); // [0,5] | [5,10 split]
    const cut = setRangeStatus(split, 7, 8, "cut", "manual");
    const restored = setRangeStatus(cut, 7, 8, "keep", null);
    expect(restored.segments).toEqual([
      { start: 0, end: 5, status: "keep", reason: null },
      { start: 5, end: 10, status: "keep", reason: null, split: true },
    ]);
  });

  it("merges normally when no razor split is present", () => {
    const cut = setRangeStatus(keep(10), 4, 6, "cut", "manual");
    const restored = setRangeStatus(cut, 4, 6, "keep", null);
    expect(restored.segments).toEqual([
      { start: 0, end: 10, status: "keep", reason: null },
    ]);
  });
});

describe("generateInitialEDL (silence)", () => {
  it("cuts an interior gap over the threshold, padded inward on both edges", () => {
    // Gap 1s→3s (2s) exceeds the 0.7s balanced threshold; 0.1s pad each side.
    const edl = generateInitialEDL([word(0, 1), word(3, 4)], 4);
    expect(edl.segments).toEqual([
      { start: 0, end: 1.1, status: "keep", reason: null },
      { start: 1.1, end: 2.9, status: "cut", reason: "silence" },
      { start: 2.9, end: 4, status: "keep", reason: null },
    ]);
  });

  it("leaves short gaps under the threshold alone", () => {
    // 0.6s gap < 0.7s → nothing cut.
    const edl = generateInitialEDL([word(0, 1), word(1.6, 2)], 2);
    expect(edl.segments).toEqual([
      { start: 0, end: 2, status: "keep", reason: null },
    ]);
  });

  it("does not pad the file's own start or end (no silence slivers)", () => {
    // Leading dead air before the first word, and trailing after the last.
    const edl = generateInitialEDL([word(3, 4)], 8);
    expect(edl.segments).toEqual([
      { start: 0, end: 2.9, status: "cut", reason: "silence" },
      { start: 2.9, end: 4.1, status: "keep", reason: null },
      { start: 4.1, end: 8, status: "cut", reason: "silence" },
    ]);
  });
});

describe("reRoughCut (preserve manual edits)", () => {
  // Two words 1s and 5-6s apart in a 6s clip → one auto silence cut at [1.1,4.9].
  const words = [word(0, 1), word(5, 6)];

  it("regenerates the auto layer but keeps a manual cut", () => {
    const auto = generateInitialEDL(words, 6);
    const withManual = setRangeStatus(auto, 5.2, 5.5, "cut", "manual");
    const rerun = reRoughCut(withManual, words, 6);

    // Auto silence survives, and the manual cut is still there as manual.
    expect(rerun.segments).toContainEqual({ start: 1.1, end: 4.9, status: "cut", reason: "silence" });
    expect(rerun.segments).toContainEqual({ start: 5.2, end: 5.5, status: "cut", reason: "manual" });
  });

  it("does not re-cut a restored (protected) keep", () => {
    const auto = generateInitialEDL(words, 6); // has silence cut [1.1,4.9]
    const silence = auto.segments.find((s) => s.status === "cut")!;
    const restored = restoreSegment(auto, silence); // protected keep over [1.1,4.9]
    const rerun = reRoughCut(restored, words, 6);

    // The span the user brought back stays kept — no silence cut anywhere in it.
    const cutInSpan = rerun.segments.some(
      (s) => s.status === "cut" && s.start < 4.9 && s.end > 1.1
    );
    expect(cutInSpan).toBe(false);
  });

  it("re-inserts a razor split that still lands inside a kept clip", () => {
    const auto = generateInitialEDL(words, 6); // keep [4.9,6] at the tail
    const split = splitAt(auto, 5.4);
    const rerun = reRoughCut(split, words, 6);
    expect(rerun.segments.some((s) => Math.abs(s.start - 5.4) < 1e-6 && s.split)).toBe(true);
  });

  it("leaves the current edit untouched when the transcript is unusable", () => {
    const current: EDL = { segments: [{ start: 0, end: 6, status: "keep", reason: null }] };
    expect(reRoughCut(current, [], 6)).toBe(current);
  });

  it("bypasses the first-build safety floor so it can cut deep", () => {
    // ~97% dead air: the first build refuses (keeps all), a re-run does not.
    const sparse = [word(0, 0.5)];
    expect(keptDuration(buildInitialEDL(sparse, 20))).toBeCloseTo(20, 5);

    const current: EDL = { segments: [{ start: 0, end: 20, status: "keep", reason: null }] };
    const rerun = reRoughCut(current, sparse, 20);
    expect(keptDuration(rerun)).toBeLessThan(20 * 0.5);
  });
});

describe("restoreSegment (heal + protect)", () => {
  it("merges the restored span into one seamless clip and records a protected keep", () => {
    const auto = generateInitialEDL([word(0, 1), word(5, 6)], 6); // silence cut [1.1,4.9]
    const silence = auto.segments.find((s) => s.status === "cut")!;
    const restored = restoreSegment(auto, silence);
    // No manual seam — the timeline heals into a single kept clip.
    expect(restored.segments).toEqual([{ start: 0, end: 6, status: "keep", reason: null }]);
    expect(restored.protectedKeeps).toEqual([{ start: 1.1, end: 4.9 }]);
  });

  it("un-protects a restored span when it is later manually cut", () => {
    const auto = generateInitialEDL([word(0, 1), word(5, 6)], 6);
    const silence = auto.segments.find((s) => s.status === "cut")!; // [1.1,4.9]
    const restored = restoreSegment(auto, silence); // protectedKeeps [{1.1,4.9}]
    // A manual cut inside the restored span clips it out of protection…
    const recut = setRangeStatus(restored, 2, 3, "cut", "manual");
    expect(recut.protectedKeeps).toEqual([
      { start: 1.1, end: 2 },
      { start: 3, end: 4.9 },
    ]);
    // …and cutting the whole span drops the protected entry entirely.
    const recutAll = setRangeStatus(restored, 1.1, 4.9, "cut", "manual");
    expect(recutAll.protectedKeeps).toBeUndefined();
  });

  it("leaves protected keeps intact for auto (silence/retake) cuts", () => {
    const auto = generateInitialEDL([word(0, 1), word(5, 6)], 6);
    const silence = auto.segments.find((s) => s.status === "cut")!;
    const restored = restoreSegment(auto, silence); // protectedKeeps [{1.1,4.9}]
    const autoCut = setRangeStatus(restored, 2, 3, "cut", "silence");
    expect(autoCut.protectedKeeps).toEqual([{ start: 1.1, end: 4.9 }]);
  });
});

describe("pinTrimmedBoundary", () => {
  it("marks the cut side manual and protects only the revealed sliver", () => {
    const auto = generateInitialEDL([word(0, 1), word(5, 6)], 6);
    // Boundary 0 sits at 1.1 (keep [0,1.1] | cut [1.1,4.9]); drag it right to 2.0,
    // growing the keep into the silence.
    const trimmed = trimBoundary(auto, 0, 2.0);
    const pinned = pinTrimmedBoundary(trimmed, 0, 1.1);
    expect(pinned.segments.find((s) => s.status === "cut")!.reason).toBe("manual");
    // Only the [1.1,2.0] the drag revealed is protected — not the whole clip.
    expect(pinned.protectedKeeps).toEqual([{ start: 1.1, end: 2 }]);
  });

  it("protects nothing when the drag shrinks the kept side", () => {
    const auto = generateInitialEDL([word(0, 1), word(5, 6)], 6);
    // Drag boundary 0 left to 0.8, shrinking the keep and growing the cut.
    const trimmed = trimBoundary(auto, 0, 0.8);
    const pinned = pinTrimmedBoundary(trimmed, 0, 1.1);
    expect(pinned.segments.find((s) => s.status === "cut")!.reason).toBe("manual");
    expect(pinned.protectedKeeps).toBeUndefined();
  });

  it("leaves a keep|keep (razor split) boundary untouched", () => {
    const split = splitAt({ segments: [{ start: 0, end: 10, status: "keep", reason: null }] }, 5);
    expect(pinTrimmedBoundary(split, 0, 5)).toBe(split);
  });

  it("preserves a pinned trim across a re-run", () => {
    const words = [word(0, 1), word(5, 6)];
    const auto = generateInitialEDL(words, 6);
    const trimmed = trimBoundary(auto, 0, 2.0);
    const pinned = pinTrimmedBoundary(trimmed, 0, 1.1);
    const rerun = reRoughCut(pinned, words, 6);
    // The manual cut edge the user dragged to (2.0) survives the re-run…
    expect(
      rerun.segments.some(
        (s) => s.status === "cut" && s.reason === "manual" && Math.abs(s.start - 2.0) < 1e-6
      )
    ).toBe(true);
    // …and the revealed [1.1,2.0] stays kept rather than being re-cut as silence.
    expect(
      rerun.segments.some((s) => s.status === "cut" && s.start < 2.0 && s.end > 1.1)
    ).toBe(false);
  });
});

describe("isFillerWord", () => {
  it("matches common disfluencies regardless of case and punctuation", () => {
    expect(isFillerWord("um")).toBe(true);
    expect(isFillerWord("Um,")).toBe(true);
    expect(isFillerWord("UH.")).toBe(true);
    expect(isFillerWord("uh-huh")).toBe(true);
    expect(isFillerWord("Hmm...")).toBe(true);
  });

  it("does not match real words or meaningful interjections", () => {
    expect(isFillerWord("umbrella")).toBe(false);
    expect(isFillerWord("like")).toBe(false);
    expect(isFillerWord("oh")).toBe(false);
    expect(isFillerWord("huh?")).toBe(false);
    expect(isFillerWord("so")).toBe(false);
  });
});

describe("findFillerWords", () => {
  it("returns only fillers inside kept segments", () => {
    const words: TranscriptWord[] = [
      { word: "um,", start: 0.5, end: 0.8, confidence: 1 },
      { word: "hello", start: 1, end: 1.4, confidence: 1 },
      { word: "uh", start: 5.5, end: 5.7, confidence: 1 },
    ];
    const edl: EDL = {
      segments: [
        { start: 0, end: 5, status: "keep", reason: null },
        { start: 5, end: 10, status: "cut", reason: "manual" },
      ],
    };
    // "uh" sits in the cut span, so only "um," qualifies.
    expect(findFillerWords(edl, words)).toEqual([words[0]]);
  });
});

describe("groupWordsIntoParagraphs", () => {
  const w = (start: number, end: number, text = "x"): TranscriptWord => ({
    word: text,
    start,
    end,
    confidence: 1,
  });

  it("returns no paragraphs for an empty transcript", () => {
    expect(groupWordsIntoParagraphs([])).toEqual([]);
  });

  it("keeps continuous speech in a single paragraph", () => {
    const words = [w(0, 0.4), w(0.5, 0.9), w(1.0, 1.4)];
    expect(groupWordsIntoParagraphs(words)).toEqual([{ startIndex: 0, endIndex: 2 }]);
  });

  it("breaks on a long spoken pause", () => {
    const words = [w(0, 0.4), w(0.5, 0.9), w(2.5, 2.9), w(3.0, 3.4)];
    expect(groupWordsIntoParagraphs(words)).toEqual([
      { startIndex: 0, endIndex: 1 },
      { startIndex: 2, endIndex: 3 },
    ]);
  });

  it("breaks at a sentence end once the paragraph is long", () => {
    // 60 words with a sentence end at index 54, no pauses anywhere.
    const words = Array.from({ length: 60 }, (_, i) =>
      w(i * 0.5, i * 0.5 + 0.4, i === 54 ? "done." : "x")
    );
    expect(groupWordsIntoParagraphs(words)).toEqual([
      { startIndex: 0, endIndex: 54 },
      { startIndex: 55, endIndex: 59 },
    ]);
  });

  it("force-breaks unpunctuated speech at the hard word limit", () => {
    const words = Array.from({ length: 130 }, (_, i) => w(i * 0.5, i * 0.5 + 0.4));
    const paragraphs = groupWordsIntoParagraphs(words);
    expect(paragraphs[0]).toEqual({ startIndex: 0, endIndex: 99 });
    expect(paragraphs[1]).toEqual({ startIndex: 100, endIndex: 129 });
  });

  it("covers every word exactly once", () => {
    const words = [w(0, 0.4), w(2, 2.4), w(2.5, 2.9), w(6, 6.4)];
    const paragraphs = groupWordsIntoParagraphs(words);
    const covered = paragraphs.flatMap((p) =>
      Array.from({ length: p.endIndex - p.startIndex + 1 }, (_, k) => p.startIndex + k)
    );
    expect(covered).toEqual([0, 1, 2, 3]);
  });
});

describe("cutEachWord", () => {
  it("cuts only each word's own range, not the span between scattered words", () => {
    // Regression: an "um" at 5s and an "uh" at 50s must NOT take the 45s of
    // speech between them (cutWords' span semantics would).
    const fillers = [
      { word: "um", start: 5, end: 5.3, confidence: 1 },
      { word: "uh", start: 50, end: 50.2, confidence: 1 },
    ];
    const result = cutEachWord(keep(60), fillers);
    expect(result.segments).toEqual([
      { start: 0, end: 5, status: "keep", reason: null },
      { start: 5, end: 5.3, status: "cut", reason: "manual" },
      { start: 5.3, end: 50, status: "keep", reason: null },
      { start: 50, end: 50.2, status: "cut", reason: "manual" },
      { start: 50.2, end: 60, status: "keep", reason: null },
    ]);
    // The overwhelming majority of the video survives.
    expect(keptDuration(result)).toBeCloseTo(59.5, 5);
  });

  it("is a no-op for an empty word list", () => {
    const edl = keep(10);
    expect(cutEachWord(edl, [])).toBe(edl);
  });
});

describe("absorbCutResidue", () => {
  // The real-world shape: a silence cut padded inward (starts word.end + pad)
  // next to a manual/AI cut ending exactly at word.end traps a pad-width keep.
  function edlWithSliver(sliver: { start: number; end: number }): EDL {
    return {
      segments: [
        { start: 0, end: 2, status: "keep", reason: null },
        { start: 2, end: sliver.start, status: "cut", reason: "manual" },
        { start: sliver.start, end: sliver.end, status: "keep", reason: null },
        { start: sliver.end, end: 6, status: "cut", reason: "silence" },
        { start: 6, end: 10, status: "keep", reason: null },
      ],
    };
  }

  it("folds a wordless sub-threshold keep between two cuts into the left cut", () => {
    const result = absorbCutResidue(edlWithSliver({ start: 4, end: 4.1 }), []);
    expect(result.segments).toEqual([
      { start: 0, end: 2, status: "keep", reason: null },
      { start: 2, end: 4.1, status: "cut", reason: "manual" },
      { start: 4.1, end: 6, status: "cut", reason: "silence" },
      { start: 6, end: 10, status: "keep", reason: null },
    ]);
  });

  it("leaves a sliver alone when a transcript word overlaps it", () => {
    const edl = edlWithSliver({ start: 4, end: 4.2 });
    const result = absorbCutResidue(edl, [word(4.02, 4.18)]);
    expect(result).toBe(edl);
  });

  it("leaves keeps at or above the threshold alone", () => {
    const edl = edlWithSliver({ start: 4, end: 4.5 });
    expect(absorbCutResidue(edl, [])).toBe(edl);
  });

  it("never absorbs a protected (user-restored) sliver", () => {
    const edl: EDL = {
      ...edlWithSliver({ start: 4, end: 4.1 }),
      protectedKeeps: [{ start: 4, end: 4.1 }],
    };
    expect(absorbCutResidue(edl, [])).toBe(edl);
  });

  it("ignores keeps that touch the timeline edge or a kept neighbour", () => {
    const edl: EDL = {
      segments: [
        { start: 0, end: 0.1, status: "keep", reason: null }, // leading edge
        { start: 0.1, end: 5, status: "cut", reason: "manual" },
        { start: 5, end: 10, status: "keep", reason: null },
      ],
    };
    expect(absorbCutResidue(edl, [])).toBe(edl);
  });
});

describe("absorbCutResidue — span scoping", () => {
  const edl: EDL = {
    segments: [
      { start: 0, end: 2, status: "keep", reason: null },
      { start: 2, end: 4, status: "cut", reason: "manual" },
      // Deliberate tiny wordless keep, away from where the next edit lands.
      { start: 4, end: 4.1, status: "keep", reason: null },
      { start: 4.1, end: 6, status: "cut", reason: "silence" },
      { start: 6, end: 10, status: "keep", reason: null },
    ],
  };

  it("leaves slivers outside the span untouched", () => {
    expect(absorbCutResidue(edl, [], { start: 7, end: 9 })).toBe(edl);
  });

  it("absorbs slivers inside the span", () => {
    const result = absorbCutResidue(edl, [], { start: 3, end: 5 });
    expect(result.segments).toContainEqual({
      start: 2,
      end: 4.1,
      status: "cut",
      reason: "manual",
    });
  });

  it("no-ops on a null span (nothing changed)", () => {
    expect(absorbCutResidue(edl, [], null)).toBe(edl);
  });
});

describe("changedSpan", () => {
  it("bounds the segments the edit actually touched", () => {
    const prev = keep(10);
    const next: EDL = {
      segments: [
        { start: 0, end: 3, status: "keep", reason: null },
        { start: 3, end: 5, status: "cut", reason: "manual" },
        { start: 5, end: 10, status: "keep", reason: null },
      ],
    };
    // Every segment changed shape (the single keep was split three ways).
    expect(changedSpan(prev, next)).toEqual({ start: 0, end: 10 });

    // A follow-up edit that only touches the middle reports just that region.
    const next2: EDL = {
      segments: [
        { start: 0, end: 3, status: "keep", reason: null },
        { start: 3, end: 5.5, status: "cut", reason: "manual" },
        { start: 5.5, end: 10, status: "keep", reason: null },
      ],
    };
    expect(changedSpan(next, next2)).toEqual({ start: 3, end: 10 });
  });

  it("returns null when nothing changed", () => {
    const a = keep(10);
    expect(changedSpan(a, { segments: [...a.segments] })).toBeNull();
  });
});
