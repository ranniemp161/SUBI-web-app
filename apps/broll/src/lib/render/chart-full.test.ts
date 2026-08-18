import { describe, expect, it } from "vitest";
import {
  CHART_FULL_THEME,
  drawChartFullFrame,
  entranceProgress,
  idleDrift,
  resolveChartShape,
  type Chart2DContext,
  type ChartFullScene,
} from "./chart-full";

type Call =
  | { op: "fillRect"; x: number; y: number; width: number; height: number; style: string }
  | { op: "fillText"; text: string; x: number; y: number; style: string; font: string }
  | { op: "arc"; x: number; y: number; radius: number; start: number; end: number; style: string }
  | { op: "lineTo"; x: number; y: number }
  | { op: "moveTo"; x: number; y: number }
  | { op: "stroke"; style: string }
  | { op: "fill"; style: string };

/**
 * Records what was drawn, so the renderer can be asserted without a canvas.
 *
 * **Still its own copy, unlike every other render test, and deliberately so
 * for now.** The shared `test-recorder.ts` drops path building on purpose — it
 * holds that asserting on `moveTo`/`lineTo`/`arc` is asserting on the
 * implementation of a shape rather than on the shape. These tests do exactly
 * that, because a line chart's segments are the only evidence it drew a line.
 * Spec `broll/0009` slice 3 redraws every chart mark, which is the point at
 * which these assertions are rewritten and this copy goes away. Until then,
 * keeping it is honest and merging it would mean widening the shared recorder
 * with the very thing it refuses to record.
 */
function recorder() {
  const calls: Call[] = [];
  const ctx: Chart2DContext & { calls: Call[] } = {
    calls,
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 0,
    lineJoin: "round",
    lineCap: "round",
    font: "",
    textAlign: "left",
    textBaseline: "top",
    save() {},
    restore() {},
    translate() {},
    beginPath() {},
    closePath() {},
    moveTo(x, y) {
      calls.push({ op: "moveTo", x, y });
    },
    lineTo(x, y) {
      calls.push({ op: "lineTo", x, y });
    },
    arc(x, y, radius, start, end) {
      calls.push({ op: "arc", x, y, radius, start, end, style: String(this.fillStyle) });
    },
    fill() {
      calls.push({ op: "fill", style: String(this.fillStyle) });
    },
    stroke() {
      calls.push({ op: "stroke", style: String(this.strokeStyle) });
    },
    fillRect(x, y, width, height) {
      // The renderer only ever assigns strings, so this is exact, not lossy.
      calls.push({ op: "fillRect", x, y, width, height, style: String(this.fillStyle) });
    },
    fillText(text, x, y) {
      calls.push({ op: "fillText", text, x, y, style: String(this.fillStyle), font: this.font });
    },
    // Needed only because the template opens with `drawBackdrop`, which fades
    // the grid through one radial gradient. Nothing in a chart mark uses it, so
    // the stops are dropped rather than recorded; `theme.test.ts` owns proving
    // the fade is right.
    createRadialGradient() {
      return {
        addColorStop() {},
      } as unknown as CanvasGradient;
    },
  };
  return ctx;
}

type Rec = ReturnType<typeof recorder>;

const BARS: ChartFullScene = {
  type: "bar",
  title: "Support collapsed",
  values: [80, 45],
  labels: ["Before", "After"],
  unit: "%",
};

/** The real chart from the user's own project: one statistic, not a bar chart. */
const BIG_NUMBER: ChartFullScene = {
  type: "number",
  title: "World Shipping Volume",
  values: [12],
  labels: ["Bab el Mandeb Share"],
  unit: "%",
};

const FRAME = { width: 1920, height: 1080, elapsedMs: 5_000 };

const bars = (ctx: Rec) =>
  ctx.calls.filter(
    (c): c is Extract<Call, { op: "fillRect" }> =>
      c.op === "fillRect" && c.style === CHART_FULL_THEME.bar
  );

const texts = (ctx: Rec) =>
  ctx.calls.filter((c): c is Extract<Call, { op: "fillText" }> => c.op === "fillText");

const arcs = (ctx: Rec) =>
  ctx.calls.filter((c): c is Extract<Call, { op: "arc" }> => c.op === "arc");

const draw = (scene: ChartFullScene, frame = FRAME) => {
  const ctx = recorder();
  drawChartFullFrame(ctx, scene, frame);
  return ctx;
};

