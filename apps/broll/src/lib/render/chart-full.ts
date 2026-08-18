import { formatChartValue } from "./chart-label";
import type { Render2DContext } from "./context";
import { typeScale } from "./layout";
import { easeOutCubic } from "./motion";
import { BODY_TYPEFACE, BRAND, SERIES, TYPEFACE, drawBackdrop } from "./theme";

/**
 * The `chart-full` template: the chart fills the frame (`design-prompt.md`).
 * Motion is part of the template, not decoration: the figure grows in from
 * nothing on entrance, then holds with a slow idle drift.
 *
 * Drawing is a **pure function of time**. Given the same chart and the same
 * `elapsedMs` it emits the same pixels, with no internal animation state. That
 * is what lets the encoder render frame N without having rendered N-1, and it
 * is why this file can be tested at all: the tests pass a recording context and
 * assert on the calls, with no canvas and no browser.
 *
 * **The chart's `type` decides the shape.** The planner may emit `bar`, `line`,
 * `pie`, or a single big number, and picks whatever the spoken claim actually
 * is. A single statistic drawn as a one bar bar chart is wrong, so each shape
 * has its own drawing. An unrecognized type falls back by value count rather
 * than drawing nothing: one value is a number, several are bars.
 *
 * **The visual design here is deliberately plain and is not specified
 * anywhere.** `design-prompt.md` gives one line, "chart fills frame", and Phase
 * 0's rationale defers aesthetic judgment to a real timeline. So this is a
 * legible default chosen to be easy to replace, not a design decision anyone
 * has ratified. Everything visual lives in `CHART_FULL_THEME` for that reason.
 */

/** Every visual constant in one object, so restyling touches nothing else. */
export const CHART_FULL_THEME = {
  background: BRAND.background,
  /** The figure is Key Yellow: it is the one thing on screen worth looking at. */
  bar: BRAND.accent,
  /** The unfilled remainder of a bar — a divider tone, not a second series. */
  barMuted: BRAND.surfaceAlt,
  title: BRAND.foreground,
  valueLabel: BRAND.foreground,
  categoryLabel: BRAND.muted,
  /** The palette pie slices cycle through, in order. See `SERIES`. */
  slices: SERIES,
  /** Fraction of the frame's shorter edge used as the outer margin. */
  marginRatio: 0.08,
  /** Fraction of a bar slot taken by the gap between bars. */
  barGapRatio: 0.28,
  titleSizeRatio: 0.062,
  valueSizeRatio: 0.044,
  categorySizeRatio: 0.034,
  /** The single big number is the whole frame, so it is sized like one. */
  bigNumberSizeRatio: 0.26,
  bigNumberCaptionRatio: 0.055,
  lineWidthRatio: 0.008,
  /** How long the figure takes to grow in, in milliseconds. */
  entranceMs: 600,
  /** How far the whole chart drifts vertically, as a fraction of frame height. */
  idleDriftRatio: 0.006,
  /** One full drift cycle, in milliseconds. */
  idleDriftPeriodMs: 6000,
} as const;

/**
 * Exactly what this template draws with, picked out of the shared surface.
 *
 * Derived rather than declared so there is one definition of the canvas across
 * every template, while this one still asks for nothing it does not use: it
 * draws no images and needs no clipping, so a caller is not made to supply
 * them.
 */
export type Chart2DContext = Pick<
  Render2DContext,
  | "fillStyle"
  | "strokeStyle"
  | "lineWidth"
  | "lineJoin"
  | "lineCap"
  | "font"
  | "textAlign"
  | "textBaseline"
  | "save"
  | "restore"
  | "translate"
  | "beginPath"
  | "closePath"
  | "moveTo"
  | "lineTo"
  | "arc"
  | "fill"
  | "stroke"
  | "fillRect"
  | "fillText"
  // Not drawn with directly: `drawBackdrop` fades the grid toward the frame
  // edges through one radial gradient, and this template opens with it.
  | "createRadialGradient"
>;

/** The shapes the planner may ask for. */
export type ChartShape = "number" | "bar" | "line" | "pie";

