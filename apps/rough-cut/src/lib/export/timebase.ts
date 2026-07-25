/**
 * Timecode and timebase helpers for NLE export formats (FCPXML, CMX 3600 EDL,
 * FCP7 XML). The core seconds/ms to frame rounding now lives in
 * `src/lib/frame-math.ts` so the live editing path and the export path share
 * one rounding rule (spec 0004); `toFrames` here delegates to it. This file
 * keeps the export-specific parts: the fallback rate, standard-rate snapping,
 * drop-frame counting, and SMPTE timecode formatting.
 *
 * The timebase is the source clip's detected frame rate (see
 * `src/lib/detect-frame-rate.ts`). `DEFAULT_FPS` is the last-resort rate only;
 * as of spec 0004 the export action is disabled until the real source rate is
 * known, so `DEFAULT_FPS` is no longer silently substituted for a missing rate
 * on a real export (it stays only as a definitional default for these helpers
 * and their tests).
 */
import { secondsToFrame, type VideoFps } from "@/lib/frame-math";

// Re-exported so existing importers of `VideoFps` from this module keep working;
// its canonical home is now `frame-math.ts`.
export type { VideoFps } from "@/lib/frame-math";

/** Fallback timebase when the source's real rate is unknown. */
export const DEFAULT_FPS: VideoFps = { numerator: 30, denominator: 1 };

/**
 * Standard broadcast/consumer rates a measured average frame rate is snapped
 * to. NTSC family uses the exact 1001-denominator rationals so long-timeline
 * timecode doesn't drift.
 */
const STANDARD_RATES: VideoFps[] = [
  { numerator: 24000, denominator: 1001 }, // 23.976
  { numerator: 24, denominator: 1 },
  { numerator: 25, denominator: 1 },
  { numerator: 30000, denominator: 1001 }, // 29.97
  { numerator: 30, denominator: 1 },
  { numerator: 50, denominator: 1 },
  { numerator: 60000, denominator: 1001 }, // 59.94
  { numerator: 60, denominator: 1 },
];

/** How far (relatively) a measured rate may sit from a standard rate and still count as it. */
const SNAP_TOLERANCE = 0.015;

/**
 * Snaps a measured average frame rate (e.g. mediabunny's averagePacketRate)
 * to the nearest standard rate within tolerance, else rounds to the nearest
 * integer fps (screen recordings and other oddball sources).
 */
export function snapToStandardFps(measuredRate: number): VideoFps {
  let best: VideoFps | null = null;
  let bestError = Infinity;
  for (const rate of STANDARD_RATES) {
    const value = rate.numerator / rate.denominator;
    const error = Math.abs(measuredRate - value) / value;
    if (error < bestError) {
      bestError = error;
      best = rate;
    }
  }
  if (best && bestError <= SNAP_TOLERANCE) return best;
  return { numerator: Math.max(1, Math.round(measuredRate)), denominator: 1 };
}

/** The integer frame-label rate timecode counts in (30 for 29.97, 60 for 59.94). */
export function nominalFps(fps: VideoFps): number {
  return Math.round(fps.numerator / fps.denominator);
}

/**
 * Whether timecode at this rate uses drop-frame counting. Only the NTSC 30
 * and 60 families drop frame labels — 23.976 is always non-drop-frame.
 */
export function isDropFrame(fps: VideoFps): boolean {
  const nominal = nominalFps(fps);
  return fps.denominator === 1001 && (nominal === 30 || nominal === 60);
}

/** Delegates to the app-wide rounding rule in `frame-math.ts` (spec 0004). */
export function toFrames(seconds: number, fps: VideoFps = DEFAULT_FPS): number {
  return secondsToFrame(seconds, fps);
}

/** Shortest duration (seconds) worth keeping as its own clip/event at fps. */
export function minClipSeconds(fps: VideoFps = DEFAULT_FPS): number {
  return fps.denominator / fps.numerator;
}

/**
 * Formats seconds as an SMPTE timecode at fps: `HH:MM:SS:FF` non-drop-frame,
 * or `HH:MM:SS;FF` drop-frame for the NTSC 29.97/59.94 rates. Drop-frame
 * skips frame labels 0..D-1 (D = 2 at 29.97, 4 at 59.94) at every minute
 * boundary except minutes divisible by ten, re-inserted here by converting
 * the real frame count into its display label.
 */
export function formatTimecode(seconds: number, fps: VideoFps = DEFAULT_FPS): string {
  const nominal = nominalFps(fps);
  let display = toFrames(seconds, fps);
  let separator = ":";

  if (isDropFrame(fps)) {
    separator = ";";
    const dropped = nominal === 60 ? 4 : 2;
    const framesPerMinute = nominal * 60 - dropped;
    const framesPer10Minutes = framesPerMinute * 10 + dropped;
    const realFrames = display;
    const tenMinuteBlocks = Math.floor(realFrames / framesPer10Minutes);
    const remainder = realFrames % framesPer10Minutes;
    display = realFrames + dropped * 9 * tenMinuteBlocks;
    if (remainder > dropped) {
      display += dropped * Math.floor((remainder - dropped) / framesPerMinute);
    }
  }

  const frames = display % nominal;
  const totalSeconds = Math.floor(display / nominal);
  const secs = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const mins = totalMinutes % 60;
  const hours = Math.floor(totalMinutes / 60);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(hours)}:${pad(mins)}:${pad(secs)}${separator}${pad(frames)}`;
}