describe("resolveChartShape", () => {
  it("reads the plain type words the planner is told to use", () => {
    expect(resolveChartShape("bar", 3)).toBe("bar");
    expect(resolveChartShape("line", 3)).toBe("line");
    expect(resolveChartShape("pie", 3)).toBe("pie");
    expect(resolveChartShape("number", 1)).toBe("number");
  });

  it("reads the prose the planner actually writes", () => {
    // The schema says "a single big number", so the model writes phrases, not
    // an enum. All of these have to land on the same shape.
    for (const written of ["single big number", "big number", "Big Number", "stat", "figure"]) {
      expect(resolveChartShape(written, 1)).toBe("number");
    }
    expect(resolveChartShape("Bar Chart", 2)).toBe("bar");
    expect(resolveChartShape("column chart", 2)).toBe("bar");
    expect(resolveChartShape("donut", 3)).toBe("pie");
    expect(resolveChartShape("trend line", 4)).toBe("line");
  });

  it("falls back by value count rather than drawing nothing", () => {
    // One value cannot be a bar chart worth looking at; several must be shown
    // somehow. An unknown type must never mean an empty frame.
    expect(resolveChartShape(null, 1)).toBe("number");
    expect(resolveChartShape(undefined, 1)).toBe("number");
    expect(resolveChartShape("", 1)).toBe("number");
    expect(resolveChartShape("sankey diagram", 1)).toBe("number");
    expect(resolveChartShape("sankey diagram", 4)).toBe("bar");
  });
});

describe("the single big number", () => {
  it("draws one large figure with its unit, not a one bar bar chart", () => {
    // This is the exact chart on the user's project, and drawing it as a bar
    // was the bug this shape exists to fix.
    const ctx = draw(BIG_NUMBER);
    expect(bars(ctx)).toHaveLength(0);
    expect(texts(ctx).map((c) => c.text)).toContain("12%");
  });

  it("sizes the figure as the whole frame, far larger than a bar label", () => {
    const big = texts(draw(BIG_NUMBER)).find((c) => c.text === "12%");
    const barLabel = texts(draw(BARS)).find((c) => c.text === "80%");
    const size = (font: string) => Number(font.match(/(\d+(?:\.\d+)?)px/)?.[1]);
    expect(size(big!.font)).toBeGreaterThan(size(barLabel!.font) * 3);
  });

  it("counts up from zero and lands exactly on the value", () => {
    expect(texts(draw(BIG_NUMBER, { ...FRAME, elapsedMs: 0 })).map((c) => c.text)).toContain("0%");
    expect(texts(draw(BIG_NUMBER, { ...FRAME, elapsedMs: 5_000 })).map((c) => c.text)).toContain(
      "12%"
    );
  });

  it("captions with the label, falling back to the title", () => {
    expect(texts(draw(BIG_NUMBER)).map((c) => c.text)).toContain("Bab el Mandeb Share");
    const noLabel = draw({ ...BIG_NUMBER, labels: [] });
    expect(texts(noLabel).map((c) => c.text)).toContain("World Shipping Volume");
  });

  it("centres the figure in the frame", () => {
    const big = texts(draw(BIG_NUMBER)).find((c) => c.text === "12%");
    expect(big!.x).toBeCloseTo(960, 0);
  });
});

describe("bars", () => {
  it("draws every value's label with its unit (AC-34, at the pixels)", () => {
    const drawn = texts(draw(BARS)).map((c) => c.text);
    expect(drawn).toContain("80%");
    expect(drawn).toContain("45%");
    expect(drawn).not.toContain("80");
    expect(drawn).not.toContain("45");
  });

  it("draws the title and the category labels", () => {
    const drawn = texts(draw(BARS)).map((c) => c.text);
    expect(drawn).toContain("Support collapsed");
    expect(drawn).toContain("Before");
    expect(drawn).toContain("After");
  });

  it("grows bars from zero, which is the template's specified entrance", () => {
    for (const bar of bars(draw(BARS, { ...FRAME, elapsedMs: 0 }))) expect(bar.height).toBe(0);
    const midway = bars(draw(BARS, { ...FRAME, elapsedMs: 200 }))[0];
    const settled = bars(draw(BARS, { ...FRAME, elapsedMs: 5_000 }))[0];
    expect(midway.height).toBeGreaterThan(0);
    expect(midway.height).toBeLessThan(settled.height);
  });

  it("keeps bar heights proportional to the values, baselined at zero", () => {
    const [tall, short] = bars(draw(BARS));
    expect(short.height / tall.height).toBeCloseTo(45 / 80, 5);
  });

  it("keeps every bar inside the frame", () => {
    for (const bar of bars(draw(BARS))) {
      expect(bar.x).toBeGreaterThanOrEqual(0);
      expect(bar.x + bar.width).toBeLessThanOrEqual(1920);
      expect(bar.y).toBeGreaterThanOrEqual(0);
    }
  });
});

