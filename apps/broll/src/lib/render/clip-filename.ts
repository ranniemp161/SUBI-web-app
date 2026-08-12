import { formatTimecode, type VideoFps } from "@repo/transcript";

/**
 * The exported clip's filename, e.g. `scene_04__02-35.mp4` (spec `0001` AC-33).
 *
 * The timecode in the name is the whole product promise: a creator drags
 * `scene_04__02-35.mp4` onto their timeline and it belongs at 2:35. So the
 * number here is **not** computed locally. It comes from `formatTimecode` in
 * `@repo/transcript`, the repo's only implementation of the seconds to frame
 * rounding rule, which is what stops this app and Rough Cut disagreeing about
 * where 2:35 is. Doing the minutes arithmetic inline here would be a second
 * implementation of exactly the thing that rule exists to prevent.
 *
 * The name carries minutes and seconds, not full SMPTE `HH:MM:SS:FF`, because
 * it is read by a human scanning a folder rather than parsed by an NLE. Frames
 * are dropped from the label only; they are still what the rounding is done in.
 * An hour or more brings the hours field back, since `65-03` for 1:05:03 would
 * be worse than useless.
 *
 * Nothing user supplied reaches the name, so there is nothing to sanitize: every
 * character comes from a number this function formatted.
 */
export function sceneClipFilename(input: {
  /** 1 based position in the exported batch, not the database id. */
  index: number;
  /** Scene start on the finished edit's timeline. */
  startMs: number;
  /** The project's output rate, which is the timebase the label is rounded in. */
  fps: VideoFps;
}): string {
  const { index, startMs, fps } = input;

  // `formatTimecode` owns the rounding; this only reshapes its output.
  // Drop frame rates render `;` before the frames field, so split on both.
  const [hours, minutes, seconds] = formatTimecode(startMs / 1000, fps).split(/[:;]/);

  const label = hours === "00" ? `${minutes}-${seconds}` : `${hours}-${minutes}-${seconds}`;

  return `scene_${String(index).padStart(2, "0")}__${label}.mp4`;
}
