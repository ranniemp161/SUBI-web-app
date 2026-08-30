import {
  BufferTarget,
  CanvasSource,
  Mp4OutputFormat,
  Output,
  QUALITY_HIGH,
  canEncodeVideo,
} from "mediabunny";
import { loadBrandFonts } from "@/lib/render/fonts";
import { drawRenderable } from "@/lib/render/renderable";
import { frameDurationSeconds, frameElapsedMs, frameTimestampSeconds, renderFrameCount } from "@/lib/render/timing";
import type {
  RenderErrorCode,
  RenderRequestMessage,
  RenderResponseMessage,
  RenderSceneRequest,
} from "@/lib/render/types";

/**
 * Renders one scene to an MP4, entirely in the browser (spec `0001`, Phase 4).
 *
 * The frames do not exist anywhere before this runs: they are drawn to an
 * `OffscreenCanvas` here and handed straight to the encoder. That is the one
 * thing Phase 0's spike was uncertain about, and it passed, so this is the
 * whole delivery path. No render queue, no ffmpeg, no server.
 *
 * The worker owns the encode and nothing else. It does not decide what a clip
 * is called, does not touch the ledger, and does not know what a project is.
 * It takes a drawing and gives back bytes.
 */

// The shared tsconfig uses the "dom" lib, which does not declare
// DedicatedWorkerGlobalScope; that only exists under "webworker" and the two
// conflict. Narrow local typing for the worker surface actually used, matching
// the pattern in Rough Cut's export worker.
declare const self: {
  postMessage(message: RenderResponseMessage, transfer?: Transferable[]): void;
  onmessage: ((event: MessageEvent<RenderRequestMessage>) => unknown) | null;
};

function post(message: RenderResponseMessage, transfer?: Transferable[]) {
  self.postMessage(message, transfer);
}

class RenderError extends Error {
  constructor(
    readonly code: RenderErrorCode,
    message: string
  ) {
    super(message);
  }
}

/** Set when a cancel arrives; the frame loop checks it between frames. */
let cancelRequested = false;

self.onmessage = async (event: MessageEvent<RenderRequestMessage>) => {
  const message = event.data;

  if (message.type === "cancel") {
    cancelRequested = true;
    return;
  }

  if (message.type !== "render") return;

  cancelRequested = false;

  try {
    const buffer = await renderScene(message);
    if (buffer === null) {
      post({ type: "canceled" });
      return;
    }
    // Transferred, not copied: a 1080p clip is megabytes and structured
    // cloning it would double the peak memory for no reason.
    post({ type: "done", buffer }, [buffer]);
  } catch (error) {
    if (error instanceof RenderError) {
      post({ type: "error", code: error.code, message: error.message });
      return;
    }
    post({ type: "error", code: "encode-failed", message: describeError(error) });
  }
};

async function renderScene(request: RenderSceneRequest): Promise<ArrayBuffer | null> {
  const { width, height, fps, durationMs } = request;

  if (width % 2 !== 0 || height % 2 !== 0 || width <= 0 || height <= 0) {
    throw new RenderError("bad-request", `Output size ${width}x${height} can't be encoded as H.264.`);
  }

  // The page checks this at load so the gate sits in front of the spend
  // (AC-29). Checking again here costs one call and covers the case where the
  // page was left open across a browser update, or the size changed since.
  let encodable = false;
  try {
    encodable = await canEncodeVideo("avc", { width, height });
  } catch {
    throw new RenderError("unsupported", "This browser can't encode video. Rendering needs WebCodecs.");
  }
  if (!encodable) {
    throw new RenderError("unsupported", `This device can't encode video at ${width}x${height}.`);
  }

  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new RenderError("encode-failed", "Couldn't get a 2D drawing context for the render.");
  }

  // **Before the first frame, not alongside it.** A worker's font set starts
  // empty, so a frame drawn while these are still in flight is set in the
  // fallback stack — and since the encode is a single pass, that frame ships
  // that way. Awaiting here costs one round trip per render and is what makes
  // the exported file agree with the preview.
  //
  // A failure is deliberately not fatal: it draws in the fallback stack rather
  // than losing a render the creator has already waited for.
  await loadBrandFonts();

  const target = new BufferTarget();
  const output = new Output({ format: new Mp4OutputFormat(), target });

  const source = new CanvasSource(canvas, {
    codec: "avc",
    quality: QUALITY_HIGH,
    // A clip is seconds long and gets scrubbed frame by frame in an NLE, so
    // key frames are cheap here and seeking matters more than file size.
    keyFrameInterval: 1,
  });
  output.addVideoTrack(source, { frameRate: fps.numerator / fps.denominator });

  await output.start();

  const frames = renderFrameCount(durationMs, fps);
  const frameDuration = frameDurationSeconds(fps);

  for (let index = 0; index < frames; index += 1) {
    if (cancelRequested) {
      await output.cancel();
      return null;
    }

    drawRenderable(ctx, request, {
      width,
      height,
      elapsedMs: frameElapsedMs(index, fps),
      durationMs,
    });

    // Awaited per frame on purpose: this is the encoder's backpressure signal,
    // and firing all of them at once would queue every frame of the clip in
    // memory before the first one finished encoding.
    await source.add(frameTimestampSeconds(index, fps), frameDuration);

    // Report on a cadence rather than every frame; at 30fps a per frame
    // message is 30 postMessage round trips a second for a bar that moves 3%.
    if (index % 5 === 0 || index === frames - 1) {
      post({ type: "progress", ratio: (index + 1) / frames });
    }
  }

  await output.finalize();

  if (!target.buffer) {
    throw new RenderError("encode-failed", "The encoder finished without producing a file.");
  }
  return target.buffer;
}

function describeError(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return "The render failed for an unknown reason.";
}