describe("line", () => {
  const LINE: ChartFullScene = {
    type: "line",
    title: "Strikes per week",
    values: [4, 9, 6, 14],
    labels: ["W1", "W2", "W3", "W4"],
    unit: null,
  };

  it("strokes a path and labels each point", () => {
    const ctx = draw(LINE);
    expect(ctx.calls.some((c) => c.op === "stroke")).toBe(true);
    const drawn = texts(ctx).map((c) => c.text);
    for (const value of ["4", "9", "6", "14"]) expect(drawn).toContain(value);
  });

  it("reveals left to right, so a label never floats ahead of its data", () => {
    const early = texts(draw(LINE, { ...FRAME, elapsedMs: 60 })).map((c) => c.text);
    // The last point cannot be labelled while the line has not reached it.
    expect(early).not.toContain("14");
    const settled = texts(draw(LINE, { ...FRAME, elapsedMs: 5_000 })).map((c) => c.text);
    expect(settled).toContain("14");
  });
});

describe("pie", () => {
  const PIE: ChartFullScene = {
    type: "pie",
    title: "Who agreed",
    values: [50, 30, 20],
    labels: ["Arab League", "EU", "AU"],
    unit: "%",
  };

  it("sweeps slices proportional to their share", () => {
    const drawn = arcs(draw(PIE));
    expect(drawn).toHaveLength(3);
    const sweep = (a: Extract<Call, { op: "arc" }>) => a.end - a.start;
    expect(sweep(drawn[0]) / sweep(drawn[2])).toBeCloseTo(50 / 20, 5);
  });

  it("starts at twelve o'clock, not three", () => {
    expect(arcs(draw(PIE))[0].start).toBeCloseTo(-Math.PI / 2, 10);
  });

  it("sweeps in over the entrance", () => {
    expect(arcs(draw(PIE, { ...FRAME, elapsedMs: 0 }))).toHaveLength(0);
    const total = arcs(draw(PIE, { ...FRAME, elapsedMs: 5_000 })).reduce(
      (sum, a) => sum + (a.end - a.start),
      0
    );
    expect(total).toBeCloseTo(Math.PI * 2, 6);
  });

  it("gives each slice a different colour", () => {
    const styles = arcs(draw(PIE)).map((a) => a.style);
    expect(new Set(styles).size).toBe(3);
  });

  it("draws a negative value by magnitude rather than losing it", () => {
    // A share of a whole has no meaningful negative, but dropping the slice
    // would silently lose a number the speaker said.
    const ctx = draw({ ...PIE, values: [50, -30, 20] });
    expect(arcs(ctx)).toHaveLength(3);
  });
});

