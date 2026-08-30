import type { Render2DContext } from "./context";
import { safeContentBox, typeScale } from "./layout";
import { easeOutCubic } from "./motion";
import {
  type RunLine,
  centeredFirstBaseline,
  drawRunLine,
  inkMetrics,
  parseRuns,
  runLineText,
  wrapRuns,
} from "./text";
import { BRAND, TYPEFACE, drawBackdrop } from "./theme";

/**
 * The `text-card` template: large text only (`design-prompt.md`).
 *
 * Three of the reference project's twelve scenes, and the only template that
 * needs no image at all, which makes it the one that always works: a project
 * with no character set and no chart can still cut b roll from its own words.
 *
 * The text is the whole frame, so it is sized to fit rather than fixed. A long
 * line at a fixed size either overflows or wraps into six tiny rows; both read
 * as a bug. `fitTextSize` steps the size down until the block fits, which keeps
 * short lines large and long ones legible.
 */

export const TEXT_CARD_THEME = {
  background: BRAND.background,
  text: BRAND.foreground,
  /** A quiet rule above the words, so the frame is not one floating block. */
  rule: BRAND.accent,
  ruleWidthRatio: 0.06,
  ruleThicknessRatio: 0.006,
  marginRatio: 0.1,
  /** The largest and smallest text sizes, as shares of frame height. */
  maxTextSizeRatio: 0.11,
  minTextSizeRatio: 0.045,
  lineHeightRatio: 1.24,
  /** How far the rule sits above the block's ink, as a share of the text size. */
  ruleGapRatio: 0.7,
  entranceMs: 520,
  /** Each line follows the one above it, so the block reads in. */
  lineStaggerMs: 90,
  riseRatio: 0.035,
} as const;

export interface TextCardScene {
  /** The words to burn on screen. */
  text: string | null;
}

/** How far line `index` has arrived at `elapsedMs`, from 0 to 1. */
export function lineEntrance(elapsedMs: number, index: number): number {
  const theme = TEXT_CARD_THEME;
  if (!Number.isFinite(elapsedMs)) return 0;
  return easeOutCubic((elapsedMs - index * theme.lineStaggerMs) / theme.entranceMs);
}

/**
 * The largest size at which `text` fits the box, stepping down from the
 * template's maximum.
 *
 * Returns the size and the lines at that size, so the caller does not have to
 * wrap twice. Below the minimum it stops shrinking and lets the block be tall:
 * unreadably small text is a worse answer than a full frame.
 */
export function fitTextSize(
  ctx: Pick<Render2DContext, "measureText"> & { font: string },
  text: string,
  box: { width: number; height: number },
  frameScale: number
): { size: number; lines: RunLine[] } {
  const theme = TEXT_CARD_THEME;
  // Sized against the **frame**, fitted against the **box**. Deriving the size
  // range from the box instead would silently shrink every card by the margin,
  // making the theme's stated ratios untrue.
  //
  // `frameScale` is the frame's short edge, not its height — equal in landscape,
  // and the difference between a readable card and a 211px cap in a 1080px wide
  // frame in portrait. The shrink loop below would eventually rescue it either
  // way, which is exactly the problem: every portrait card would bottom out at
  // the minimum size regardless of how few words it holds.
  const max = frameScale * theme.maxTextSizeRatio;
  const min = frameScale * theme.minTextSizeRatio;

  // Parsed once, outside the loop. The creator's marks decide colour, never
  // where a line breaks, so re-parsing per step would be the same answer twelve
  // times over.
  const runs = parseRuns(text);

  let lines: RunLine[] = [];
  let size = max;

  // Twelve steps from max to min is finer than the eye can tell and bounded, so
  // this cannot loop on a pathological string.
  for (let step = 0; step <= 12; step += 1) {
    size = max - ((max - min) * step) / 12;
    ctx.font = `700 ${size}px ${TYPEFACE}`;
    lines = wrapRuns(ctx, runs, box.width);
    if (lines.length * size * theme.lineHeightRatio <= box.height) break;
  }

  return { size, lines };
}

/** Draws one frame of the `text-card` template. */
export function drawTextCardFrame(
  ctx: Render2DContext,
  scene: TextCardScene,
  frame: { width: number; height: number; elapsedMs: number }
): void {
  const { width, height, elapsedMs } = frame;
  const theme = TEXT_CARD_THEME;

  drawBackdrop(ctx, frame);

  const text = scene.text?.trim();
  if (!text) return;

  const margin = Math.min(width, height) * theme.marginRatio;
  // Words are the whole of this template, so the safe area is the whole of its
  // box. In portrait the card is laid out against the frame the platform leaves
  // rather than the frame we encode, which shrinks the type before it clips it:
  // `fitTextSize` gets a smaller box and steps the size down to fit it.
  const content = safeContentBox(frame);
  const box = { width: content.width - margin * 2, height: content.height - margin * 2 };

  ctx.save();
  const { size, lines } = fitTextSize(ctx, text, box, typeScale(frame));
  if (lines.length === 0) {
    ctx.restore();
    return;
  }

  const lineHeight = size * theme.lineHeightRatio;

  ctx.font = `700 ${size}px ${TYPEFACE}`;
  ctx.textAlign = "left";
  // Alphabetic, because the block is placed on its own ink rather than on the
  // font's declared box. `middle` would hand that placement back to the face.
  ctx.textBaseline = "alphabetic";

  const firstBaseline = centeredFirstBaseline(ctx, lines, {
    centerY: content.height / 2,
    lineHeight,
    size,
  });

  // The rule arrives with the first line, above the block. Hung off the ink of
  // that line rather than off the baseline, so it keeps its gap whether the line
  // is all capitals or full of descenders.
  const ruleArrived = lineEntrance(elapsedMs, 0);
  if (ruleArrived > 0) {
    const { ascent } = inkMetrics(ctx, runLineText(lines[0]), size);
    ctx.globalAlpha = ruleArrived;
    ctx.fillStyle = theme.rule;
    ctx.fillRect(
      margin,
      firstBaseline - ascent - size * theme.ruleGapRatio,
      content.width * theme.ruleWidthRatio * ruleArrived,
      Math.max(1, height * theme.ruleThicknessRatio)
    );
  }

  lines.forEach((line, index) => {
    const arrived = lineEntrance(elapsedMs, index);
    if (arrived <= 0) return;
    ctx.globalAlpha = arrived;
    const rise = height * theme.riseRatio * (1 - arrived);
    drawRunLine(ctx, line, margin, firstBaseline + index * lineHeight + rise, theme.text);
  });

  ctx.restore();
}
