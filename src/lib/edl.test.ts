import { describe, it, expect } from "vitest";
import { splitAt, setRangeStatus, type EDL } from "./edl";

/** A single full-length kept clip — the common starting point. */
function keep(durationSeconds: number): EDL {
  return {
    segments: [
      { start: 0, end: durationSeconds, status: "keep", reason: null },
    ],
  };
}

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