describe("every shape", () => {
  const SHAPES = [BARS, BIG_NUMBER, { ...BARS, type: "line" }, { ...BARS, type: "pie" }];

  it("paints the full frame background before anything else", () => {
    for (const scene of SHAPES) {
      expect(draw(scene).calls[0]).toMatchObject({
        op: "fillRect",
        x: 0,
        y: 0,
        width: 1920,
        height: 1080,
        style: CHART_FULL_THEME.background,
      });
    }
  });

  it("is a pure function of time: same inputs, same pixels", () => {
    for (const scene of SHAPES) {
      expect(draw(scene).calls).toEqual(draw(scene).calls);
    }
  });

  it("still paints a valid frame when the chart has nothing to plot", () => {
    for (const scene of SHAPES) {
      const ctx = draw({ ...scene, values: [] });
    // The frame is fully painted rather than left transparent, and carries
    // nothing but the backdrop. Asserted as a property rather than a call count:
    // the ground is a black fill plus the brand grid, so counting calls made this
    // test a check on how many grid lines a 1920x1080 frame happens to have.
      expect(texts(ctx)).toHaveLength(0);
      expect(bars(ctx)).toHaveLength(0);
      expect(ctx.calls[0]).toMatchObject({ op: "fillRect", x: 0, y: 0, width: 1920, height: 1080 });
      expect(ctx.calls[0]).toMatchObject({ op: "fillRect", style: CHART_FULL_THEME.background });
    }
  });

  it("survives an all zero chart without dividing by zero", () => {
    for (const scene of SHAPES) {
      const ctx = draw({ ...scene, values: [0, 0] });
      for (const call of ctx.calls) {
        for (const value of Object.values(call)) {
          if (typeof value === "number") expect(Number.isFinite(value)).toBe(true);
        }
      }
    }
  });

  it("skips values that cannot be drawn without breaking the frame", () => {
    const ctx = draw({ ...BARS, values: [80, Number.NaN, 45] });
    expect(bars(ctx)).toHaveLength(2);
  });

  it("renders bare numbers when no unit was spoken", () => {
    expect(texts(draw({ ...BARS, unit: null })).map((c) => c.text)).toContain("80");
    expect(texts(draw({ ...BIG_NUMBER, unit: null })).map((c) => c.text)).toContain("12");
  });
});

describe("entranceProgress", () => {
  it("runs zero to one across the entrance and then holds", () => {
    expect(entranceProgress(0)).toBe(0);
    expect(entranceProgress(-100)).toBe(0);
    expect(entranceProgress(CHART_FULL_THEME.entranceMs)).toBe(1);
    expect(entranceProgress(CHART_FULL_THEME.entranceMs * 10)).toBe(1);
  });

  it("eases out, so it is past halfway at the halfway point", () => {
    expect(entranceProgress(CHART_FULL_THEME.entranceMs / 2)).toBeGreaterThan(0.5);
  });
});

describe("idleDrift", () => {
  it("starts at zero and stays within its stated bound", () => {
    expect(idleDrift(0, 1080)).toBeCloseTo(0, 10);
    const bound = 1080 * CHART_FULL_THEME.idleDriftRatio;
    for (let ms = 0; ms <= 12_000; ms += 250) {
      expect(Math.abs(idleDrift(ms, 1080))).toBeLessThanOrEqual(bound + 1e-9);
    }
  });
});

// ---------------------------------------------------------------------------
// Portrait. This template does not change composition with orientation, but its
// type sizes used to be shares of the frame HEIGHT, which is the long edge in a
// 9:16 frame — so the single big number was set at 0.26 * 1920 = 499px inside a
// 1080px wide frame and simply ran off it.
// ---------------------------------------------------------------------------

const PORTRAIT = { width: 1080, height: 1920, elapsedMs: 5_000 };

describe("chart-full in a portrait frame", () => {
  const sizeOf = (font: string) => Number(font.match(/(\d+(?:\.\d+)?)px/)?.[1]);

  it("keeps the big number inside the frame", () => {
    const scene: ChartFullScene = {
      type: "number",
      title: "Revenue",
      values: [1234],
      labels: [],
      unit: "%",
    };
    const drawn = texts(draw(scene, PORTRAIT));
    const biggest = Math.max(...drawn.map((t) => sizeOf(t.font)));

    // The measure that matters is the drawn glyphs, not the point size: the
    // recorder charges half an em per character, the same rule the wrapping
    // paths are exercised under.
    for (const call of drawn) {
      expect(call.text.length * sizeOf(call.font) * 0.5).toBeLessThanOrEqual(1080);
    }
    expect(biggest).toBeCloseTo(1080 * CHART_FULL_THEME.bigNumberSizeRatio, 0);
  });

  it("sizes type off the short edge in both orientations", () => {
    const scene: ChartFullScene = {
      type: "bar",
      title: "Quarterly",
      values: [3, 5, 9],
      labels: ["Q1", "Q2", "Q3"],
      unit: null,
    };
    const titleIn = (frame: typeof FRAME) => sizeOf(texts(draw(scene, frame))[0].font);

    // 1920x1080 and 1080x1920 share a short edge, so the type is identical and
    // only the composition differs. That is the whole point of the change.
    expect(titleIn(PORTRAIT)).toBeCloseTo(titleIn(FRAME), 0);
  });
});
