import type { Render2DContext } from "./context";
import {
  type FigureScene,
  type OverFigureTheme,
  drawFigureOver,
  entranceAt,
} from "./figure-frame";
import { BRAND } from "./theme";

/**
 * The `character-center` template: character centred, full bleed
 * (`design-prompt.md`), with the words sitting across the lower frame.
 *
 * The largest single bucket on a real plan: 4 of the reference project's 12
 * scenes, more than any other template.
 *
 * Full bleed means the character fills the frame height rather than sitting in
 * a column — `figureInsetRatio` is zero here, which is what distinguishes it
 * from `object-full`, the same composition holding an illustration back from the
 * edges. The composition itself lives in `figure-frame.ts`; this file is the
 * theme and nothing else.
 *
 * Drawing is a pure function of time and inputs, like every template here.
 */

export const CHARACTER_CENTER_THEME = {
  background: BRAND.background,
  text: BRAND.foreground,
  /** The scrim behind the words, so they read against any cutout. */
  scrim: BRAND.background,
  scrimAlpha: 0.72,
  /** Share of frame height the scrim covers, measured from the bottom. */
  scrimHeightRatio: 0.3,
  marginRatio: 0.07,
  textSizeRatio: 0.075,
  lineHeightRatio: 1.22,
  /** How far the character rises as it fades in, as a share of frame height. */
  riseRatio: 0.03,
  figureEntranceMs: 560,
  textDelayMs: 180,
  textEntranceMs: 460,
  /** Full bleed: the character is allowed to touch every edge. */
  figureInsetRatio: 0,
  /** Standing on the frame edge, like every other character template. */
  anchor: "bottom",
} as const satisfies OverFigureTheme & { background: string };

export type CharacterCenterScene = FigureScene;

/** How far the character has arrived at `elapsedMs`, from 0 to 1. */
export function centerCharacterEntrance(elapsedMs: number): number {
  if (elapsedMs <= 0) return 0;
  return entranceAt(elapsedMs, 0, CHARACTER_CENTER_THEME.figureEntranceMs);
}

/** How far the words have arrived at `elapsedMs`, from 0 to 1, after the delay. */
export function centerTextEntrance(elapsedMs: number): number {
  const theme = CHARACTER_CENTER_THEME;
  return entranceAt(elapsedMs, theme.textDelayMs, theme.textEntranceMs);
}

/** Draws one frame of the `character-center` template. */
export function drawCharacterCenterFrame(
  ctx: Render2DContext,
  scene: CharacterCenterScene,
  frame: { width: number; height: number; elapsedMs: number }
): void {
  drawFigureOver(ctx, scene, frame, CHARACTER_CENTER_THEME);
}
