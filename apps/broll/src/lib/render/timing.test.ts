import { describe, expect, it } from "vitest";
import {
  frameDurationSeconds,
  frameElapsedMs,
  frameTimestampSeconds,
  renderFrameCount,
} from "./timing";

const FPS_30 = { numerator: 30, denominator: 1 } as const;
const FPS_2997 = { numerator: 30000, denominator: 1001 } as const;
const FPS_25 = { numerator: 25, denominator: 1 } as const;

describe("renderFrameCount", () => {
  it("counts whole frames for a clip", () => {
    expect(renderFrameCount(5_000, FPS_30)).toBe(150);
    expect(renderFrameCount(5_000, FPS_25)).toBe(125);
  });

  it("uses the exact rational rate, not a rounded decimal", () => {
    // 5s at 29.97 is 149.85 frames. A naive 29.97 multiply gives 149.85 too,
    // but a 30 multiply gives 150, and that one frame is the drift.
    expect(renderFrameCount(5_000, FPS_2997)).toBe(150);
    expect(renderFrameCount(60_000, FPS_2997)).toBe(1798);
  });

  it("never returns zero, so a clip always produces a playable file", () => {
    // A duration under one frame still has to encode something. An empty MP4
    // would be a worse answer than a very short one.
    expect(renderFrameCount(1, FPS_30)).toBe(1);
    expect(renderFrameCount(0, FPS_30)).toBe(1);
    expect(renderFrameCount(-5_000, FPS_30)).toBe(1);
    expect(renderFrameCount(Number.NaN, FPS_30)).toBe(1);
  });
});

describe("frameTimestampSeconds", () => {
  it("places frames on the exact rational grid", () => {
    expect(frameTimestampSeconds(0, FPS_30)).toBe(0);
    expect(frameTimestampSeconds(30, FPS_30)).toBeCloseTo(1, 10);
    // 30 frames at 29.97 is slightly past one second, and must stay that way.
    expect(frameTimestampSeconds(30, FPS_2997)).toBeCloseTo(1.001, 10);
  });

  it("advances strictly, so the encoder never sees a repeated timestamp", () => {
    let previous = -1;
    for (let index = 0; index < 300; index += 1) {
      const value = frameTimestampSeconds(index, FPS_2997);
      expect(value).toBeGreaterThan(previous);
      previous = value;
    }
  });
});

describe("frameDurationSeconds", () => {
  it("is the exact reciprocal of the rate", () => {
    expect(frameDurationSeconds(FPS_30)).toBeCloseTo(1 / 30, 12);
    expect(frameDurationSeconds(FPS_2997)).toBeCloseTo(1001 / 30000, 12);
  });

  it("tiles the timeline without gaps or overlaps", () => {
    // Frame N's start plus one duration must be frame N+1's start, or the
    // encoder is handed a timeline with holes in it.
    for (const fps of [FPS_30, FPS_2997, FPS_25]) {
      for (const index of [0, 1, 47, 299]) {
        expect(frameTimestampSeconds(index, fps) + frameDurationSeconds(fps)).toBeCloseTo(
          frameTimestampSeconds(index + 1, fps),
          10
        );
      }
    }
  });
});

describe("frameElapsedMs", () => {
  it("hands the drawing functions milliseconds from the scene's own start", () => {
    expect(frameElapsedMs(0, FPS_30)).toBe(0);
    expect(frameElapsedMs(15, FPS_30)).toBeCloseTo(500, 6);
    expect(frameElapsedMs(30, FPS_30)).toBeCloseTo(1000, 6);
  });
});
