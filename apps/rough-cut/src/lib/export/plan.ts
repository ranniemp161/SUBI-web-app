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
/**
 * Outward fade applied at every kept range's edges in the exported audio.
 * Deepgram's word boundaries (and therefore every manual/silence/retake cut
 * derived from them) mark the ASR's best-guess timestamp, not the true
 * acoustic edge — a leading glide or trailing consonant can bleed a few
 * milliseconds past it. A hard splice at the exact cut point can leave an
 * audible fragment of "deleted" speech; a short fade to silence masks it,
 * the same way an NLE would rather than chase sample-perfect cut points.
 */
export const AUDIO_FADE_SECONDS = 0.02;

/**
 * Builds a function mapping a source-timeline timestamp (seconds) to a gain
 * in [0, 1]: 1 in the interior of a kept range, ramping down to 0 over the
 * last `fadeSeconds` before its end and up from 0 over the first
 * `fadeSeconds` after its start, and 0 outside every kept range entirely (a
 * cut — silent regardless of fade, and normally never reached since the
 * caller drops those samples via `createTimeRemapper` first). A range
 * shorter than `2 * fadeSeconds` uses half its length on each side instead,
 * so a very short surviving clip fades in and back out rather than briefly
 * reaching full volume.
 *
 * Stateful in the same way as `createTimeRemapper` (a forward-marching cursor
 * with a rescan fallback) — safe as long as one instance is only ever queried
 * with one track's timestamps (unlike the remapper, this is never shared
 * between video and audio, so the interleaving concern that motivated the
 * remapper's fallback doesn't apply here, but the fallback costs nothing and
 * keeps the two functions symmetric).
 */
export function createGainEnvelope(
  ranges: KeepRange[],
  fadeSeconds: number = AUDIO_FADE_SECONDS
): (t: number) => number {
  let lastIdx = 0;

  const findRange = (t: number): KeepRange | undefined => {
    while (lastIdx < ranges.length && t >= ranges[lastIdx].end) lastIdx++;
    if (lastIdx >= ranges.length || t < ranges[lastIdx].start) {
      lastIdx = 0;
      while (lastIdx < ranges.length && t >= ranges[lastIdx].end) lastIdx++;
    }
    return ranges[lastIdx];
  };

  return function gainAt(t: number): number {
    const r = findRange(t);
    if (!r || t < r.start || t >= r.end) return 0;
    const fade = Math.min(fadeSeconds, (r.end - r.start) / 2);
    if (fade <= 0) return 1;
    const distIn = t - r.start;
    const distOut = r.end - t;
    return Math.max(0, Math.min(1, Math.min(distIn, distOut, fade) / fade));
  };
}

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
