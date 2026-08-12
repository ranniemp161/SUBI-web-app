import type { VideoFps } from "@repo/transcript";
import type { ChartFullScene } from "./chart-full";

/**
 * The contract between the page and the render worker.
 *
 * It lives here rather than in the worker so a client component can import the
 * types without pulling `mediabunny` and the worker's browser only globals into
 * the page bundle. Same reason `blob-path.ts` exists separately in Rough Cut.
 */

/** Everything the worker needs to render one scene to one file. */
export interface RenderSceneRequest {
  type: "render";
  /** Which template to draw. Only `chart-full` exists in Phase 4. */
  template: "chart-full";
  scene: ChartFullScene;
  /** Output frame size in pixels. Both must be even for H.264. */
  width: number;
  height: number;
  /** The project's output rate, as an exact rational. */
  fps: VideoFps;
  /** How long the clip runs. The planner clamps this to 4 to 10 seconds. */
  durationMs: number;
}

export type RenderRequestMessage = RenderSceneRequest | { type: "cancel" };

export type RenderResponseMessage =
  /** Frames encoded so far, as a fraction from 0 to 1. */
  | { type: "progress"; ratio: number }
  /** The finished MP4, transferred rather than copied. */
  | { type: "done"; buffer: ArrayBuffer }
  | { type: "canceled" }
  | { type: "error"; code: RenderErrorCode; message: string };

/**
 * Why a render failed, in the terms the UI has to act on.
 *
 * `unsupported` is the AC-29 case reaching the worker anyway: the capability
 * check runs at load, but a device can still refuse at encode time, and the
 * user needs a different message from a generic failure.
 */
export type RenderErrorCode = "unsupported" | "encode-failed" | "bad-request";
