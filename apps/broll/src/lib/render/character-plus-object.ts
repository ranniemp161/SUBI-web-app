import type { DrawableImage, Render2DContext } from "./context";
import { entranceAt } from "./figure-frame";
import { fitFigure, isPortrait, typeScale, wrapText } from "./layout";
import { BRAND, TYPEFACE, drawBackdrop } from "./theme";

/**
 * The `character-plus-object` template: the creator and the thing they named,
 * in one frame (spec `broll/0008`).
 *
 * **The one composition here that holds two figures**, which is why it is
 * written out rather than expressed through `figure-frame.ts` — that module's
 * two compositions each place a single cutout, and bending either to take a
 * second would leave both harder to read than two honest implementations.
 *
 * It is also the machinery `character-plus-chart` will need. That template has
 * been listed and undrawn since Phase 0; whoever builds it should start from the
 * zoning here rather than from a blank file.
 *
 * The zones, landscape: the character stands in a column on the **right**,
 * mirroring `character-left` so the two templates cannot be confused at a
 * glance; the object floats centred in the space to its left; the words sit
 * along the bottom of that same space. Portrait stacks: object above, character
 * below, words over the character on a scrim — the only arrangement that leaves
 * both figures large enough to read in a 9:16 frame.
 *
 * The order of arrival is the sentence the scene is making: the **object first**
 * because it is what the line was about, the character just behind it, the words
 * last.
 *
 * Drawing is a pure function of time and inputs, like every template here.
 */

export const CHARACTER_PLUS_OBJECT_THEME = {
  background: BRAND.background,
  text: BRAND.foreground,
  /** The scrim behind the words in portrait, where they sit over the character. */
  scrim: BRAND.background,
  scrimAlpha: 0.72,
  /** Landscape: share of the frame width the character column takes on the right. */
  characterColumnRatio: 0.38,
  /** Landscape: share of frame height reserved for the words under the object. */
  textBandRatio: 0.26,
  /** Portrait: share of frame height the character band takes along the bottom. */
  portraitCharacterBandRatio: 0.54,
  marginRatio: 0.07,
  textSizeRatio: 0.062,
  lineHeightRatio: 1.24,
  /** How far the object rises as it fades in, as a share of frame height. */
  objectRiseRatio: 0.035,
  /** How far the character travels in, as a share of its column width. */
  characterSlideRatio: 0.16,
  /** How far the words rise as they fade, as a share of frame height. */
  textRiseRatio: 0.03,
  objectEntranceMs: 540,
  /** The character follows the object, because the object is the point. */
  characterDelayMs: 140,
  characterEntranceMs: 500,
  textDelayMs: 300,
  textEntranceMs: 440,
  anchor: "center",
} as const;

export interface CharacterPlusObjectScene {
  /** A few words burned on screen, or null. */
  text: string | null;
  /** The chosen emotion's cutout, already decoded, or null if it is missing. */
  image: DrawableImage | null;
  /** The generated illustration, already decoded, or null if it is missing. */
  objectImage: DrawableImage | null;
}

/** How far the object has arrived at `elapsedMs`, from 0 to 1. */
export function pairObjectEntrance(elapsedMs: number): number {
  if (elapsedMs <= 0) return 0;
  return entranceAt(elapsedMs, 0, CHARACTER_PLUS_OBJECT_THEME.objectEntranceMs);
}

/** How far the character has arrived at `elapsedMs`, from 0 to 1, after its delay. */
export function pairCharacterEntrance(elapsedMs: number): number {
  const theme = CHARACTER_PLUS_OBJECT_THEME;
  return entranceAt(elapsedMs, theme.characterDelayMs, theme.characterEntranceMs);
}

/** How far the words have arrived at `elapsedMs`, from 0 to 1, after their delay. */
export function pairTextEntrance(elapsedMs: number): number {
  const theme = CHARACTER_PLUS_OBJECT_THEME;
  return entranceAt(elapsedMs, theme.textDelayMs, theme.textEntranceMs);
}

