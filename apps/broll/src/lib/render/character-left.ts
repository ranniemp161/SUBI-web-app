import type { DrawableImage, Render2DContext } from "./context";
import { fitCharacter, isPortrait, typeScale, wrapText } from "./layout";

/**
 * The `character-left` template: character 40% left, text right
 * (`design-prompt.md`). Motion is part of the template: the character slides in
 * from the edge, the text fades up just behind it.
 *
 * **In a portrait frame it stacks instead: character along the bottom, words
 * above.** This is the only template that branches on orientation, because it
 * is the only one whose composition is a side by side split, and a 9:16 frame
 * has no side to put anything on. Giving the character 40% of 1080px next to a
 * 1920px tall frame leaves a small figure marooned beside a near empty column.
 * Stacked, it keeps the template's actual idea — the character set apart from
 * the words rather than behind them, which is what distinguishes it from
 * `character-center` — so a creator switching a project to vertical gets the
 * same six templates rather than four that work and two that look broken.
 *
 * This is the template that carries most of a real plan. On the reference
 * project 8 of 12 scenes are character templates and only 2 are charts, so this
 * is what the product mostly looks like.
 *
 * Drawing is a **pure function of time and its inputs**, exactly like the chart
 * template. The character arrives as an already decoded bitmap; nothing here
 * fetches or waits. That is what lets the encoder render frame N without having
 * rendered N-1, and lets the page preview and the encoder share one renderer.
 *
 * **The visual design is a plain default and is not ratified.** The spec gives
 * one line of composition and Phase 0 deferred aesthetic judgment, so every
 * visual constant sits in `CHARACTER_LEFT_THEME` to be replaced.
 */

/** Every visual constant in one object, so restyling touches nothing else. */
export const CHARACTER_LEFT_THEME = {
  background: "#0b0f19",
  text: "#f4f6fb",
  /** Share of the frame width the character column occupies. */
  characterColumnRatio: 0.4,
  marginRatio: 0.07,
  textSizeRatio: 0.085,
  lineHeightRatio: 1.25,
  /** How far the character travels in, as a share of its column width. */
  slideRatio: 0.18,
  /** How far the text rises as it fades, as a share of frame height. */
  textRiseRatio: 0.04,
  /** The character's entrance, in milliseconds. */
  characterEntranceMs: 520,
  /** The text follows slightly behind, so the two do not arrive as one block. */
  textDelayMs: 160,
  textEntranceMs: 480,
  /** Room left under the character so it sits on the frame edge, not floating. */
  characterBottomRatio: 0.0,
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
  portraitCharacterBandRatio: 0.58,
} as const;

export interface CharacterLeftScene {
  /** A few words burned on screen, or null. The planner keeps it short. */
  text: string | null;
  /** The chosen emotion's cutout, already decoded, or null if it is missing. */
  image: DrawableImage | null;
}

function easeOutCubic(t: number): number {
  const clamped = Math.min(1, Math.max(0, t));
  return 1 - (1 - clamped) ** 3;
}

/** How far the character has arrived at `elapsedMs`, from 0 to 1. */
export function characterEntrance(elapsedMs: number): number {
  if (!Number.isFinite(elapsedMs) || elapsedMs <= 0) return 0;
  return easeOutCubic(elapsedMs / CHARACTER_LEFT_THEME.characterEntranceMs);
}

/** How far the text has arrived at `elapsedMs`, from 0 to 1, after its delay. */
export function textEntrance(elapsedMs: number): number {
  const theme = CHARACTER_LEFT_THEME;
  if (!Number.isFinite(elapsedMs)) return 0;
  return easeOutCubic((elapsedMs - theme.textDelayMs) / theme.textEntranceMs);
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
  const { width, height, elapsedMs } = frame;
  const theme = CHARACTER_LEFT_THEME;

  // Background first, every frame: the encoder reuses one canvas and must never
  // inherit the previous frame's pixels.
  ctx.fillStyle = theme.background;
  ctx.fillRect(0, 0, width, height);

  const margin = Math.min(width, height) * theme.marginRatio;
  const portrait = isPortrait(frame);
  // Landscape splits the frame across, portrait splits it down. Everything
  // below reads the split rather than re-deciding it.
  const columnWidth = portrait ? width : width * theme.characterColumnRatio;
  const bandHeight = portrait ? height * theme.portraitCharacterBandRatio : height;

  const geo = { width, height, columnWidth, bandHeight, margin, portrait, elapsedMs };
  drawCharacter(ctx, scene.image, geo);
  drawOverlayText(ctx, scene.text, geo);
}

