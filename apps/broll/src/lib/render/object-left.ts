import type { Render2DContext } from "./context";
import {
  type BesideFigureTheme,
  type FigureScene,
  drawFigureBeside,
  entranceAt,
} from "./figure-frame";
import { BRAND } from "./theme";

/**
 * The `object-left` template: the illustration in a column, the words beside it
 * (spec `broll/0008`). Stacks in a portrait frame, like every side by side
 * composition here — `figure-frame.ts` owns that branch.
 *
 * The object sibling of `character-left`, and the right choice when the line
 * says something *about* the thing rather than merely naming it: the words get
 * the larger share of the frame and the illustration supports them.
 *
 * Centred in its column rather than bottom anchored, for the reason
 * `object-full` gives — an illustration has no feet to stand on.
 */

export const OBJECT_LEFT_THEME = {
  background: BRAND.background,
  text: BRAND.foreground,
  /**
   * Slightly narrower than the character column's 0.4. A character is read as a
   * person and needs the height; an object is a supporting mark here, and the
   * words are what the scene is for.
   */
  columnRatio: 0.36,
  marginRatio: 0.07,
  textSizeRatio: 0.085,
  lineHeightRatio: 1.25,
  slideRatio: 0.18,
  textRiseRatio: 0.04,
  figureEntranceMs: 520,
  textDelayMs: 160,
  textEntranceMs: 480,
  /**
   * Unlike a character, the illustration is kept off the frame edge — a centred
   * fit inside a column inset from the bottom, so it floats in its own space.
   */
  figureBottomRatio: 0.07,
  /**
   * Portrait only. Lower than `character-left`'s 0.58 because a centred object
   * does not need the height a standing figure does, and the words matter more
   * in this template.
   */
  portraitBandRatio: 0.45,
  anchor: "center",
} as const satisfies BesideFigureTheme & { background: string };

export type ObjectLeftScene = FigureScene;

/** How far the illustration has arrived at `elapsedMs`, from 0 to 1. */
export function objectLeftEntrance(elapsedMs: number): number {
  if (elapsedMs <= 0) return 0;
  return entranceAt(elapsedMs, 0, OBJECT_LEFT_THEME.figureEntranceMs);
}

/** How far the words have arrived at `elapsedMs`, from 0 to 1, after the delay. */
export function objectLeftTextEntrance(elapsedMs: number): number {
  const theme = OBJECT_LEFT_THEME;
  return entranceAt(elapsedMs, theme.textDelayMs, theme.textEntranceMs);
}

/** Draws one frame of the `object-left` template. */
export function drawObjectLeftFrame(
  ctx: Render2DContext,
  scene: ObjectLeftScene,
  frame: { width: number; height: number; elapsedMs: number }
): void {
  drawFigureBeside(ctx, scene, frame, OBJECT_LEFT_THEME);
}
