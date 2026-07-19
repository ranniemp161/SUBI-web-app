// @vitest-environment jsdom
import { render, cleanup } from "@testing-library/react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { createRef } from "react";
import VideoPlayer, { type VideoPlayerHandle } from "./video-player";
import type { EDL } from "@/lib/edl";

afterEach(() => {
  cleanup();
});

const KEEP_ALL_EDL: EDL = {
  segments: [{ start: 0, end: 60, status: "keep", reason: null }],
};

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

function renderPlayer(onTimeUpdate: (seconds: number) => void) {
  const ref = createRef<VideoPlayerHandle>();
  const { container } = render(
    <VideoPlayer ref={ref} src="blob:test" edl={KEEP_ALL_EDL} onTimeUpdate={onTimeUpdate} />
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
