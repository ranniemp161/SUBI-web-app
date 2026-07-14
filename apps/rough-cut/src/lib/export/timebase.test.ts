import { describe, it, expect } from "vitest";
import { FPS, MIN_CLIP_SECONDS, toFrames, formatTimecode } from "./timebase";

describe("toFrames", () => {
  it("converts whole seconds to frames at 30fps", () => {
    expect(toFrames(1)).toBe(30);
    expect(toFrames(5)).toBe(150);
  });

  it("returns 0 for 0 seconds", () => {
    expect(toFrames(0)).toBe(0);
  });

  it("rounds to the nearest frame for a fractional duration", () => {
    expect(toFrames(1 / 30)).toBe(1);
    expect(toFrames(0.017)).toBe(1); // 0.017 * 30 = 0.51, rounds up
    expect(toFrames(0.016)).toBe(0); // 0.016 * 30 = 0.48, rounds down
  });
});

describe("MIN_CLIP_SECONDS", () => {
  it("equals one frame at the fixed FPS", () => {
    expect(MIN_CLIP_SECONDS).toBeCloseTo(1 / FPS, 10);
  });
});

describe("formatTimecode", () => {
  it("formats 0 seconds as 00:00:00:00", () => {
    expect(formatTimecode(0)).toBe("00:00:00:00");
  });

  it("formats whole seconds with zero frames", () => {
    expect(formatTimecode(5)).toBe("00:00:05:00");
  });

  it("formats a duration crossing a minute boundary", () => {
    expect(formatTimecode(65)).toBe("00:01:05:00");
  });

  it("formats a duration crossing an hour boundary", () => {
    expect(formatTimecode(3661)).toBe("01:01:01:00");
  });

  it("includes the sub-second frame count", () => {
    // 1.5s = 45 frames = 1s (30 frames) + 15 frames
    expect(formatTimecode(1.5)).toBe("00:00:01:15");
  });

  it("pads every field to two digits", () => {
    expect(formatTimecode(3661.0333)).toBe("01:01:01:01");
  });
});