/** Draws one frame of the `character-plus-object` template. */
export function drawCharacterPlusObjectFrame(
  ctx: Render2DContext,
  scene: CharacterPlusObjectScene,
  frame: { width: number; height: number; elapsedMs: number }
): void {
  drawBackdrop(ctx, frame);

  if (isPortrait(frame)) {
    drawPortrait(ctx, scene, frame);
    return;
  }
  drawLandscape(ctx, scene, frame);
}

type Frame = { width: number; height: number; elapsedMs: number };

/**
 * Puts an already fitted image on the canvas at a fixed alpha and offset.
 *
 * Every figure in this file arrives by fading while it moves, and the `save` /
 * `restore` pair around `globalAlpha` is the detail that must not be skipped:
 * a stray alpha left behind makes the *next* repaint translucent, so the
 * previous frame bleeds through and it reads as a compositing bug anywhere but
 * where it is.
 */
function placeFigure(
  ctx: Render2DContext,
  image: DrawableImage,
  box: { x: number; y: number; width: number; height: number },
  alpha: number,
  offset: { dx: number; dy: number }
): void {
  const fitted = fitFigure(image, box, CHARACTER_PLUS_OBJECT_THEME.anchor);
  if (fitted.width <= 0 || fitted.height <= 0) return;

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.drawImage(
    image,
    fitted.x + offset.dx,
    fitted.y + offset.dy,
    fitted.width,
    fitted.height
  );
  ctx.restore();
}

function drawLandscape(
  ctx: Render2DContext,
  scene: CharacterPlusObjectScene,
  frame: Frame
): void {
  const theme = CHARACTER_PLUS_OBJECT_THEME;
  const { width, height, elapsedMs } = frame;
  const margin = typeScale(frame) * theme.marginRatio;

  const columnWidth = width * theme.characterColumnRatio;
  const stageWidth = width - columnWidth;
  const textBand = height * theme.textBandRatio;

  // The object gets the stage: everything left of the character column, above
  // the band the words occupy.
  const objectArrived = pairObjectEntrance(elapsedMs);
  if (scene.objectImage && objectArrived > 0) {
    placeFigure(
      ctx,
      scene.objectImage,
      {
        x: margin,
        y: margin,
        width: stageWidth - margin * 2,
        height: height - textBand - margin * 2,
      },
      objectArrived,
      { dx: 0, dy: height * theme.objectRiseRatio * (1 - objectArrived) }
    );
  }

  // The character stands on the frame edge in its own column, and slides in
  // from the right — the mirror of `character-left`, so the two read apart.
  const characterArrived = pairCharacterEntrance(elapsedMs);
  if (scene.image && characterArrived > 0) {
    const fitted = fitFigure(
      scene.image,
      { x: stageWidth, y: margin, width: columnWidth, height: height - margin },
      "bottom"
    );
    if (fitted.width > 0 && fitted.height > 0) {
      ctx.save();
      ctx.globalAlpha = characterArrived;
      ctx.drawImage(
        scene.image,
        fitted.x + columnWidth * theme.characterSlideRatio * (1 - characterArrived),
        fitted.y,
        fitted.width,
        fitted.height
      );
      ctx.restore();
    }
  }

  drawBandText(ctx, scene.text, frame, {
    left: margin,
    maxWidth: stageWidth - margin * 2,
    bandTop: height - textBand,
    bandHeight: textBand,
  });
}

