import { formatChartValue } from "./chart-label";

/**
 * The `chart-full` template: the chart fills the frame (`design-prompt.md`).
 * Motion is part of the template, not decoration: bars grow from zero on
 * entrance, then hold with a slow idle drift.
 *
 * Drawing is a **pure function of time**. Given the same chart and the same
 * `elapsedMs` it emits the same pixels, with no internal animation state. That
 * is what lets the encoder render frame N without having rendered N-1, and it
 * is why this file can be tested at all: the tests pass a recording context and
 * assert on the calls, with no canvas and no browser.
 *
 * **The visual design here is deliberately plain and is not specified
 * anywhere.** `design-prompt.md` gives one line, "chart fills frame", and Phase
 * 0's rationale defers aesthetic judgment to a real timeline. So this is a
 * legible default chosen to be easy to replace, not a design decision anyone
 * has ratified. Everything visual lives in `CHART_FULL_THEME` for that reason.
 */

/** Every visual constant in one object, so restyling touches nothing else. */
export const CHART_FULL_THEME = {
  background: "#0b0f19",
  bar: "#5b8cff",
  barMuted: "#2a3a63",
  title: "#f4f6fb",
  valueLabel: "#f4f6fb",
  categoryLabel: "#94a3c4",
  /** Fraction of the frame's shorter edge used as the outer margin. */
  marginRatio: 0.08,
  /** Fraction of a bar slot taken by the gap between bars. */
  barGapRatio: 0.28,
  titleSizeRatio: 0.062,
  valueSizeRatio: 0.044,
  categorySizeRatio: 0.034,
  /** How long the bars take to grow in, in milliseconds. */
  entranceMs: 600,
  /** How far the whole chart drifts vertically, as a fraction of frame height. */
  idleDriftRatio: 0.006,
  /** One full drift cycle, in milliseconds. */
  idleDriftPeriodMs: 6000,
} as const;

/**
 * The subset of a 2D context this renderer uses. Keeps the tests honest, and
 * has to stay assignable **from** the real `OffscreenCanvasRenderingContext2D`,
 * which is why `fillStyle` carries the full union even though this file only
 * ever assigns strings to it.
 */
export interface Chart2DContext {
  fillStyle: string | CanvasGradient | CanvasPattern;
  font: string;
  textAlign: CanvasTextAlign;
  textBaseline: CanvasTextBaseline;
  save(): void;
  restore(): void;
  translate(x: number, y: number): void;
  fillRect(x: number, y: number, width: number, height: number): void;
  fillText(text: string, x: number, y: number): void;
}

export interface ChartFullScene {
  /** The chart's own title, from the speaker's framing. */
  title: string;
  values: number[];
  /** One label per value, in the same order. May be empty. */
  labels: string[];
  /** The unit as spoken, or null when the line stated none. */
  unit: string | null;
}

/** Ease out cubic: fast start, settled finish. Bars land rather than snap. */
function easeOutCubic(t: number): number {
  const clamped = Math.min(1, Math.max(0, t));
  return 1 - (1 - clamped) ** 3;
}

/**
 * How grown the bars are at `elapsedMs`, from 0 to 1. Exported because the
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
  ctx.fillStyle = theme.background;
  ctx.fillRect(0, 0, width, height);

  const drawable = scene.values.filter((value) => Number.isFinite(value));
  if (drawable.length === 0) {
    // Nothing to plot. The painted background is still a valid frame, which
    // matters: a scene that loses its chart must not produce a broken file.
    return;
  }

  ctx.save();
  ctx.translate(0, idleDrift(elapsedMs, height));

  const margin = Math.min(width, height) * theme.marginRatio;
  const titleSize = height * theme.titleSizeRatio;
  const valueSize = height * theme.valueSizeRatio;
  const categorySize = height * theme.categorySizeRatio;

  ctx.fillStyle = theme.title;
  ctx.font = `600 ${titleSize}px sans-serif`;
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillText(scene.title, margin, margin);

  // The plot sits below the title and above the category labels.
  const plotTop = margin + titleSize * 1.8;
  const plotBottom = height - margin - categorySize * 1.6;
  const plotHeight = Math.max(0, plotBottom - plotTop);
  const plotWidth = width - margin * 2;

  const slot = plotWidth / drawable.length;
  const gap = slot * theme.barGapRatio;
  const barWidth = Math.max(1, slot - gap);

  // Bars are scaled against the largest value, and against zero rather than
  // the smallest, so a bar's height stays proportional to the claim. Baselining
  // at the minimum would visually exaggerate small differences, which on a
  // chart carrying someone's spoken statistic is its own kind of fabrication.
  const peak = Math.max(...drawable.map((value) => Math.abs(value)));
  const grown = entranceProgress(elapsedMs);

  drawable.forEach((value, index) => {
    const ratio = peak === 0 ? 0 : Math.abs(value) / peak;
    // Leave room above the tallest bar for its value label.
    const fullHeight = plotHeight * ratio * 0.86;
    const barHeight = fullHeight * grown;
    const x = margin + slot * index + gap / 2;
    const y = plotBottom - barHeight;

    ctx.fillStyle = value < 0 ? theme.barMuted : theme.bar;
    ctx.fillRect(x, y, barWidth, barHeight);

    // The value label, with its unit. This is AC-34 reaching the pixels: the
    // number is never drawn without the unit the speaker attached to it.
    ctx.fillStyle = theme.valueLabel;
    ctx.font = `600 ${valueSize}px sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    ctx.fillText(formatChartValue(value, scene.unit), x + barWidth / 2, y - valueSize * 0.25);

    const label = scene.labels[index];
    if (label) {
      ctx.fillStyle = theme.categoryLabel;
      ctx.font = `400 ${categorySize}px sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.fillText(label, x + barWidth / 2, plotBottom + categorySize * 0.5);
    }
  });

  ctx.restore();
}
