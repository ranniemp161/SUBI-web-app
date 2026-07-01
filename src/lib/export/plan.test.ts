import { describe, it, expect } from "vitest";
import { getKeepRanges, totalKeptSeconds, createTimeRemapper } from "./plan";
import type { EDL } from "@/lib/edl";

describe("getKeepRanges", () => {
  it("extracts only keep segments, sorted by start", () => {
    const edl: EDL = {
      segments: [
        { start: 5, end: 10, status: "keep", reason: null },
        { start: 0, end: 5, status: "cut", reason: "silence" },
        { start: 10, end: 15, status: "keep", reason: null },
      ],
    };
    expect(getKeepRanges(edl)).toEqual([
      { start: 5, end: 10 },
      { start: 10, end: 15 },
    ]);
  });

  it("returns an empty array when nothing is kept", () => {
    const edl: EDL = { segments: [{ start: 0, end: 5, status: "cut", reason: "manual" }] };
    expect(getKeepRanges(edl)).toEqual([]);
  });
});

describe("totalKeptSeconds", () => {
  it("sums the duration of every range", () => {
    expect(totalKeptSeconds([{ start: 0, end: 4 }, { start: 10, end: 12 }])).toBe(6);
  });

  it("is zero for an empty list", () => {
    expect(totalKeptSeconds([])).toBe(0);
  });
});

describe("createTimeRemapper", () => {
  it("returns null for a timestamp inside a cut before the first keep range", () => {
    const remap = createTimeRemapper([{ start: 5, end: 10 }]);
    expect(remap(2)).toBeNull();
  });

  it("returns null for a timestamp inside a cut between two keep ranges", () => {
    const remap = createTimeRemapper([{ start: 0, end: 5 }, { start: 10, end: 15 }]);
    expect(remap(7)).toBeNull();
  });

  it("returns null for a timestamp after the last keep range", () => {
    const remap = createTimeRemapper([{ start: 0, end: 5 }]);
    expect(remap(8)).toBeNull();
  });

  it("passes a single keep range through unchanged", () => {
    const remap = createTimeRemapper([{ start: 0, end: 10 }]);
    expect(remap(0)).toBe(0);
    expect(remap(4.5)).toBe(4.5);
  });

  it("rebases a second keep range to sit immediately after the first, with no gap", () => {
    // Keep [0,5) then [10,15) — a 5s cut in between should vanish entirely
    // in the output: t=10 (the start of the second range) must land at 5.
    const remap = createTimeRemapper([{ start: 0, end: 5 }, { start: 10, end: 15 }]);
    expect(remap(0)).toBe(0);
    expect(remap(4)).toBe(4);
    expect(remap(10)).toBe(5);
    expect(remap(12)).toBe(7);
    expect(remap(14.999)).toBeCloseTo(9.999);
  });

  it("handles three consecutive keep ranges with gaps of different sizes", () => {
    const remap = createTimeRemapper([
      { start: 0, end: 2 },
      { start: 3, end: 4 }, // 1s cut before this
      { start: 10, end: 12 }, // 6s cut before this
    ]);
    // Output timeline: [0,2) [2,3) [3,5) — total 5s kept.
    expect(remap(0)).toBe(0);
    expect(remap(3.5)).toBe(2.5);
    expect(remap(11)).toBe(4);
  });

  it("is a boundary at the exclusive end — a timestamp exactly at range.end is not kept", () => {
    const remap = createTimeRemapper([{ start: 0, end: 5 }, { start: 5, end: 10 }]);
    // Adjacent ranges (no gap) should still combine seamlessly.
    expect(remap(5)).toBe(5);
    expect(remap(9)).toBe(9);
  });

  it("returns null for every timestamp when there are no keep ranges", () => {
    const remap = createTimeRemapper([]);
    expect(remap(0)).toBeNull();
    expect(remap(100)).toBeNull();
  });
});