function drawPortrait(
  ctx: Render2DContext,
  scene: CharacterPlusObjectScene,
  frame: Frame
): void {
  const theme = CHARACTER_PLUS_OBJECT_THEME;
  const { width, height, elapsedMs } = frame;
  const margin = typeScale(frame) * theme.marginRatio;

  const bandHeight = height * theme.portraitCharacterBandRatio;
  const stageHeight = height - bandHeight;

  const objectArrived = pairObjectEntrance(elapsedMs);
  if (scene.objectImage && objectArrived > 0) {
    placeFigure(
      ctx,
      scene.objectImage,
      { x: margin, y: margin, width: width - margin * 2, height: stageHeight - margin * 2 },
      objectArrived,
      { dx: 0, dy: height * theme.objectRiseRatio * (1 - objectArrived) }
    );
  }

  // Stacked, the character rises from below rather than sliding sideways —
  // a horizontal move under a stacked layout reads as a mistake.
  const characterArrived = pairCharacterEntrance(elapsedMs);
  if (scene.image && characterArrived > 0) {
    const fitted = fitFigure(
      scene.image,
      { x: 0, y: stageHeight, width, height: bandHeight },
      "bottom"
    );
    if (fitted.width > 0 && fitted.height > 0) {
      ctx.save();
      ctx.globalAlpha = characterArrived;
      ctx.drawImage(
        scene.image,
        fitted.x,
        fitted.y + bandHeight * theme.characterSlideRatio * (1 - characterArrived),
        fitted.width,
        fitted.height
      );
      ctx.restore();
    }
  }

  drawPortraitText(ctx, scene.text, frame, margin);
}

/**
 * Words left aligned inside a band, vertically centred in it. Landscape only —
 * the band is empty frame beside the character, so no scrim is needed.
 */
function drawBandText(
  ctx: Render2DContext,
  text: string | null,
  frame: Frame,
  band: { left: number; maxWidth: number; bandTop: number; bandHeight: number }
): void {
  if (!text || text.trim() === "") return;

  const theme = CHARACTER_PLUS_OBJECT_THEME;
  const arrived = pairTextEntrance(frame.elapsedMs);
  if (arrived <= 0) return;

  const size = typeScale(frame) * theme.textSizeRatio;
  const lineHeight = size * theme.lineHeightRatio;

  ctx.save();
  ctx.globalAlpha = arrived;
  ctx.fillStyle = theme.text;
  ctx.font = `700 ${size}px ${TYPEFACE}`;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";

  const lines = wrapText(ctx, text.trim(), band.maxWidth);
  const rise = frame.height * theme.textRiseRatio * (1 - arrived);
  const blockTop =
    band.bandTop + band.bandHeight / 2 - ((lines.length - 1) * lineHeight) / 2;

  lines.forEach((line, index) => {
    ctx.fillText(line, band.left, blockTop + index * lineHeight + rise);
  });

  ctx.restore();
}

/**
 * Words centred across the bottom on a scrim. Portrait only — here they sit over
 * the character, so they need the same protection `character-center` gives them
 * against a dark cutout swallowing them on some emotions and not others.
 */
function drawPortraitText(
  ctx: Render2DContext,
  text: string | null,
  frame: Frame,
  margin: number
): void {
  if (!text || text.trim() === "") return;

  const theme = CHARACTER_PLUS_OBJECT_THEME;
  const arrived = pairTextEntrance(frame.elapsedMs);
  if (arrived <= 0) return;

  const size = typeScale(frame) * theme.textSizeRatio;
  const lineHeight = size * theme.lineHeightRatio;

  ctx.save();
  ctx.font = `700 ${size}px ${TYPEFACE}`;
  const lines = wrapText(ctx, text.trim(), frame.width - margin * 2);
  if (lines.length === 0) {
    ctx.restore();
    return;
  }

  const scrimHeight = lines.length * lineHeight + margin * 2;
  ctx.globalAlpha = arrived * theme.scrimAlpha;
  ctx.fillStyle = theme.scrim;
  ctx.fillRect(0, frame.height - scrimHeight, frame.width, scrimHeight);

  ctx.globalAlpha = arrived;
  ctx.fillStyle = theme.text;
  ctx.textAlign = "center";
  ctx.textBaseline = "bottom";

  const bottom = frame.height - margin;
  lines.forEach((line, index) => {
    const fromBottom = (lines.length - 1 - index) * lineHeight;
    ctx.fillText(line, frame.width / 2, bottom - fromBottom);
  });

  ctx.restore();
}
