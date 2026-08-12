import { frameToSeconds, msToFrame, type VideoFps } from "@repo/transcript";

/**
 * How many frames a clip is, and when each one sits (spec `0001`, Phase 4).
 *
 * Every number here comes from `@repo/transcript`, the repo's only frame
 * arithmetic. That matters more in the encoder than anywhere else: the filename
 * says a clip belongs at 2:35, and if the encoder's own idea of a frame's
 * timestamp drifts from the rounding rule that produced that label, the clip is
 * wrong in exactly the way the whole package exists to prevent. So this module
 * computes nothing itself; it only sequences what `frameToSeconds` and
 * `msToFrame` return.
 */

/**
 * Frames in a clip of `durationMs` at `fps`, always at least one.
 *
 * A scene shorter than a single frame still has to produce a playable file, so
 * it renders one frame rather than an empty track. The planner clamps durations
 * to 4 to 8 seconds, so that case only arises from bad data, and an empty MP4
 * would be a worse answer than a very short one.
 */
export function renderFrameCount(durationMs: number, fps: VideoFps): number {
  if (!Number.isFinite(durationMs) || durationMs <= 0) return 1;
  return Math.max(1, msToFrame(durationMs, fps));
}

/** When frame `index` starts, in seconds, which is what the encoder wants. */
export function frameTimestampSeconds(index: number, fps: VideoFps): number {
  return frameToSeconds(index, fps);
}

/**
 * One frame's duration in seconds, as an exact rational division rather than a
 * decimal fps. At 29.97 the difference accumulates into visible drift over a
 * long clip.
 */
export function frameDurationSeconds(fps: VideoFps): number {
  return fps.denominator / fps.numerator;
}

/**
 * Elapsed time at frame `index`, in milliseconds, for the drawing functions.
 *
 * The renderers take milliseconds since the scene started, so motion is
 * identical wherever the scene sits on the timeline.
 */
export function frameElapsedMs(index: number, fps: VideoFps): number {
  return frameTimestampSeconds(index, fps) * 1000;
}
