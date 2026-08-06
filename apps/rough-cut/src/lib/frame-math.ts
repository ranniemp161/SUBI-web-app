/**
 * Re-export shim. The frame math moved to `@repo/transcript` (spec
 * _root/0001) so rough-cut and b-roll share exactly one implementation and can
 * never round the same timecode differently. This file stays so the roughly
 * thirteen existing `@/lib/frame-math` import sites, and the key files table
 * in this app's `AGENTS.md`, keep working unchanged.
 *
 * Add nothing here. New frame arithmetic belongs in the package.
 */
export {
  secondsToFrame,
  msToFrame,
  frameToSeconds,
  frameToMs,
  frameDurationSeconds,
  type VideoFps,
} from "@repo/transcript/frame-math";
