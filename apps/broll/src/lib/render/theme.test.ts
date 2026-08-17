import { describe, expect, it } from "vitest";
import { BRAND, GRID, SERIES, TYPEFACE, drawBackdrop } from "./theme";
import { CHART_FULL_THEME } from "./chart-full";
import { TEXT_CARD_THEME } from "./text-card";
import { CHARACTER_LEFT_THEME } from "./character-left";
import { CHARACTER_CENTER_THEME } from "./character-center";

type Rect = { x: number; y: number; width: number; height: number; style: string };

function recorder() {
  const rects: Rect[] = [];
  return {
    rects,
    fillStyle: "" as string,
    fillRect(x: number, y: number, width: number, height: number) {
      rects.push({ x, y, width, height, style: String(this.fillStyle) });
    },
  };
}

/**
 * The palette discipline, and the backdrop every template opens with.
 *
 * The brief's rule is one line — "do not introduce new hues" — and it is the
 * rule the templates broke before this module existed, each inventing its own
 * navy ground and periwinkle figure. A test is the only thing that keeps a rule
 * like that true once the person who read the brief has moved on.
 */

const PALETTE = new Set<string>([...Object.values(BRAND), ...SERIES]);

describe("no template invents a colour", () => {
  const themes = {
    "chart-full": CHART_FULL_THEME,
    "text-card": TEXT_CARD_THEME,
    "character-left": CHARACTER_LEFT_THEME,
    "character-center": CHARACTER_CENTER_THEME,
  };

  it.each(Object.entries(themes))("%s draws only from the brand palette", (_name, theme) => {
    const colours = Object.values(theme)
      .flatMap((value) => (Array.isArray(value) ? value : [value]))
      .filter((value): value is string => typeof value === "string" && value.startsWith("#"));

    expect(colours.length).toBeGreaterThan(0);
    for (const colour of colours) expect(PALETTE).toContain(colour);
  });

  it("keeps the series ramp free of a third hue", () => {
    // Yellow, blue, their shades and neutrals. A green or an orange here would
    // be the brief's one prohibition, and is easy to add without noticing.
    for (const colour of SERIES) expect(PALETTE).toContain(colour);
    expect(new Set(SERIES).size).toBe(SERIES.length);
  });

  it("never puts white on yellow", () => {
    // Explicitly called out in the brief: white on Key Yellow fails contrast, so
    // anything drawn on an accent fill uses near black.
    expect(BRAND.accentForeground).toBe("#111111");
    expect(BRAND.accentForeground).not.toBe(BRAND.foreground);
  });
});

describe("drawBackdrop", () => {
  const frame = { width: 1920, height: 1080 };

  it("paints the whole frame before anything else", () => {
    // The encoder reuses one canvas, so a frame that does not fully repaint
    // inherits the previous one. The ground has to be first and total.
    const ctx = recorder();
    drawBackdrop(ctx, frame);

    expect(ctx.rects[0]).toEqual({
      x: 0,
      y: 0,
      width: 1920,
      height: 1080,
      style: BRAND.background,
    });
  });

  it("lays a grid at the brief's 40px density on a 1080p frame", () => {
    const ctx = recorder();
    drawBackdrop(ctx, frame);

    const lines = ctx.rects.slice(1);
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) expect(line.style).toBe(GRID.line);

    // 1080 / 27 = 40px cells, which is the brief's figure rather than a number
    // chosen to make this pass.
    const verticals = lines.filter((line) => line.height === 1080);
    expect(verticals[1].x - verticals[0].x).toBeCloseTo(40, 0);
  });

  it("keeps the same visual density in portrait", () => {
    // Measured off the short edge, so a 9:16 clip does not get a grid twice as
    // fine as a 16:9 one — the same reasoning as `typeScale`.
    const landscape = recorder();
    const portrait = recorder();
    drawBackdrop(landscape, { width: 1920, height: 1080 });
    drawBackdrop(portrait, { width: 1080, height: 1920 });

    const cellOf = (ctx: ReturnType<typeof recorder>, fullHeight: number) => {
      const verticals = ctx.rects.slice(1).filter((line) => line.height === fullHeight);
      return verticals[1].x - verticals[0].x;
    };

    expect(cellOf(portrait, 1920)).toBeCloseTo(cellOf(landscape, 1080), 0);
  });

  it("draws grid lines at least two pixels wide at 1080p", () => {
    // A 1px line at 8% white is what H.264 turns into shimmer rather than a
    // grid. This is the mitigation, and it is easy to undo by accident.
    const ctx = recorder();
    drawBackdrop(ctx, frame);
    expect(ctx.rects[1].width).toBeGreaterThanOrEqual(2);
  });

  it("survives a degenerate frame without looping forever", () => {
    const ctx = recorder();
    drawBackdrop(ctx, { width: 0, height: 0 });
    expect(ctx.rects).toHaveLength(1);
  });
});

describe("TYPEFACE", () => {
  it("names no font the render worker cannot resolve", () => {
    // The gap this constant documents: a worker's OffscreenCanvas resolves
    // against `self.fonts`, which nothing populates, so naming the brand face
    // here would render in the preview and silently fall back in the exported
    // file. Until the woff2 files are served and registered, the stack has to be
    // one both canvases resolve identically.
    expect(TYPEFACE).not.toContain("Space Grotesk");
    expect(TYPEFACE).not.toContain("DM Sans");
    expect(TYPEFACE).toContain("sans-serif");
  });
});
