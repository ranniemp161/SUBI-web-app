/**
 * Every curve, duration and delay the renderer moves by.
 *
 * **One module, because there used to be several.** `easeOutCubic` was written
 * out separately in `chart-full.ts`, `text-card.ts` and `figure-frame.ts`, each
 * copy identical and each free to stop being. Motion is the part of a clip a
 * viewer reads as quality or as cheapness, and it is exactly the kind of thing
 * that drifts when it lives in three files: one gets tuned, the others do not,
 * and two templates in the same batch start arriving at different rates.
 *
 * Spec `broll/0009` settles the vocabulary. The numbers below are from its
 * motion table rather than picked here.
 *
 * Nothing in this module touches a canvas. It is arithmetic on elapsed time, so
 * it stays unit testable without a browser and drawing stays a pure function of
 * its inputs and the clock.
 */

/** The timings and distances every template moves by. */
export const MOTION = {
  /**
   * How far a figure travels past its resting place before settling, as a
   * share of its own travel.
   *
   * A figure is the only thing in the frame heavy enough to justify an
   * overshoot. Four percent is enough to read as weight settling and small
   * enough that it never looks bouncy. Chart marks and text do not overshoot:
   * a bar that sprang past its value would be animating a number the speaker
   * never said.
   */
  figureOvershoot: 0.04,
  /**
   * The gap between one bar's arrival and the next.
   *
   * Fast enough that five bars are all in within a third of a second, slow
   * enough that the eye tracks the order they arrive in.
   */
  barStaggerMs: 70,
  /**
   * Total scale the slow push adds across a whole clip.
   *
   * Below the threshold where a viewer notices a zoom, above the threshold
   * where a held frame reads as frozen.
   */
  pushTotal: 0.03,
} as const;

/**
 * The back-out constant that produces `MOTION.figureOvershoot`.
 *
 * The curve below is the standard ease out back, `1 + (c+1)(t-1)³ + c(t-1)²`,
 * whose peak sits `4c³ / (27(c+1)²)` above its resting place. Solving that for
 * four percent gives 1.04, which is the only reason this number is not round.
 * Change `figureOvershoot` and this has to be solved again, which is what the
 * test asserting the actual peak is for.
 */
const OVERSHOOT_C = 1.04;

/** Clamps to 0 to 1, and answers 0 for a time that is not a number. */
function unitTime(t: number): number {
  if (!Number.isFinite(t)) return 0;
  return Math.min(1, Math.max(0, t));
}

/**
 * Ease out cubic: fast start, settled finish. The standard arrival.
 *
 * Everything that is not a figure uses this — chart marks, text, the scrim
 * behind it. It was already the right curve for an arrival; the only thing
 * wrong with it was how many copies of it there were.
 */
export function easeOutCubic(t: number): number {
  const clamped = unitTime(t);
  return 1 - (1 - clamped) ** 3;
}

/**
 * Ease out with a small overshoot, for a figure's travel and nothing else.
 *
 * Returns slightly more than 1 near the end and comes back, which is what makes
 * a cutout look like it has weight. **Never use this for opacity**: a value
 * above 1 assigned to `globalAlpha` is clamped by the canvas, so the overshoot
 * would silently do nothing there while costing a frame of flat alpha. Travel
 * is a position, and a position can go past its mark.
 */
export function easeOutOvershoot(t: number): number {
  const clamped = unitTime(t);
  const u = clamped - 1;
  return 1 + (OVERSHOOT_C + 1) * u ** 3 + OVERSHOOT_C * u ** 2;
}

/**
 * How far something that starts at `delayMs` and runs for `durationMs` has
 * arrived at `elapsedMs`, from 0 to 1.
 *
 * A non-finite time answers 0 rather than throwing: the preview drives this off
 * a clock, and one bad frame should be an unstarted animation, not a dead
 * canvas.
 */
export function entranceAt(elapsedMs: number, delayMs: number, durationMs: number): number {
  if (!Number.isFinite(elapsedMs)) return 0;
  return easeOutCubic((elapsedMs - delayMs) / durationMs);
}

/**
 * The same span, on the overshoot curve, for how far a figure has **moved**.
 *
 * Paired with `entranceAt` rather than replacing it: a figure fades on the
 * clamped curve and travels on this one, so it settles into place without its
 * opacity ever exceeding solid.
 */
export function figureTravelAt(
  elapsedMs: number,
  delayMs: number,
  durationMs: number
): number {
  if (!Number.isFinite(elapsedMs)) return 0;
  return easeOutOvershoot((elapsedMs - delayMs) / durationMs);
}

/**
 * When the mark at `index` starts arriving, in milliseconds after the first.
 *
 * The index is the value's position in the chart's own array, which is the
 * order the speaker said them in. Marks are deliberately never reordered by
 * size: the sequence a viewer watches is the sequence that was spoken.
 */
export function staggerDelayMs(index: number, stepMs: number = MOTION.barStaggerMs): number {
  if (!Number.isFinite(index) || index <= 0) return 0;
  return index * stepMs;
}

/**
 * The scale the whole frame is drawn at, at `elapsedMs` of a clip `durationMs`
 * long.
 *
 * **Linear, and normalised to the clip's length.** A held shot pushes at a
 * constant rate; easing it would draw attention to the move itself. Normalising
 * means a four second clip and a ten second one both finish at the same scale
 * rather than the long one pushing further, so a batch of clips cut together
 * moves as one set.
 *
 * A duration that is missing or zero answers 1, so a caller that cannot say how
 * long the clip is gets a still frame rather than an arbitrary zoom.
 */
export function pushScaleAt(elapsedMs: number, durationMs: number): number {
  if (!Number.isFinite(durationMs) || durationMs <= 0) return 1;
  return 1 + MOTION.pushTotal * unitTime(elapsedMs / durationMs);
}
