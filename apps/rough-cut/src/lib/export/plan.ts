/**
 * Pure logic that turns an EDL's "keep" segments into an export timeline:
 * a function mapping a source-timeline timestamp to its position in the
 * rendered output (or null, if the timestamp falls inside a cut).
 *
 * No browser/WebCodecs APIs here — this is exercised directly by vitest.
 */
import type { EDL } from "@/lib/edl";

export interface KeepRange {
  start: number;
  end: number;
}

/** The EDL's "keep" segments, sorted by start time. */
export function getKeepRanges(edl: EDL): KeepRange[] {
  return edl.segments
    .filter((s) => s.status === "keep")
    .map((s) => ({ start: s.start, end: s.end }))
    .sort((a, b) => a.start - b.start);
}

export function totalKeptSeconds(ranges: KeepRange[]): number {
  return ranges.reduce((sum, r) => sum + (r.end - r.start), 0);
}

/**
 * Builds a function that remaps a source timestamp (seconds) to the
 * corresponding timestamp in the rendered output, where kept ranges are
 * concatenated back-to-back with no gaps. Returns null for a timestamp
 * that falls inside a cut (or outside every kept range) — the caller
 * should drop that sample rather than encode it.
 */
export function createTimeRemapper(ranges: KeepRange[]): (t: number) => number | null {
  let cumulative = 0;
  const withOffset = ranges.map((r) => {
    // Output position = t + offset, for t within [r.start, r.end).
    const offset = cumulative - r.start;
    cumulative += r.end - r.start;
    return { ...r, offset };
  });

  return function remap(t: number): number | null {
    const range = withOffset.find((r) => t >= r.start && t < r.end);
    return range ? t + range.offset : null;
  };
}
