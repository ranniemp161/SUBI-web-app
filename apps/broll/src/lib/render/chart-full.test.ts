import { describe, expect, it } from "vitest";
import {
  CHART_FULL_THEME,
  drawChartFullFrame,
  entranceProgress,
  idleDrift,
  type Chart2DContext,
  type ChartFullScene,
} from "./chart-full";

type Call =
  | { op: "fillRect"; x: number; y: number; width: number; height: number; style: string }
  | { op: "fillText"; text: string; x: number; y: number; style: string };

/** Records what was drawn, so the renderer can be asserted without a canvas. */
function recorder() {
  const calls: Call[] = [];
  const ctx: Chart2DContext & { calls: Call[] } = {
    calls,
    fillStyle: "",
    font: "",
    textAlign: "left",
    textBaseline: "top",
    save() {},
    restore() {},
    translate() {},
    fillRect(x, y, width, height) {
      // The renderer only ever assigns strings, so this is exact, not lossy.
      calls.push({ op: "fillRect", x, y, width, height, style: String(this.fillStyle) });
    },
    fillText(text, x, y) {
      calls.push({ op: "fillText", text, x, y, style: String(this.fillStyle) });
    },
  };
  return ctx;
}

const SCENE: ChartFullScene = {
  title: "Support collapsed",
  values: [80, 45],
  labels: ["Before", "After"],
  unit: "%",
};

const FRAME = { width: 1920, height: 1080, elapsedMs: 5_000 };

const bars = (ctx: ReturnType<typeof recorder>) =>
  ctx.calls.filter(
    (c): c is Extract<Call, { op: "fillRect" }> =>
      c.op === "fillRect" && c.style === CHART_FULL_THEME.bar
  );

const texts = (ctx: ReturnType<typeof recorder>) =>
  ctx.calls.filter((c): c is Extract<Call, { op: "fillText" }> => c.op === "fillText");

describe("drawChartFullFrame", () => {
  it("draws every value's label with its unit (AC-34, at the pixels)", () => {
    const ctx = recorder();
    drawChartFullFrame(ctx, SCENE, FRAME);
    const drawn = texts(ctx).map((c) => c.text);
    expect(drawn).toContain("80%");
    expect(drawn).toContain("45%");
    // The bare number must never be what lands on screen.
    expect(drawn).not.toContain("80");
    expect(drawn).not.toContain("45");
  });

  it("paints the full frame background before anything else", () => {
    // The encoder reuses one canvas, so a frame that does not repaint would
    // inherit the previous frame's pixels.
    const ctx = recorder();
    drawChartFullFrame(ctx, SCENE, FRAME);
    const first = ctx.calls[0];
    expect(first).toMatchObject({
      op: "fillRect",
      x: 0,
      y: 0,
      width: 1920,
      height: 1080,
      style: CHART_FULL_THEME.background,
    });
  });

  it("draws the title and the category labels", () => {
    const ctx = recorder();
    drawChartFullFrame(ctx, SCENE, FRAME);
    const drawn = texts(ctx).map((c) => c.text);
    expect(drawn).toContain("Support collapsed");
    expect(drawn).toContain("Before");
    expect(drawn).toContain("After");
  });

  it("grows bars from zero, which is the template's specified entrance", () => {
    const atStart = recorder();
    drawChartFullFrame(atStart, SCENE, { ...FRAME, elapsedMs: 0 });
    for (const bar of bars(atStart)) expect(bar.height).toBe(0);

    const midway = recorder();
    drawChartFullFrame(midway, SCENE, { ...FRAME, elapsedMs: 200 });
    const settled = recorder();
    drawChartFullFrame(settled, SCENE, { ...FRAME, elapsedMs: 5_000 });

    expect(bars(midway)[0].height).toBeGreaterThan(0);
    expect(bars(midway)[0].height).toBeLessThan(bars(settled)[0].height);
  });

  it("keeps bar heights proportional to the values, baselined at zero", () => {
    // 45 against 80 must read as 45/80. Baselining at the smallest value would
    // exaggerate the gap, which on a spoken statistic is its own fabrication.
    const ctx = recorder();
    drawChartFullFrame(ctx, SCENE, FRAME);
    const [tall, short] = bars(ctx);
    expect(short.height / tall.height).toBeCloseTo(45 / 80, 5);
  });

  it("is a pure function of time: same inputs, same pixels", () => {
    const a = recorder();
    const b = recorder();
    drawChartFullFrame(a, SCENE, FRAME);
    drawChartFullFrame(b, SCENE, FRAME);
    expect(a.calls).toEqual(b.calls);
  });

  it("still paints a valid frame when the chart has nothing to plot", () => {
    // A scene whose chart was nulled by the honesty check must not produce a
    // broken file; it produces a plain frame.
    const ctx = recorder();
    drawChartFullFrame(ctx, { ...SCENE, values: [] }, FRAME);
    expect(ctx.calls).toHaveLength(1);
    expect(ctx.calls[0]).toMatchObject({ op: "fillRect", style: CHART_FULL_THEME.background });
  });

  it("skips values that cannot be drawn without breaking the frame", () => {
    const ctx = recorder();
    drawChartFullFrame(ctx, { ...SCENE, values: [80, Number.NaN, 45] }, FRAME);
    expect(bars(ctx)).toHaveLength(2);
  });

  it("survives an all zero chart without dividing by zero", () => {
    const ctx = recorder();
    drawChartFullFrame(ctx, { ...SCENE, values: [0, 0] }, FRAME);
    for (const bar of bars(ctx)) expect(Number.isFinite(bar.height)).toBe(true);
  });

  it("renders bare numbers when no unit was spoken", () => {
    const ctx = recorder();
    drawChartFullFrame(ctx, { ...SCENE, unit: null }, FRAME);
    expect(texts(ctx).map((c) => c.text)).toContain("80");
  });

  it("keeps every bar inside the frame", () => {
    const ctx = recorder();
    drawChartFullFrame(ctx, SCENE, FRAME);
    for (const bar of bars(ctx)) {
      expect(bar.x).toBeGreaterThanOrEqual(0);
      expect(bar.x + bar.width).toBeLessThanOrEqual(1920);
      expect(bar.y).toBeGreaterThanOrEqual(0);
    }
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
