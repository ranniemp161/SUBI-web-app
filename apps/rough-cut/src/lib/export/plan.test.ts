import { describe, it, expect } from "vitest";
import {
  getKeepRanges,
  totalKeptSeconds,
  createTimeRemapper,
  createGainEnvelope,
  hasExportableRanges,
} from "./plan";
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

  it("recovers after a timestamp past the last keep range (interleaved tracks share one remapper)", () => {
    // Regression: the worker hands ONE remapper to both the video and the
    // audio track, and their samples interleave. Once either track sends a
    // timestamp past the last keep range, the internal cursor used to run off
    // the end of the range list and never reset, so every later sample from
    // the other track was dropped — the exported video froze at the end.
    const remap = createTimeRemapper([{ start: 0, end: 10 }]);
    expect(remap(10.5)).toBeNull(); // audio track passes the end first
    expect(remap(9.5)).toBe(9.5); // video track is still inside the range
    expect(remap(9.9)).toBe(9.9);
    expect(remap(10.2)).toBeNull();
  });

  it("recovers past the end across multiple ranges", () => {
    const remap = createTimeRemapper([
      { start: 0, end: 5 },
      { start: 10, end: 15 },
    ]);
    expect(remap(20)).toBeNull();
    expect(remap(12)).toBe(7);
    expect(remap(4)).toBe(4);
  });

  it("returns null for every timestamp when there are no keep ranges", () => {
    const remap = createTimeRemapper([]);
    expect(remap(0)).toBeNull();
    expect(remap(100)).toBeNull();
  });
});

describe("createGainEnvelope", () => {
  it("is full volume in a range's interior", () => {
    const gainAt = createGainEnvelope([{ start: 0, end: 10 }], 0.02);
    expect(gainAt(5)).toBe(1);
  });

  it("ramps from 0 to 1 over the fade window at a range's start", () => {
    const gainAt = createGainEnvelope([{ start: 5, end: 15 }], 0.02);
    expect(gainAt(5)).toBe(0);
    expect(gainAt(5.01)).toBeCloseTo(0.5, 5);
    expect(gainAt(5.02)).toBeCloseTo(1, 5);
  });

  it("ramps from 1 to 0 over the fade window at a range's end", () => {
    const gainAt = createGainEnvelope([{ start: 5, end: 15 }], 0.02);
    expect(gainAt(14.98)).toBeCloseTo(1, 5);
    expect(gainAt(14.99)).toBeCloseTo(0.5, 5);
    expect(gainAt(15)).toBe(0); // exclusive end — findRange no longer matches
  });

  it("is 0 in the gap between two kept ranges", () => {
    const gainAt = createGainEnvelope([{ start: 0, end: 5 }, { start: 10, end: 15 }], 0.02);
    expect(gainAt(7)).toBe(0);
  });

  it("halves the fade window for a range shorter than 2x the fade seconds, so it never reaches full volume", () => {
    // A 0.02s range with a 0.02s fade would otherwise want a 0.02s ramp on
    // each side of a 0.02s span — impossible, so each side gets half instead.
    const gainAt = createGainEnvelope([{ start: 0, end: 0.02 }], 0.02);
    expect(gainAt(0.01)).toBeCloseTo(1, 5); // the midpoint, as high as it gets
    expect(gainAt(0)).toBe(0);
  });

  it("recovers after a timestamp past the last range (same interleaving concern as createTimeRemapper)", () => {
    const gainAt = createGainEnvelope([{ start: 0, end: 10 }], 0.02);
    expect(gainAt(10.5)).toBe(0);
    expect(gainAt(9.99)).toBeCloseTo(0.5, 5);
  });
});

describe("hasExportableRanges", () => {
  it("is true when at least one kept range is at or above one frame", () => {
    const edl: EDL = { segments: [{ start: 0, end: 5, status: "keep", reason: null }] };
    expect(hasExportableRanges(edl)).toBe(true);
  });

  it("is false when nothing is kept", () => {
    const edl: EDL = { segments: [{ start: 0, end: 5, status: "cut", reason: "manual" }] };
    expect(hasExportableRanges(edl)).toBe(false);
  });

  it("is false when several sub-frame kept segments sum to a positive total but every individual range is still under one frame", () => {
    // Regression: keptDuration(edl) would report > 0 here (5 segments * 0.02s
    // = 0.1s total), but every one is below MIN_CLIP_SECONDS (1/30s ~= 0.033s)
    // and the exporters drop each one — this must report false, not true.
    const edl: EDL = {
      segments: Array.from({ length: 5 }, (_, i) => ({
        start: i * 0.02,
        end: i * 0.02 + 0.02,
        status: "keep" as const,
        reason: null,
      })),
    };
    expect(hasExportableRanges(edl)).toBe(false);
  });
});
