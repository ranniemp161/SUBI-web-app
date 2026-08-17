import type { Render2DContext } from "./context";
import {
  type FigureScene,
  type OverFigureTheme,
  drawFigureOver,
  entranceAt,
} from "./figure-frame";
import { BRAND } from "./theme";

/**
 * The `object-full` template: the illustration large and centred, the words
 * across the lower frame (spec `broll/0008`).
 *
 * The default answer to "the speaker named a thing", and the object sibling of
 * `character-center` — same composition, from `figure-frame.ts`, with two
 * deliberate differences:
 *
 * - **It is inset rather than full bleed.** A character filling the frame reads
 *   as a portrait; an illustration touching all four edges reads as a cropping
 *   accident. `figureInsetRatio` holds it back from the edges so the grid
 *   backdrop still frames it.
 * - **It is centred rather than bottom anchored.** A character stands on a floor
 *   line shared with every other scene, which is what stops cutouts of differing
 *   heights bobbing. A castle has no feet, and sitting it on the frame edge just
 *   looks like it fell.
 *
 * The generated image is a transparent PNG cut out in the browser, exactly like
 * a character variant, so it composites onto the backdrop rather than covering
 * it with a rectangle.
 */

export const OBJECT_FULL_THEME = {
  background: BRAND.background,
  text: BRAND.foreground,
  scrim: BRAND.background,
  scrimAlpha: 0.72,
  scrimHeightRatio: 0.28,
  marginRatio: 0.08,
  textSizeRatio: 0.072,
  lineHeightRatio: 1.22,
  riseRatio: 0.035,
  figureEntranceMs: 560,
  textDelayMs: 180,
  textEntranceMs: 460,
  /**
   * Held back from every edge by 12% of the short edge. Enough that the grid
   * reads as a frame around the object rather than as something it is covering,
   * and enough to leave the scrim somewhere to sit.
   */
  figureInsetRatio: 0.12,
  anchor: "center",
} as const satisfies OverFigureTheme & { background: string };

export type ObjectFullScene = FigureScene;

/** How far the illustration has arrived at `elapsedMs`, from 0 to 1. */
export function objectEntrance(elapsedMs: number): number {
  if (elapsedMs <= 0) return 0;
  return entranceAt(elapsedMs, 0, OBJECT_FULL_THEME.figureEntranceMs);
}

/** How far the words have arrived at `elapsedMs`, from 0 to 1, after the delay. */
export function objectTextEntrance(elapsedMs: number): number {
  const theme = OBJECT_FULL_THEME;
  return entranceAt(elapsedMs, theme.textDelayMs, theme.textEntranceMs);
}

/** Draws one frame of the `object-full` template. */
export function drawObjectFullFrame(
  ctx: Render2DContext,
  scene: ObjectFullScene,
  frame: { width: number; height: number; elapsedMs: number }
): void {
  drawFigureOver(ctx, scene, frame, OBJECT_FULL_THEME);
}
