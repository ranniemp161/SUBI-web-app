/**
 * Canonical frame math for the whole repo (spec 0004, hoisted here by spec
 * _root/0001). Rough Cut's live editing path (playhead, filmstrip, waveform,
 * frame stepping), its NLE export path (FCPXML, CMX 3600 EDL, FCP7 XML), and
 * B-Roll's clip naming all convert time to frame numbers through these
 * functions, so no two of them can round differently and drift apart. This is
 * the one place millisecond/second to frame conversion happens; no app
 * reimplements its own rounding rule.
 *
 * Milliseconds stay the apps' stored, canonical time unit (see `packages/db`
 * and rough-cut's `lib/edl.ts` `roundMs`); these helpers only convert to and
 * from frame numbers at a detected rate, they never change how time is stored.
 *
 * The rate is an exact rational (`VideoFps`) so NTSC rates like 29.97 =
 * 30000/1001 stay exact and long-timeline frame counts don't drift. A plain
 * fps number would round 29.97 sources wrong over a long timeline.
 */

/** A video frame rate as an exact rational, e.g. NTSC 29.97 = 30000/1001. */
export interface VideoFps {
  numerator: number;
  denominator: number;
}

/**
 * Frame number a time in seconds falls on, rounded to the nearest whole frame.
 * The single rounding rule for the whole repo; every other seconds/ms to frame
 * conversion delegates here (e.g. `toFrames` in `timebase.ts`).
 */
export function secondsToFrame(seconds: number, fps: VideoFps): number {
  return Math.round((seconds * fps.numerator) / fps.denominator);
}

/** Frame number a time in milliseconds falls on (nearest whole frame). */
export function msToFrame(ms: number, fps: VideoFps): number {
  return secondsToFrame(ms / 1000, fps);
}

/** Start time in seconds of a given frame number. */
export function frameToSeconds(frame: number, fps: VideoFps): number {
  return (frame * fps.denominator) / fps.numerator;
}

/** Start time in milliseconds of a given frame number. */
export function frameToMs(frame: number, fps: VideoFps): number {
  return frameToSeconds(frame, fps) * 1000;
}

/** Duration of a single frame in seconds at this rate. */
export function frameDurationSeconds(fps: VideoFps): number {
  return fps.denominator / fps.numerator;
}
