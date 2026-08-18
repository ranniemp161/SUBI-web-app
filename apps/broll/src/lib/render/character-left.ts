import type { Render2DContext } from "./context";
import {
  type BesideFigureTheme,
  type FigureScene,
  drawFigureBeside,
  entranceAt,
} from "./figure-frame";
import { BRAND } from "./theme";

/**
 * The `character-left` template: character 40% left, text right
 * (`design-prompt.md`). Motion is part of the template: the character slides in
 * from the edge, the text fades up just behind it.
 *
 * **In a portrait frame it stacks instead: character along the bottom, words
 * above.** See `figure-frame.ts`, which owns that branch and the composition
 * itself — this file is now the theme and nothing else. The composition moved
 * there when spec `broll/0008` added `object-left`, which is this same layout
 * with an illustration in it rather than the creator.
 *
 * This is the template that carries most of a real plan. On the reference
 * project 8 of 12 scenes are character templates and only 2 are charts, so this
 * is what the product mostly looks like.
 *
 * **The visual design is a plain default and is not ratified.** The spec gives
 * one line of composition and Phase 0 deferred aesthetic judgment, so every
 * visual constant sits in `CHARACTER_LEFT_THEME` to be replaced.
 */

/** Every visual constant in one object, so restyling touches nothing else. */
export const CHARACTER_LEFT_THEME = {
  background: BRAND.background,
  text: BRAND.foreground,
  /** Share of the frame width the character column occupies. */
  columnRatio: 0.4,
  marginRatio: 0.07,
  textSizeRatio: 0.085,
  lineHeightRatio: 1.25,
  /** How far the character travels in, as a share of its column width. */
  slideRatio: 0.18,
  /** How far the text rises as it fades, as a share of frame height. */
  textRiseRatio: 0.04,
  /** The character's entrance, in milliseconds. */
  figureEntranceMs: 520,
  /** The text follows slightly behind, so the two do not arrive as one block. */
  textDelayMs: 160,
  textEntranceMs: 480,
  /** Room left under the character so it sits on the frame edge, not floating. */
  figureBottomRatio: 0.0,
  /**
   * Portrait only: the share of frame height the character band occupies along
   * the bottom. The words take what is left above it.
   *
   * Measured at 1080x1920: the band is 1114px, a 866x1126 cutout fits it height
   * bound at 856px wide, so the character covers 79% of the frame width and
   * leaves 806px above for the words. Deliberately not full bleed — filling the
   * width is `character-center`'s job, and the two templates have to stay
   * visually distinct in portrait or the picker offers a choice that isn't one.
   */
  portraitBandRatio: 0.58,
  /** A character stands on a floor line shared with every other scene. */
  anchor: "bottom",
} as const satisfies BesideFigureTheme & { background: string };

export type CharacterLeftScene = FigureScene;

/** How far the character has arrived at `elapsedMs`, from 0 to 1. */
export function characterEntrance(elapsedMs: number): number {
  if (elapsedMs <= 0) return 0;
  return entranceAt(elapsedMs, 0, CHARACTER_LEFT_THEME.figureEntranceMs);
}

/** How far the text has arrived at `elapsedMs`, from 0 to 1, after its delay. */
export function textEntrance(elapsedMs: number): number {
  const theme = CHARACTER_LEFT_THEME;
  return entranceAt(elapsedMs, theme.textDelayMs, theme.textEntranceMs);
}

/**
 * Draws one frame of the `character-left` template.
 *
 * `elapsedMs` is time since the scene started, not absolute timeline time, so
 * a scene's motion is identical wherever it sits on the edit.
 */
export function drawCharacterLeftFrame(
  ctx: Render2DContext,
  scene: CharacterLeftScene,
  frame: { width: number; height: number; elapsedMs: number }
): void {
  drawFigureBeside(ctx, scene, frame, CHARACTER_LEFT_THEME);
}