interface Geometry {
  width: number;
  height: number;
  /** The character's column in landscape; the full frame width in portrait. */
  columnWidth: number;
  /** The character's band in portrait; the full frame height in landscape. */
  bandHeight: number;
  margin: number;
  portrait: boolean;
  elapsedMs: number;
}

function drawCharacter(
  ctx: Render2DContext,
  image: DrawableImage | null,
  geo: Geometry
): void {
  // A missing cutout is not a broken frame. The scene still carries its text,
  // and a black gap reads better than a crash or a placeholder box the creator
  // would have to notice and remove.
  if (!image) return;

  const theme = CHARACTER_LEFT_THEME;
  const arrived = characterEntrance(geo.elapsedMs);
  if (arrived <= 0) return;

  // Portrait: a band along the bottom, the full frame wide. Landscape: a column
  // down the left. `fitCharacter` anchors to the bottom of whichever it gets, so
  // the character stands on the frame edge in both.
  const box = geo.portrait
    ? { x: 0, y: geo.height - geo.bandHeight, width: geo.width, height: geo.bandHeight }
    : {
        x: 0,
        y: geo.margin,
        width: geo.columnWidth,
        height: geo.height - geo.margin - geo.height * theme.characterBottomRatio,
      };
  const fitted = fitCharacter(image, box);
  if (fitted.width <= 0 || fitted.height <= 0) return;

  // Travels in along whichever axis the composition splits on: from the left
  // edge beside the words, from below when it sits under them. Sliding
  // horizontally under a stacked layout reads as a mistake rather than a move.
  const travel = (1 - arrived) * theme.slideRatio;
  const dx = geo.portrait ? 0 : -geo.columnWidth * travel;
  const dy = geo.portrait ? geo.bandHeight * travel : 0;

  ctx.save();
  ctx.globalAlpha = arrived;
  ctx.drawImage(image, fitted.x + dx, fitted.y + dy, fitted.width, fitted.height);
  ctx.restore();
}

function drawOverlayText(
  ctx: Render2DContext,
  text: string | null,
  geo: Geometry
): void {
  if (!text || text.trim() === "") return;

  const theme = CHARACTER_LEFT_THEME;
  const arrived = textEntrance(geo.elapsedMs);
  if (arrived <= 0) return;

  // Sized off the short edge, so 0.085 means the same thing in both
  // orientations. Off the height it would be a 163px cap in a 1080px frame.
  const size = typeScale(geo) * theme.textSizeRatio;
  const lineHeight = size * theme.lineHeightRatio;
  // Beside the character in landscape, above it in portrait.
  const left = geo.portrait ? geo.margin : geo.columnWidth + geo.margin;
  const maxWidth = geo.width - left - geo.margin;

  ctx.save();
  ctx.globalAlpha = arrived;
  ctx.fillStyle = theme.text;
  ctx.font = `700 ${size}px sans-serif`;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";

  const lines = wrapText(ctx, text.trim(), maxWidth);
  // Rises as it fades in, so the two read as one movement.
  const rise = geo.height * theme.textRiseRatio * (1 - arrived);
  // Centred in the space the words actually have: the whole frame beside the
  // character, only the area above the band when stacked above it. Centring on
  // the frame in portrait would sit the block on top of the character's head.
  const textAreaHeight = geo.portrait ? geo.height - geo.bandHeight : geo.height;
  const blockTop = textAreaHeight / 2 - ((lines.length - 1) * lineHeight) / 2;

  lines.forEach((line, index) => {
    ctx.fillText(line, left, blockTop + index * lineHeight + rise);
  });

  ctx.restore();
}
