import { describe, it, expect } from "vitest";
import {
  DEFAULT_FPS,
  formatTimecode,
  isDropFrame,
  minClipSeconds,
  nominalFps,
  snapToStandardFps,
  toFrames,
  type VideoFps,
} from "./timebase";

const NTSC_2997: VideoFps = { numerator: 30000, denominator: 1001 };
const NTSC_5994: VideoFps = { numerator: 60000, denominator: 1001 };
const NTSC_2398: VideoFps = { numerator: 24000, denominator: 1001 };
const PAL_25: VideoFps = { numerator: 25, denominator: 1 };

describe("toFrames", () => {
  it("converts whole seconds to frames at the default 30fps", () => {
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

  it("uses the exact rational for NTSC rates so long timelines don't drift", () => {
    expect(toFrames(1, NTSC_2997)).toBe(30);
    expect(toFrames(3600, NTSC_2997)).toBe(107892); // 3600 * 30000/1001, not 3600 * 30
    expect(toFrames(1, NTSC_2398)).toBe(24);
    expect(toFrames(2, PAL_25)).toBe(50);
  });
});

describe("minClipSeconds", () => {
  it("equals one frame at the given fps", () => {
    expect(minClipSeconds()).toBeCloseTo(1 / 30, 10);
    expect(minClipSeconds(NTSC_2997)).toBeCloseTo(1001 / 30000, 10);
    expect(minClipSeconds(PAL_25)).toBeCloseTo(1 / 25, 10);
  });
});

describe("snapToStandardFps", () => {
  it("snaps a measured rate to the nearest NTSC rational", () => {
    expect(snapToStandardFps(29.95)).toEqual(NTSC_2997);
    expect(snapToStandardFps(59.9)).toEqual(NTSC_5994);
    expect(snapToStandardFps(23.98)).toEqual(NTSC_2398);
  });

  it("snaps near-integer rates to the integer standard", () => {
    expect(snapToStandardFps(25.01)).toEqual(PAL_25);
    expect(snapToStandardFps(30.02)).toEqual(DEFAULT_FPS);
    expect(snapToStandardFps(60.05)).toEqual({ numerator: 60, denominator: 1 });
  });

  it("rounds oddball rates to the nearest integer fps instead of forcing a standard", () => {
    expect(snapToStandardFps(33.3)).toEqual({ numerator: 33, denominator: 1 });
    expect(snapToStandardFps(15.02)).toEqual({ numerator: 15, denominator: 1 });
  });
});

describe("isDropFrame", () => {
  it("is true only for the NTSC 30 and 60 families", () => {
    expect(isDropFrame(NTSC_2997)).toBe(true);
    expect(isDropFrame(NTSC_5994)).toBe(true);
    expect(isDropFrame(NTSC_2398)).toBe(false); // 23.976 is always NDF
    expect(isDropFrame(DEFAULT_FPS)).toBe(false);
    expect(isDropFrame(PAL_25)).toBe(false);
  });
});

describe("nominalFps", () => {
  it("returns the integer label rate", () => {
    expect(nominalFps(NTSC_2997)).toBe(30);
    expect(nominalFps(NTSC_5994)).toBe(60);
    expect(nominalFps(PAL_25)).toBe(25);
  });
});

describe("formatTimecode (non-drop-frame)", () => {
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

  it("keeps the ':' separator at non-drop rates like 25fps", () => {
    expect(formatTimecode(65, PAL_25)).toBe("00:01:05:00");
  });

  it("keeps 23.976 non-drop-frame", () => {
    expect(formatTimecode(1, NTSC_2398)).toBe("00:00:01:00");
  });
});

describe("formatTimecode (drop-frame)", () => {
  // Seconds values chosen to land exactly on the target real frame count f:
  // seconds = f * 1001 / 30000 (or /60000 at 59.94).
  const at2997 = (f: number) => (f * 1001) / 30000;
  const at5994 = (f: number) => (f * 1001) / 60000;

  it("uses ';' before the frame field", () => {
    expect(formatTimecode(0, NTSC_2997)).toBe("00:00:00;00");
  });

  it("counts normally within the first minute", () => {
    expect(formatTimecode(at2997(1799), NTSC_2997)).toBe("00:00:59;29");
  });

  it("skips frame labels 00 and 01 at a minute boundary", () => {
    expect(formatTimecode(at2997(1800), NTSC_2997)).toBe("00:01:00;02");
  });

  it("does not skip labels at a ten-minute boundary", () => {
    expect(formatTimecode(at2997(17982), NTSC_2997)).toBe("00:10:00;00");
  });

  it("skips four labels per minute at 59.94", () => {
    expect(formatTimecode(at5994(3600), NTSC_5994)).toBe("00:01:00;04");
  });
});
