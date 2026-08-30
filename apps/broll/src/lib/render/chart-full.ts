import { formatChartParts, formatChartValue } from "./chart-label";
import type { Render2DContext } from "./context";
import { typeScale, wrapText } from "./layout";
import { easeOutCubic, entranceAt, staggerDelayMs } from "./motion";
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
  /**
   * Bar corner rounding: a share of the bar's own width, capped so one wide bar
   * does not turn into a lozenge. Rounded at the top, square where it meets the
   * baseline — a bar rounded at both ends stops looking like it stands on zero.
   */
  barCornerRatio: 0.35,
  /** The cap, as a share of the short edge: 12px at 1080. */
  barCornerMaxRatio: 12 / 1080,
  /**
   * The rule the marks stand on, and the only horizontal line in the frame.
   *
   * **There are deliberately no value gridlines.** The 40px backdrop grid is
   * decorative and lines up with no value, so value lines drawn over it would
   * imply the backdrop meant something. One grid in a frame is the most a
   * viewer can read.
   */
  baseline: BRAND.surfaceAlt,
  /** Baseline thickness as a share of the short edge, floored at a pixel. */
  baselineThicknessRatio: 2 / 1080,
  /** A line chart's dot radius, as a multiple of the line's own width. */
  dotRadiusRatio: 1.8,
  /** How much of the donut's radius is hole. */
  donutInnerRatio: 0.58,
  /** The gap between slices, in degrees. Separation without distorting a share. */
  donutSliceGapDegrees: 1.5,
  /** The figure in the hole, as a share of the hole's own diameter. */
  donutHoleTextRatio: 0.3,
  /** A big number's unit, as a share of the number's size. */
  unitSizeRatio: 0.42,
  /** How many lines a title may wrap to before it is trimmed. */
  titleMaxLines: 2,
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
  // A bar rounded at the top and square at the baseline, in one call.
  | "roundRect"
  | "globalAlpha"
  // Wrapping a title, and setting a unit beside a number it has to measure.
  | "measureText"
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
  /** Time since the scene started, for anything that staggers per mark. */
  elapsedMs: number;
  /**
   * How many lines the title wraps to, 0 to `titleMaxLines`.
   *
   * Carried on the layout rather than recomputed where it is needed, because
   * measuring text means setting the font, and a plot area that measured with
   * whatever font happened to be set would move depending on what drew last.
   */
  titleLineCount: number;
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

  const margin = Math.min(width, height) * theme.marginRatio;
  const scale = typeScale(frame);

  const layout: Layout = {
    width,
    height,
    margin,
    scale,
    grown: entranceProgress(elapsedMs),
    elapsedMs,
    titleLineCount: countTitleLines(ctx, scene.title, width - margin * 2, scale),
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

/**
 * The heading, top left, for every shape except the single big number.
 *
 * **Wrapped to two lines and trimmed past that**, because a planner writes a
 * title from the speaker's framing and has no idea how wide the frame is. A
 * long one used to be drawn as a single `fillText` that ran straight off the
 * right edge — a live bug rather than a matter of taste, and invisible until
 * someone rendered a scene whose title happened to be long.
 */
function drawTitle(ctx: Chart2DContext, title: string, layout: Layout): void {
  const theme = CHART_FULL_THEME;
  const size = layout.scale * theme.titleSizeRatio;

  ctx.fillStyle = theme.title;
  ctx.font = `600 ${size}px ${TYPEFACE}`;
  ctx.textAlign = "left";
  ctx.textBaseline = "top";

  const maxWidth = layout.width - layout.margin * 2;
  const lines = titleLines(ctx, title, maxWidth);

  lines.forEach((line, index) => {
    ctx.fillText(line, layout.margin, layout.margin + index * size * TITLE_LINE_HEIGHT);
  });
}

/** Line height of a wrapped title, as a multiple of its type size. */
const TITLE_LINE_HEIGHT = 1.2;

/**
 * How many lines the title takes, measured in the font it will be drawn in.
 *
 * Sets the font before measuring and is called before any mark is drawn, so
 * the answer never depends on what the context happened to be set to.
 */
function countTitleLines(
  ctx: Chart2DContext,
  title: string,
  maxWidth: number,
  scale: number
): number {
  ctx.font = `600 ${scale * CHART_FULL_THEME.titleSizeRatio}px ${TYPEFACE}`;
  return titleLines(ctx, title, maxWidth).length;
}

/**
 * A title as the lines it will actually be drawn on.
 *
 * Exported so the plot area can be measured against the title that will be
 * drawn rather than against an assumed one line. A two line title that pushed
 * the marks down without the plot knowing would overlap them.
 */
export function titleLines(
  ctx: Pick<Chart2DContext, "measureText">,
  title: string,
  maxWidth: number
): string[] {
  const theme = CHART_FULL_THEME;
  const text = title.trim();
  if (text === "") return [];

  const wrapped = wrapText(ctx, text, maxWidth);
  if (wrapped.length <= theme.titleMaxLines) return wrapped;

  // Past the limit the last kept line absorbs an ellipsis, and words are
  // dropped from it until the ellipsis fits too. Trimming without re-measuring
  // is how an ellipsis ends up hanging off the edge it was added to prevent.
  const kept = wrapped.slice(0, theme.titleMaxLines);
  let last = kept[kept.length - 1];

  while (last.length > 0 && ctx.measureText(`${last}…`).width > maxWidth) {
    const words = last.split(" ");
    if (words.length === 1) {
      last = last.slice(0, -1);
      continue;
    }
    words.pop();
    last = words.join(" ");
  }

  kept[kept.length - 1] = `${last}…`;
  return kept;
}

/**
 * The rule the marks stand on.
 *
 * One hairline, so a bar stands on something and zero is visible. Drawn as a
 * thin rect rather than a stroked path for the same reason the grid is: a
 * stroke centres on its coordinate and lands on a half pixel.
 */
function drawBaseline(ctx: Chart2DContext, layout: Layout, y: number): void {
  const theme = CHART_FULL_THEME;
  const thickness = Math.max(1, layout.scale * theme.baselineThicknessRatio);
  ctx.fillStyle = theme.baseline;
  ctx.fillRect(layout.margin, Math.round(y), layout.width - layout.margin * 2, thickness);
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

  // **The number and its unit are drawn separately**, so the unit can be set
  // smaller and in the muted tone while the figure carries the frame. Where the
  // unit sits relative to the number is still decided in one place, by
  // `formatChartParts`, rather than being worked out a second time here.
  const parts = formatChartParts(shown, scene.unit);
  const unitSize = numberSize * theme.unitSizeRatio;

  ctx.textAlign = "left";
  ctx.textBaseline = "middle";

  ctx.font = `700 ${numberSize}px ${TYPEFACE}`;
  const numberWidth = ctx.measureText(parts.number).width;
  ctx.font = `500 ${unitSize}px ${BODY_TYPEFACE}`;
  // A word unit takes a space on either side of the join; a symbol hugs.
  const spacing = parts.unit.length > 1 ? unitSize * 0.35 : 0;
  const unitWidth = parts.unit === "" ? 0 : ctx.measureText(parts.unit).width + spacing;

  // Centre the pair, not the number, or a long unit pushes the figure off axis.
  const totalWidth = numberWidth + unitWidth;
  let cursor = centerX - totalWidth / 2;

  if (parts.where === "prefix" && parts.unit !== "") {
    ctx.fillStyle = theme.categoryLabel;
    ctx.font = `500 ${unitSize}px ${BODY_TYPEFACE}`;
    ctx.fillText(parts.unit, cursor, centerY);
    cursor += unitWidth;
  }

  ctx.fillStyle = theme.valueLabel;
  ctx.font = `700 ${numberSize}px ${TYPEFACE}`;
  ctx.fillText(parts.number, cursor, centerY);
  cursor += numberWidth;

  if (parts.where === "suffix" && parts.unit !== "") {
    ctx.fillStyle = theme.categoryLabel;
    ctx.font = `500 ${unitSize}px ${BODY_TYPEFACE}`;
    ctx.fillText(parts.unit, cursor + spacing, centerY);
  }

  ctx.textAlign = "center";
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
  // Measured against the lines the title will actually occupy, so a two line
  // title pushes the marks down instead of being drawn over them.
  const titleHeight = titleSize * (0.8 + TITLE_LINE_HEIGHT * layout.titleLineCount);
  const top = layout.margin + titleHeight;
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

  // The rule the bars stand on, drawn before them so a bar's square foot sits
  // on the line rather than the line cutting across it.
  drawBaseline(ctx, layout, plot.bottom);

  // Rounded at the top, square at the baseline. A share of the bar's own width
  // so it reads as rounded at any bar count, capped so one wide bar does not
  // become a lozenge, and never more than half the bar's height or the corners
  // would meet and swallow a short bar whole.
  const corner = Math.min(
    barWidth * theme.barCornerRatio,
    layout.scale * theme.barCornerMaxRatio
  );

  values.forEach((value, index) => {
    const ratio = peak === 0 ? 0 : Math.abs(value) / peak;
    // Leave room above the tallest bar for its value label.
    const fullHeight = plot.height * ratio * 0.86;

    // **Arrivals are staggered in array order, which is spoken order.** Never
    // sorted by size: the sequence a viewer watches is the sequence the speaker
    // said, and reordering it would be the chart telling a story of its own.
    const arrived = barArrival(layout.elapsedMs, index);
    const barHeight = fullHeight * arrived;
    const x = layout.margin + slot * index + gap / 2;
    const y = plot.bottom - barHeight;

    if (barHeight > 0) {
      ctx.fillStyle = value < 0 ? theme.barMuted : theme.bar;
      ctx.beginPath();
      const radius = Math.min(corner, barHeight / 2);
      ctx.roundRect(x, y, barWidth, barHeight, [radius, radius, 0, 0]);
      ctx.fill();
    }

    // The label fades with its own bar rather than with the chart, or a number
    // hangs in the air above a bar that has not arrived yet.
    if (arrived <= 0) return;
    ctx.save();
    ctx.globalAlpha = arrived;

    // The value label, with its unit. This is AC-34 reaching the pixels: the
    // number is never drawn without the unit the speaker attached to it.
    ctx.fillStyle = theme.valueLabel;
    ctx.font = `600 ${valueSize}px ${TYPEFACE}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    ctx.fillText(formatChartValue(value, scene.unit), x + barWidth / 2, y - valueSize * 0.25);

    drawCategory(ctx, scene.labels[index], x + barWidth / 2, plot.bottom, plot.categorySize);
    ctx.restore();
  });
}

/**
 * How far the bar at `index` has arrived at `elapsedMs`.
 *
 * Worked out from elapsed time rather than from the chart's overall progress,
 * because that progress is already eased: staggering it would ease an eased
 * value and the gap between bars would stretch and compress along the curve
 * rather than staying the 70ms the motion module states.
 *
 * The last bar of a five bar chart finishes 280ms after the first, well inside
 * the planner's four second floor, so a staggered chart still settles long
 * before its clip ends.
 *
 * Exported because "bars arrive in order, and all of them arrive" is a property
 * worth asserting directly rather than inferring from drawn heights.
 */
export function barArrival(elapsedMs: number, index: number): number {
  if (!Number.isFinite(elapsedMs) || elapsedMs <= 0) return 0;
  return entranceAt(elapsedMs, staggerDelayMs(index), CHART_FULL_THEME.entranceMs);
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

  drawBaseline(ctx, layout, plot.bottom);

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

  // A dot at each measured value, and **only** at measured values. Straight
  // segments between them with no smoothing: a curve drawn through measured
  // points asserts values between them that nobody measured, which on a chart
  // built from someone's spoken claim is a number the app invented.
  const dotRadius = ctx.lineWidth * theme.dotRadiusRatio;
  values.forEach((value, index) => {
    if (index > reach) return;
    const point = pointAt(index);

    ctx.fillStyle = theme.bar;
    ctx.beginPath();
    ctx.arc(point.x, point.y, dotRadius, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = theme.valueLabel;
    ctx.font = `600 ${valueSize}px ${TYPEFACE}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    ctx.fillText(
      formatChartValue(value, scene.unit),
      point.x,
      point.y - valueSize * 0.4 - dotRadius
    );
    drawCategory(ctx, scene.labels[index], point.x, plot.bottom, plot.categorySize);
  });
}

/**
 * Shares of a whole as a **donut**, sweeping in clockwise from twelve o'clock.
 *
 * Negative values are drawn by magnitude: a share of a whole has no meaningful
 * negative, and dropping the slice would silently lose a number the speaker
 * said.
 *
 * **The hole carries the largest traced value, never a total.** Summing the
 * values produces a figure the speaker never said, and putting an invented
 * number in the largest type on the frame is exactly what the honesty check
 * exists to prevent. `Math.max` over the values is a number that was actually
 * spoken; `reduce((a, b) => a + b)` is not, however natural it looks in a hole.
 *
 * This is a rewrite rather than a restyle: wedges from the centre outward
 * became an annulus with angular gaps, which is different geometry rather than
 * different colour.
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
  const innerRadius = radius * theme.donutInnerRatio;
  const centerX = layout.width / 2;
  const centerY = plot.top + plot.height / 2;
  const valueSize = layout.scale * theme.valueSizeRatio;

  // Start at twelve o'clock: canvas angles start at three o'clock.
  let angle = -Math.PI / 2;
  const sweep = Math.PI * 2 * layout.grown;
  const gap = (theme.donutSliceGapDegrees * Math.PI) / 180;

  magnitudes.forEach((magnitude, index) => {
    const share = total === 0 ? 0 : magnitude / total;
    const slice = sweep * share;
    if (slice <= 0) return;

    // Half the gap is taken off each end, so the separation between two slices
    // is one gap rather than two. A slice narrower than its own gap keeps a
    // sliver instead of inverting into a negative sweep.
    const inset = Math.min(gap / 2, slice / 3);
    const from = angle + inset;
    const to = angle + slice - inset;

    ctx.fillStyle = theme.slices[index % theme.slices.length];
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius, from, to);
    // Back along the inner edge to close the annulus. Drawn as a second arc
    // rather than a straight line so the hole stays round at every slice.
    ctx.arc(centerX, centerY, innerRadius, to, from, true);
    ctx.closePath();
    ctx.fill();

    angle += slice;
  });

  drawDonutHole(ctx, scene, values, { centerX, centerY, innerRadius }, layout);

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

/**
 * The figure set in the donut's hole.
 *
 * **`Math.max`, never a sum.** See `drawPie`. This is the one place in the
 * renderer where the obvious arithmetic would put a number on screen that
 * nobody said, so the rule is stated at both ends.
 *
 * Sized to the **hole** rather than to the frame: it has to fit inside 0.58 of
 * the radius, so it cannot reuse the big number's frame relative ratio.
 */
function drawDonutHole(
  ctx: Chart2DContext,
  scene: ChartFullScene,
  values: number[],
  hole: { centerX: number; centerY: number; innerRadius: number },
  layout: Layout
): void {
  const theme = CHART_FULL_THEME;
  if (values.length === 0 || hole.innerRadius <= 0) return;

  const largest = Math.max(...values);
  const label = formatChartValue(largest * layout.grown, scene.unit);
  if (label === "") return;

  const diameter = hole.innerRadius * 2;
  let size = diameter * theme.donutHoleTextRatio;

  // Step down until it fits the hole it is sitting in. A long label with a word
  // unit is what overflows here, and a number spilling over the ring reads as
  // broken rather than as emphasis.
  const maxWidth = diameter * 0.82;
  for (let step = 0; step < 8; step += 1) {
    ctx.font = `700 ${size}px ${TYPEFACE}`;
    if (ctx.measureText(label).width <= maxWidth) break;
    size *= 0.9;
  }

  ctx.fillStyle = theme.valueLabel;
  ctx.font = `700 ${size}px ${TYPEFACE}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label, hole.centerX, hole.centerY);
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
