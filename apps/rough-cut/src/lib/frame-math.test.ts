import { describe, it, expect } from "vitest";
import {
  frameDurationSeconds,
  frameToMs,
  frameToSeconds,
  msToFrame,
  secondsToFrame,
  type VideoFps,
} from "./frame-math";

const NTSC_2398: VideoFps = { numerator: 24000, denominator: 1001 };
const FILM_24: VideoFps = { numerator: 24, denominator: 1 };
const PAL_25: VideoFps = { numerator: 25, denominator: 1 };
const NTSC_2997: VideoFps = { numerator: 30000, denominator: 1001 };
const FPS_30: VideoFps = { numerator: 30, denominator: 1 };
const FPS_50: VideoFps = { numerator: 50, denominator: 1 };
const NTSC_5994: VideoFps = { numerator: 60000, denominator: 1001 };
const FPS_60: VideoFps = { numerator: 60, denominator: 1 };

const ALL_RATES: VideoFps[] = [
  NTSC_2398,
  FILM_24,
  PAL_25,
  NTSC_2997,
  FPS_30,
  FPS_50,
  NTSC_5994,
  FPS_60,
];

describe("secondsToFrame", () => {
  it("converts whole seconds at 30fps", () => {
    expect(secondsToFrame(1, FPS_30)).toBe(30);
    expect(secondsToFrame(5, FPS_30)).toBe(150);
  });

  it("uses the exact NTSC rational, not a rounded 30", () => {
    // 1 second at 29.97 is 29.97 frames, which rounds to 30, but 100 seconds
    // is 2997 frames, not 3000 — the difference only shows on a long timeline.
    expect(secondsToFrame(100, NTSC_2997)).toBe(2997);
    expect(secondsToFrame(100, FPS_30)).toBe(3000);
  });
});

describe("msToFrame", () => {
  it("lands exactly on a frame boundary", () => {
    // Frame 45 at 30fps starts at 1500ms exactly.
    expect(msToFrame(1500, FPS_30)).toBe(45);
  });

  it("rounds a time between two frames to the nearest frame", () => {
    // At 30fps, msToFrame(ms) = round(ms * 0.03). Frame 45 starts at 1500ms.
    expect(msToFrame(1505, FPS_30)).toBe(45); // 45.15 -> 45
    expect(msToFrame(1516, FPS_30)).toBe(45); // 45.48 -> 45 (just under half)
    expect(msToFrame(1517, FPS_30)).toBe(46); // 45.51 -> 46 (just over half)
    expect(msToFrame(1520, FPS_30)).toBe(46); // 45.6 -> 46
  });

  it("agrees with secondsToFrame on the same instant", () => {
    for (const fps of ALL_RATES) {
      expect(msToFrame(2000, fps)).toBe(secondsToFrame(2, fps));
    }
  });
});

describe("frameToMs / frameToSeconds round trip", () => {
  it("returns a time within one frame's duration of the original ms, at every standard rate", () => {
    const samples = [0, 1, 16, 250, 1000, 1499, 33333, 123456];
    for (const fps of ALL_RATES) {
      const oneFrameMs = frameDurationSeconds(fps) * 1000;
      for (const ms of samples) {
        const roundTripped = frameToMs(msToFrame(ms, fps), fps);
        expect(Math.abs(roundTripped - ms)).toBeLessThanOrEqual(oneFrameMs);
      }
    }
  });

  it("frameToSeconds is the inverse of secondsToFrame on frame boundaries", () => {
    for (const fps of ALL_RATES) {
      for (const frame of [0, 1, 24, 100, 2997]) {
        expect(secondsToFrame(frameToSeconds(frame, fps), fps)).toBe(frame);
      }
    }
  });
});

describe("frameDurationSeconds", () => {
  it("is 1/fps for integer rates", () => {
    expect(frameDurationSeconds(FPS_30)).toBeCloseTo(1 / 30, 10);
    expect(frameDurationSeconds(FPS_60)).toBeCloseTo(1 / 60, 10);
  });

  it("uses the exact rational for NTSC rates", () => {
    expect(frameDurationSeconds(NTSC_2997)).toBeCloseTo(1001 / 30000, 10);
  });
});
