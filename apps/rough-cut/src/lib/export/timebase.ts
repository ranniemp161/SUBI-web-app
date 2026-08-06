/**
 * Re-export shim. The timecode and timebase helpers moved to
 * `@repo/transcript` (spec _root/0001) so rough-cut and b-roll format the same
 * timecode from the same arithmetic. This file stays so the existing
 * `@/lib/export/timebase` import sites, and the key files table in this app's
 * `AGENTS.md`, keep working unchanged.
 *
 * Add nothing here. New timecode helpers belong in the package.
 */
export {
  DEFAULT_FPS,
  snapToStandardFps,
  nominalFps,
  isDropFrame,
  toFrames,
  minClipSeconds,
  formatTimecode,
  type VideoFps,
} from "@repo/transcript/timebase";