export interface ChartFullScene {
  /**
   * How to draw it, as the planner wrote it: `bar`, `line`, `pie`, or wording
   * meaning a single big number. Optional because a chart that predates this
   * field still has to render; see `resolveChartShape` for the fallback.
   */
  type?: string | null;
  /** The chart's own title, from the speaker's framing. */
  title: string;
  values: number[];
  /** One label per value, in the same order. May be empty. */
  labels: string[];
  /** The unit as spoken, or null when the line stated none. */
  unit: string | null;
}

/**
 * Which shape to draw.
 *
 * The planner is told to write lowercase `bar`, `line`, `pie`, or a single big
 * number, but it writes prose, so "single big number" and "big number" and
 * "stat" all have to land on the same shape. Anything unrecognized falls back
 * by value count: one value cannot be a bar chart worth looking at, and several
 * values have to be something, so bars.
 */
export function resolveChartShape(type: string | null | undefined, valueCount: number): ChartShape {
  const key = (type ?? "").trim().toLowerCase();

  if (key.includes("pie") || key.includes("donut") || key.includes("doughnut")) return "pie";
  if (key.includes("line") || key.includes("trend")) return "line";
  if (key.includes("bar") || key.includes("column")) return "bar";
  if (key.includes("number") || key.includes("stat") || key.includes("figure")) return "number";

  return valueCount <= 1 ? "number" : "bar";
}

/**
 * How grown the figure is at `elapsedMs`, from 0 to 1. Exported because the
 * entrance timing is a property worth asserting directly.
 */
export function entranceProgress(elapsedMs: number): number {
  if (!Number.isFinite(elapsedMs) || elapsedMs <= 0) return 0;
  return easeOutCubic(elapsedMs / CHART_FULL_THEME.entranceMs);
}

/** Vertical idle drift in pixels at `elapsedMs`, for a frame `height` tall. */
export function idleDrift(elapsedMs: number, height: number): number {
  if (!Number.isFinite(elapsedMs)) return 0;
  const phase = (elapsedMs / CHART_FULL_THEME.idleDriftPeriodMs) * Math.PI * 2;
  return Math.sin(phase) * height * CHART_FULL_THEME.idleDriftRatio;
}

interface Layout {
  width: number;
  height: number;
  margin: number;
  /**
   * The frame's short edge, which every type size and stroke width is measured
   * against. Equal to `height` in landscape, so nothing about 1920x1080 output
   * changed when this was introduced; in a 9:16 frame it is the width, and
   * without it `bigNumberSizeRatio` (0.26) sets a 499px number in a 1080px
   * frame, which is not a layout problem but a number running off the screen.
   */
  scale: number;
  grown: number;
}

/**
 * Draws one frame of the `chart-full` template.
 *
 * `elapsedMs` is time since the scene started, not absolute timeline time, so
 * a scene's motion is identical wherever it sits on the edit.
 */
export function drawChartFullFrame(
  ctx: Chart2DContext,
  scene: ChartFullScene,
  frame: { width: number; height: number; elapsedMs: number }
): void {
  const { width, height, elapsedMs } = frame;
  const theme = CHART_FULL_THEME;

  // Background first, every frame: the encoder gets a fully painted frame and
  // never inherits whatever the previous one left behind.
  drawBackdrop(ctx, frame);

  const values = scene.values.filter((value) => Number.isFinite(value));
  if (values.length === 0) {
    // Nothing to plot. The painted background is still a valid frame, which
    // matters: a scene that loses its chart must not produce a broken file.
    return;
  }

  ctx.save();
  ctx.translate(0, idleDrift(elapsedMs, height));

  const layout: Layout = {
    width,
    height,
    margin: Math.min(width, height) * theme.marginRatio,
    scale: typeScale(frame),
    grown: entranceProgress(elapsedMs),
  };

  const shape = resolveChartShape(scene.type, values.length);

  if (shape === "number") {
    drawBigNumber(ctx, scene, values, layout);
  } else {
    drawTitle(ctx, scene.title, layout);
    if (shape === "pie") drawPie(ctx, scene, values, layout);
    else if (shape === "line") drawLine(ctx, scene, values, layout);
    else drawBars(ctx, scene, values, layout);
  }

  ctx.restore();
}

/** The heading, top left, for every shape except the single big number. */
function drawTitle(ctx: Chart2DContext, title: string, layout: Layout): void {
  const size = layout.scale * CHART_FULL_THEME.titleSizeRatio;
  ctx.fillStyle = CHART_FULL_THEME.title;
  ctx.font = `600 ${size}px ${TYPEFACE}`;
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillText(title, layout.margin, layout.margin);
}

