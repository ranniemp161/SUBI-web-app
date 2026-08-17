import { describe, expect, it } from "vitest";
import {
  ASPECT_RATIOS,
  ASPECT_RATIO_OPTIONS,
  DEFAULT_ASPECT_RATIO,
  isAspectRatio,
  outputSizeFor,
} from "./aspect-ratio";

describe("outputSizeFor", () => {
  it("resolves the two ratios to 1080p in each orientation", () => {
    expect(outputSizeFor("landscape")).toEqual({ width: 1920, height: 1080 });
    expect(outputSizeFor("portrait")).toEqual({ width: 1080, height: 1920 });
  });

  it("falls back to landscape for anything it does not recognise", () => {
    // A stale client, not an attack: neither dimension is a security boundary,
    // so the fallback is the behaviour every project had before the picker.
    for (const value of [undefined, null, "", "square", "9:16", "PORTRAIT"]) {
      expect(outputSizeFor(value)).toEqual(outputSizeFor(DEFAULT_ASPECT_RATIO));
    }
  });

  it("defaults to the dimensions the column already defaulted to", () => {
    // `broll_projects.output_width`/`output_height` default to 1920x1080 in the
    // schema. If this drifts, a project created through the form and one created
    // any other way stop agreeing on what "no choice made" means.
    expect(outputSizeFor(DEFAULT_ASPECT_RATIO)).toEqual({ width: 1920, height: 1080 });
  });
});

describe("the ratio table", () => {
  it("describes every id, and only real ids", () => {
    expect(Object.keys(ASPECT_RATIO_OPTIONS).sort()).toEqual([...ASPECT_RATIOS].sort());
  });

  it("gives each option a distinct shape", () => {
    // The picker draws the ratio as a rectangle. Two options that resolve to the
    // same dimensions would render as the same swatch and read as a bug.
    const shapes = ASPECT_RATIOS.map((id) => {
      const { width, height } = ASPECT_RATIO_OPTIONS[id];
      return `${width}x${height}`;
    });
    expect(new Set(shapes).size).toBe(shapes.length);
  });

  it("accepts only the listed ids", () => {
    expect(isAspectRatio("portrait")).toBe(true);
    expect(isAspectRatio("vertical")).toBe(false);
  });
});
