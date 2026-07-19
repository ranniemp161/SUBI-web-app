/**
 * Pure logic that turns an EDL's "keep" segments into an export timeline:
 * a function mapping a source-timeline timestamp to its position in the
 * rendered output (or null, if the timestamp falls inside a cut).
 *
 * No browser/WebCodecs APIs here — this is exercised directly by vitest.
 */
import type { EDL } from "@/lib/edl";
import { DEFAULT_FPS, minClipSeconds, type VideoFps } from "@/lib/export/timebase";

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
 * Whether the EDL has at least one kept range the NLE exporters will actually
 * emit as a clip/event — i.e. one at or above one frame at fps, matching the
 * exporters' own per-range filter. keptDuration(edl) > 0 is NOT equivalent:
 * several sub-frame kept segments can sum to a positive total while every
 * individual range still gets dropped, producing a file with zero clips.
 */
export function hasExportableRanges(edl: EDL, fps: VideoFps = DEFAULT_FPS): boolean {
  const minSeconds = minClipSeconds(fps);
  return getKeepRanges(edl).some((r) => r.end - r.start >= minSeconds);
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

  let lastIdx = 0;
  return function remap(t: number): number | null {
    // Fast path for the common forward march: advance lastIdx while t is past the current range's end.
    while (lastIdx < withOffset.length && t >= withOffset[lastIdx].end) {
      lastIdx++;
    }
    // Timestamps are NOT globally monotonic: the export worker hands one
    // shared remapper to both the video and the audio track, and their
    // interleaved samples jump backward between calls. If t is before the
    // current range, or the cursor ran off the end of the list (the other
    // track already crossed the last keep range), rescan from the start —
    // otherwise the tail samples of the slower track get dropped and the
    // exported video freezes at the end.
    if (lastIdx >= withOffset.length || t < withOffset[lastIdx].start) {
      lastIdx = 0;
      while (lastIdx < withOffset.length && t >= withOffset[lastIdx].end) {
        lastIdx++;
      }
    }

    const range = withOffset[lastIdx];
    return range && t >= range.start && t < range.end ? t + range.offset : null;
  };
}