/**
 * One statistic, filling the frame, with its title beneath as a caption.
 *
 * The entrance counts up from zero rather than growing a shape, which is the
 * same idea as a bar growing: the figure arrives rather than appearing. It
 * always lands on the exact value, because `entranceProgress` reaches 1.
 */
function drawBigNumber(
  ctx: Chart2DContext,
  scene: ChartFullScene,
  values: number[],
  layout: Layout
): void {
  const theme = CHART_FULL_THEME;
  const target = values[0];
  const shown = target * layout.grown;

  const numberSize = layout.scale * theme.bigNumberSizeRatio;
  const captionSize = layout.scale * theme.bigNumberCaptionRatio;
  const centerX = layout.width / 2;
  const centerY = layout.height / 2;

  ctx.fillStyle = theme.valueLabel;
  ctx.font = `700 ${numberSize}px ${TYPEFACE}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(formatChartValue(shown, scene.unit), centerX, centerY);

  const caption = scene.labels[0] ?? scene.title;
  ctx.fillStyle = theme.categoryLabel;
  // Body face: the caption supports the number rather than being the claim.
  ctx.font = `400 ${captionSize}px ${BODY_TYPEFACE}`;
  ctx.textBaseline = "top";
  ctx.fillText(caption, centerX, centerY + numberSize * 0.6);
}

/** Plot area shared by the bar and line shapes. */
function plotArea(layout: Layout) {
  const theme = CHART_FULL_THEME;
  const titleSize = layout.scale * theme.titleSizeRatio;
  const categorySize = layout.scale * theme.categorySizeRatio;
  const top = layout.margin + titleSize * 1.8;
  const bottom = layout.height - layout.margin - categorySize * 1.6;
  return {
    top,
    bottom,
    height: Math.max(0, bottom - top),
    width: layout.width - layout.margin * 2,
    categorySize,
  };
}

function drawBars(
  ctx: Chart2DContext,
  scene: ChartFullScene,
  values: number[],
  layout: Layout
): void {
  const theme = CHART_FULL_THEME;
  const plot = plotArea(layout);
  const valueSize = layout.scale * theme.valueSizeRatio;

  const slot = plot.width / values.length;
  const gap = slot * theme.barGapRatio;
  const barWidth = Math.max(1, slot - gap);

  // Bars are scaled against the largest value, and against zero rather than
  // the smallest, so a bar's height stays proportional to the claim. Baselining
  // at the minimum would visually exaggerate small differences, which on a
  // chart carrying someone's spoken statistic is its own kind of fabrication.
  const peak = Math.max(...values.map((value) => Math.abs(value)));

  values.forEach((value, index) => {
    const ratio = peak === 0 ? 0 : Math.abs(value) / peak;
    // Leave room above the tallest bar for its value label.
    const fullHeight = plot.height * ratio * 0.86;
    const barHeight = fullHeight * layout.grown;
    const x = layout.margin + slot * index + gap / 2;
    const y = plot.bottom - barHeight;

    ctx.fillStyle = value < 0 ? theme.barMuted : theme.bar;
    ctx.fillRect(x, y, barWidth, barHeight);

    // The value label, with its unit. This is AC-34 reaching the pixels: the
    // number is never drawn without the unit the speaker attached to it.
    ctx.fillStyle = theme.valueLabel;
    ctx.font = `600 ${valueSize}px ${TYPEFACE}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    ctx.fillText(formatChartValue(value, scene.unit), x + barWidth / 2, y - valueSize * 0.25);

    drawCategory(ctx, scene.labels[index], x + barWidth / 2, plot.bottom, plot.categorySize);
  });
}

/**
 * A trend, revealed left to right.
 *
 * The reveal is the entrance: at progress 0 nothing is drawn, at 1 the whole
 * line is. Points are only labelled once the line has reached them, so a label
 * never floats ahead of the data it belongs to.
 */
