// @vitest-environment jsdom
import { render, cleanup } from "@testing-library/react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { createRef } from "react";
import VideoPlayer, { type VideoPlayerHandle } from "./video-player";
import type { EDL } from "@/lib/edl";
import { frameToSeconds, type VideoFps } from "@/lib/frame-math";

afterEach(() => {
  cleanup();
});

const KEEP_ALL_EDL: EDL = {
  segments: [{ start: 0, end: 60, status: "keep", reason: null }],
};

const FPS_30: VideoFps = { numerator: 30, denominator: 1 };

/**
 * Replace the jsdom video element's inert currentTime with one that mimics a
 * real media engine: a seek stores the requested time but reads back slightly
 * BELOW it (Chromium quantizes currentTime to microseconds, so a repeating
 * decimal like 34.96666666666667 settles at 34.966666). The regression this
 * guards: that under-read used to be reported verbatim, so exact comparisons
 * downstream (active-word highlight, findSegmentAt) resolved to the PREVIOUS
 * word/segment after every word click.
 */
function installQuantizedClock(video: HTMLVideoElement, driftSeconds: number) {
  let stored = 0;
  Object.defineProperty(video, "currentTime", {
    configurable: true,
    get: () => stored,
    set: (value: number) => {
      stored = value - driftSeconds;
      video.dispatchEvent(new Event("timeupdate"));
    },
  });
  Object.defineProperty(video, "seeking", {
    configurable: true,
    get: () => false,
  });
}

function renderPlayer(onTimeUpdate: (seconds: number) => void, edl: EDL = KEEP_ALL_EDL) {
  const ref = createRef<VideoPlayerHandle>();
  const { container } = render(
    <VideoPlayer ref={ref} src="blob:test" edl={edl} onTimeUpdate={onTimeUpdate} />
  );
  const video = container.querySelector("video")!;
  return { ref, video };
}

describe("VideoPlayer seek readback", () => {
  it("reports the exact requested time when the engine reads back a hair below it", () => {
    const onTimeUpdate = vi.fn();
    const { ref, video } = renderPlayer(onTimeUpdate);
    installQuantizedClock(video, 0.000001);

    const wordStart = 34.96666666666667;
    ref.current!.seek(wordStart);

    expect(onTimeUpdate).toHaveBeenCalledWith(wordStart);
    expect(video.currentTime).toBeLessThan(wordStart);
  });

  it("reports the real clock once playback drifts past the quantization window", () => {
    const onTimeUpdate = vi.fn();
    const { ref, video } = renderPlayer(onTimeUpdate);
    installQuantizedClock(video, 0);

    ref.current!.seek(10);
    onTimeUpdate.mockClear();

    // Simulate playback having advanced well past the seek point.
    video.currentTime = 10.5;

    expect(onTimeUpdate).toHaveBeenCalledWith(10.5);
  });
});

describe("VideoPlayer frame stepping (spec 0004)", () => {
  // jsdom has no requestVideoFrameCallback, so by default these exercise the
  // fallback path (AC-15); one test installs a stub to cover the confirmed path.
  it("steps forward exactly one frame at the detected rate (fallback path)", () => {
    const onTimeUpdate = vi.fn();
    const { ref, video } = renderPlayer(onTimeUpdate);
    installQuantizedClock(video, 0);

    ref.current!.seek(1.0); // frame 30 at 30fps
    onTimeUpdate.mockClear();
    ref.current!.stepFrame(1, FPS_30);

    // Frame 31 at 30fps.
    expect(onTimeUpdate).toHaveBeenCalledWith(expect.closeTo(frameToSeconds(31, FPS_30), 6));
    expect(video.currentTime).toBeCloseTo(frameToSeconds(31, FPS_30), 6);
  });

  it("steps back one frame and never below frame 0", () => {
    const onTimeUpdate = vi.fn();
    const { ref, video } = renderPlayer(onTimeUpdate);
    installQuantizedClock(video, 0);

    ref.current!.seek(frameToSeconds(1, FPS_30)); // frame 1
    onTimeUpdate.mockClear();
    ref.current!.stepFrame(-1, FPS_30);
    expect(onTimeUpdate).toHaveBeenCalledWith(expect.closeTo(0, 6));

    onTimeUpdate.mockClear();
    ref.current!.stepFrame(-1, FPS_30); // already at 0 — clamps
    expect(onTimeUpdate).toHaveBeenCalledWith(expect.closeTo(0, 6));
  });

  it("confirms the presented frame via requestVideoFrameCallback when available", () => {
    const onTimeUpdate = vi.fn();
    const { ref, video } = renderPlayer(onTimeUpdate);
    installQuantizedClock(video, 0);
    // Stub rVFC to report the frame that was actually seeked to. Only mediaTime
    // is read, so the rest of the metadata is asserted rather than filled.
    video.requestVideoFrameCallback = (cb) => {
      cb(0, { mediaTime: video.currentTime } as VideoFrameCallbackMetadata);
      return 1;
    };

    ref.current!.seek(2.0); // frame 60
    onTimeUpdate.mockClear();
    ref.current!.stepFrame(1, FPS_30);
    expect(onTimeUpdate).toHaveBeenCalledWith(expect.closeTo(frameToSeconds(61, FPS_30), 6));
  });

  it("steps through a cut instead of skipping it (AC-13)", () => {
    const EDL_WITH_CUT: EDL = {
      segments: [
        { start: 0, end: 1, status: "keep", reason: null },
        { start: 1, end: 2, status: "cut", reason: "silence" },
        { start: 2, end: 3, status: "keep", reason: null },
      ],
    };
    const onTimeUpdate = vi.fn();
    const { ref, video } = renderPlayer(onTimeUpdate, EDL_WITH_CUT);
    installQuantizedClock(video, 0);

    // Start on a keep frame (a normal seek onto the 1.0 boundary would itself
    // skip the cut), then step across the boundary into the cut.
    ref.current!.seek(frameToSeconds(29, FPS_30)); // 0.966s, inside the keep
    onTimeUpdate.mockClear();
    ref.current!.stepFrame(1, FPS_30); // -> frame 30 = 1.0
    ref.current!.stepFrame(1, FPS_30); // -> frame 31 = 1.033s, inside the cut

    const stepped = frameToSeconds(31, FPS_30);
    expect(onTimeUpdate).toHaveBeenCalledWith(expect.closeTo(stepped, 6));
    // It must NOT have skipped forward to the next kept segment at 2.0.
    expect(onTimeUpdate).not.toHaveBeenCalledWith(expect.closeTo(2.0, 3));
    expect(video.currentTime).toBeCloseTo(stepped, 6);
  });
});