function drawLine(
  ctx: Chart2DContext,
  scene: ChartFullScene,
  values: number[],
  layout: Layout
): void {
  const theme = CHART_FULL_THEME;
  const plot = plotArea(layout);
  const valueSize = layout.scale * theme.valueSizeRatio;

  const peak = Math.max(...values.map((value) => Math.abs(value)));
  const step = values.length > 1 ? plot.width / (values.length - 1) : 0;

  const pointAt = (index: number) => {
    const ratio = peak === 0 ? 0 : Math.abs(values[index]) / peak;
    return {
      x: layout.margin + step * index,
      y: plot.bottom - plot.height * ratio * 0.86,
    };
  };

  // How far along the polyline the reveal has travelled, in segments.
  const reach = (values.length - 1) * layout.grown;

  ctx.strokeStyle = theme.bar;
  ctx.lineWidth = Math.max(1, layout.scale * theme.lineWidthRatio);
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.beginPath();
  const first = pointAt(0);
  ctx.moveTo(first.x, first.y);

  for (let index = 1; index < values.length; index += 1) {
    const done = Math.min(1, Math.max(0, reach - (index - 1)));
    if (done <= 0) break;
    const from = pointAt(index - 1);
    const to = pointAt(index);
    ctx.lineTo(from.x + (to.x - from.x) * done, from.y + (to.y - from.y) * done);
    if (done < 1) break;
  }
  ctx.stroke();

  values.forEach((value, index) => {
    if (index > reach) return;
    const point = pointAt(index);
    ctx.fillStyle = theme.valueLabel;
    ctx.font = `600 ${valueSize}px ${TYPEFACE}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    ctx.fillText(formatChartValue(value, scene.unit), point.x, point.y - valueSize * 0.4);
    drawCategory(ctx, scene.labels[index], point.x, plot.bottom, plot.categorySize);
  });
}

/**
 * Shares of a whole, sweeping in clockwise from twelve o'clock.
 *
 * Negative values are drawn by magnitude: a share of a whole has no meaningful
 * negative, and dropping the slice would silently lose a number the speaker
 * said.
 */
function drawPie(
  ctx: Chart2DContext,
  scene: ChartFullScene,
  values: number[],
  layout: Layout
): void {
  const theme = CHART_FULL_THEME;
  const magnitudes = values.map((value) => Math.abs(value));
  const total = magnitudes.reduce((sum, value) => sum + value, 0);

  const plot = plotArea(layout);
  const radius = Math.min(plot.width, plot.height) / 2;
  const centerX = layout.width / 2;
  const centerY = plot.top + plot.height / 2;
  const valueSize = layout.scale * theme.valueSizeRatio;

  // Start at twelve o'clock: canvas angles start at three o'clock.
  let angle = -Math.PI / 2;
  const sweep = Math.PI * 2 * layout.grown;

  magnitudes.forEach((magnitude, index) => {
    const share = total === 0 ? 0 : magnitude / total;
    const slice = sweep * share;
    if (slice <= 0) return;

    ctx.fillStyle = theme.slices[index % theme.slices.length];
    ctx.beginPath();
    ctx.moveTo(centerX, centerY);
    ctx.arc(centerX, centerY, radius, angle, angle + slice);
    ctx.closePath();
    ctx.fill();

    angle += slice;
  });

  // Labels sit outside the circle, at each slice's midpoint, and only once the
  // sweep has passed them.
  let labelAngle = -Math.PI / 2;
  magnitudes.forEach((magnitude, index) => {
    const share = total === 0 ? 0 : magnitude / total;
    const full = Math.PI * 2 * share;
    const mid = labelAngle + full / 2;
    labelAngle += full;
    if (mid > -Math.PI / 2 + sweep) return;

    const labelRadius = radius * 1.12;
    ctx.fillStyle = theme.valueLabel;
    ctx.font = `600 ${valueSize}px ${TYPEFACE}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(
      formatChartValue(values[index], scene.unit),
      centerX + Math.cos(mid) * labelRadius,
      centerY + Math.sin(mid) * labelRadius
    );
  });
}

/** A category label under a data point, when the chart named one. */
function drawCategory(
  ctx: Chart2DContext,
  label: string | undefined,
  x: number,
  baseline: number,
  size: number
): void {
  if (!label) return;
  ctx.fillStyle = CHART_FULL_THEME.categoryLabel;
  // Body face: a category names a mark, it does not carry the claim.
  ctx.font = `400 ${size}px ${BODY_TYPEFACE}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.fillText(label, x, baseline + size * 0.5);
}
