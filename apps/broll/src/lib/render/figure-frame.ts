import type { DrawableImage, Render2DContext } from "./context";
import { type FitAnchor, fitFigure, isPortrait, typeScale, wrapText } from "./layout";
import { entranceAt, figureTravelAt } from "./motion";
import { GLOW, TYPEFACE, drawBackdrop } from "./theme";

/**
 * The two compositions that put **one cutout and some words** on a frame, and
 * the only place either is written down.
 *
 * `character-left` and `character-center` each carried its own copy of one of
 * these. Spec `broll/0008` adds object scenes, which want the same two
 * compositions with a different picture in them, and copying the bodies a second
 * time would have made four places where a figure's entrance could drift apart.
 * So the bodies moved here and every figure template became a theme plus a call:
 *
 * | Template | Composition | Figure |
 * |---|---|---|
 * | `character-left` | beside | the creator's cutout |
 * | `character-center` | over | the creator's cutout |
 * | `object-left` | beside | a generated illustration |
 * | `object-full` | over | a generated illustration |
 *
 * **This is a extraction, not a redesign.** The landscape output of the two
 * character templates is unchanged, which their existing tests hold us to.
 *
 * Drawing stays a **pure function of time and its inputs**. Images arrive
 * already decoded; nothing here fetches or waits. That is what lets the encoder
 * render frame N without having rendered N-1, and lets the page preview and the
 * encoder share one renderer.
 */

/**
 * Lays the soft glow that separates a figure from the ground behind it.
 *
 * Drawn **behind** the figure and sized to the frame rather than to the cutout,
 * so a wide illustration and a narrow person get the same pool of light rather
 * than one that traces whatever shape happens to be in front of it.
 *
 * A radial gradient, not `shadowBlur`. A per-element shadow is the one drawing
 * operation expensive enough to matter at thirty frames a second, and it would
 * follow the cutout's alpha edge — which reads as a sticker's outline, the exact
 * cheapness this treatment exists to avoid.
 */
function drawFigureGlow(
  ctx: Render2DContext,
  centerX: number,
  centerY: number,
  frame: FigureFrame,
  arrived: number
): void {
  const radius = Math.min(frame.width, frame.height) * GLOW.radiusRatio;
  if (radius <= 0 || arrived <= 0) return;

  const paint = ctx.createRadialGradient(centerX, centerY, 0, centerX, centerY, radius);
  paint.addColorStop(0, GLOW.color);
  paint.addColorStop(1, GLOW.edge);

  ctx.save();
  // Arrives with the figure rather than ahead of it, or the frame lights up
  // around an empty space a beat before anything is standing in it.
  ctx.globalAlpha = arrived * GLOW.alpha;
  ctx.fillStyle = paint;
  ctx.fillRect(centerX - radius, centerY - radius, radius * 2, radius * 2);
  ctx.restore();
}

/** What a figure template needs to know to draw itself. */
export interface FigureScene {
  /** A few words burned on screen, or null. The planner keeps it short. */
  text: string | null;
  /** The cutout, already decoded, or null if it is missing. */
  image: DrawableImage | null;
}

export interface FigureFrame {
  width: number;
  height: number;
  elapsedMs: number;
}

/** The knobs the "figure beside the words" composition turns. */
export interface BesideFigureTheme {
  text: string;
  /** Share of the frame width the figure column occupies, in landscape. */
  columnRatio: number;
  marginRatio: number;
  textSizeRatio: number;
  lineHeightRatio: number;
  /** How far the figure travels in, as a share of its column width. */
  slideRatio: number;
  /** How far the text rises as it fades, as a share of frame height. */
  textRiseRatio: number;
  figureEntranceMs: number;
  /** The text follows slightly behind, so the two do not arrive as one block. */
  textDelayMs: number;
  textEntranceMs: number;
  /** Room left under the figure so it sits on the frame edge, not floating. */
  figureBottomRatio: number;
  /** Portrait only: share of frame height the figure band occupies. */
  portraitBandRatio: number;
  anchor: FitAnchor;
}

/** The knobs the "words over the figure" composition turns. */
export interface OverFigureTheme {
  text: string;
  /** The scrim behind the words, so they read against any cutout. */
  scrim: string;
  scrimAlpha: number;
  /** Share of frame height the scrim covers, measured from the bottom. */
  scrimHeightRatio: number;
  marginRatio: number;
  textSizeRatio: number;
  lineHeightRatio: number;
  /** How far the figure rises as it fades in, as a share of frame height. */
  riseRatio: number;
  figureEntranceMs: number;
  textDelayMs: number;
  textEntranceMs: number;
  /**
   * How far the figure is held back from the frame edges, as a share of the
   * short edge. Zero is full bleed, which is what a character wants; an object
   * gets a margin, because an illustration touching all four edges reads as a
   * cropping accident rather than as a full bleed decision.
   */
  figureInsetRatio: number;
  anchor: FitAnchor;
}

interface Geometry {
  width: number;
  height: number;
  /** The figure's column in landscape; the full frame width in portrait. */
  columnWidth: number;
  /** The figure's band in portrait; the full frame height in landscape. */
  bandHeight: number;
  margin: number;
  portrait: boolean;
  elapsedMs: number;
}

/**
 * Figure to one side, words to the other — stacking in a portrait frame.
 *
 * **The portrait branch is the whole reason this composition needs one.** A
 * template whose idea is a side by side split has no side to split in a 9:16
 * frame: giving the figure 40% of 1080px next to a 1920px tall frame leaves it
 * marooned beside a near empty column. Stacked, the template keeps its actual
 * idea — the figure set apart from the words rather than behind them, which is
 * what distinguishes it from the `over` composition — so a creator switching a
 * project to vertical gets every template rather than some that work and some
 * that look broken.
 */
export function drawFigureBeside(
  ctx: Render2DContext,
  scene: FigureScene,
  frame: FigureFrame,
  theme: BesideFigureTheme
): void {
  const { width, height, elapsedMs } = frame;

  // Background first, every frame: the encoder reuses one canvas and must never
  // inherit the previous frame's pixels.
  drawBackdrop(ctx, frame);

  const margin = Math.min(width, height) * theme.marginRatio;
  const portrait = isPortrait(frame);
  // Landscape splits the frame across, portrait splits it down. Everything
  // below reads the split rather than re-deciding it.
  const columnWidth = portrait ? width : width * theme.columnRatio;
  const bandHeight = portrait ? height * theme.portraitBandRatio : height;

  const geo = { width, height, columnWidth, bandHeight, margin, portrait, elapsedMs };
  drawBesideFigure(ctx, scene.image, geo, theme);
  drawBesideText(ctx, scene.text, geo, theme);
}

function drawBesideFigure(
  ctx: Render2DContext,
  image: DrawableImage | null,
  geo: Geometry,
  theme: BesideFigureTheme
): void {
  // A missing cutout is not a broken frame. The scene still carries its text,
  // and a black gap reads better than a crash or a placeholder box the creator
  // would have to notice and remove.
  if (!image) return;

  const arrived = geo.elapsedMs <= 0 ? 0 : entranceAt(geo.elapsedMs, 0, theme.figureEntranceMs);
  if (arrived <= 0) return;

  // Portrait: a band along the bottom, the full frame wide. Landscape: a column
  // down the left. The fit anchors inside whichever it gets.
  const box = geo.portrait
    ? { x: 0, y: geo.height - geo.bandHeight, width: geo.width, height: geo.bandHeight }
    : {
        x: 0,
        y: geo.margin,
        width: geo.columnWidth,
        height: geo.height - geo.margin - geo.height * theme.figureBottomRatio,
      };
  const fitted = fitFigure(image, box, theme.anchor);
  if (fitted.width <= 0 || fitted.height <= 0) return;

  // Travels in along whichever axis the composition splits on: from the left
  // edge beside the words, from below when it sits under them. Sliding
  // horizontally under a stacked layout reads as a mistake rather than a move.
  //
  // The distance runs on the overshoot curve while the fade above runs on the
  // clamped one, so `moved` passes 1 near the end and this goes slightly
  // negative: the figure travels a little past its mark and settles back.
  const moved = geo.elapsedMs <= 0 ? 0 : figureTravelAt(geo.elapsedMs, 0, theme.figureEntranceMs);
  const travel = (1 - moved) * theme.slideRatio;
  const dx = geo.portrait ? 0 : -geo.columnWidth * travel;
  const dy = geo.portrait ? geo.bandHeight * travel : 0;

  drawFigureGlow(
    ctx,
    fitted.x + dx + fitted.width / 2,
    fitted.y + dy + fitted.height / 2,
    geo,
    arrived
  );

  ctx.save();
  ctx.globalAlpha = arrived;
  ctx.drawImage(image, fitted.x + dx, fitted.y + dy, fitted.width, fitted.height);
  ctx.restore();
}

function drawBesideText(
  ctx: Render2DContext,
  text: string | null,
  geo: Geometry,
  theme: BesideFigureTheme
): void {
  if (!text || text.trim() === "") return;

  const arrived = entranceAt(geo.elapsedMs, theme.textDelayMs, theme.textEntranceMs);
  if (arrived <= 0) return;

  // Sized off the short edge, so the ratio means the same thing in both
  // orientations. Off the height it would be a 163px cap in a 1080px frame.
  const size = typeScale(geo) * theme.textSizeRatio;
  const lineHeight = size * theme.lineHeightRatio;
  // Beside the figure in landscape, above it in portrait.
  const left = geo.portrait ? geo.margin : geo.columnWidth + geo.margin;
  const maxWidth = geo.width - left - geo.margin;

  ctx.save();
  ctx.globalAlpha = arrived;
  ctx.fillStyle = theme.text;
  ctx.font = `700 ${size}px ${TYPEFACE}`;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";

  const lines = wrapText(ctx, text.trim(), maxWidth);
  // Rises as it fades in, so the two read as one movement.
  const rise = geo.height * theme.textRiseRatio * (1 - arrived);
  // Centred in the space the words actually have: the whole frame beside the
  // figure, only the area above the band when stacked above it. Centring on the
  // frame in portrait would sit the block on top of the figure.
  const textAreaHeight = geo.portrait ? geo.height - geo.bandHeight : geo.height;
  const blockTop = textAreaHeight / 2 - ((lines.length - 1) * lineHeight) / 2;

  lines.forEach((line, index) => {
    ctx.fillText(line, left, blockTop + index * lineHeight + rise);
  });

  ctx.restore();
}

/**
 * Figure filling the frame, words across the lower third on a scrim.
 *
 * The scrim is not decoration. Text sits **over** the figure here rather than
 * beside it, so without one, dark hair or a dark jacket swallows the words on
 * some emotions and not others — the worst kind of bug, because it looks fine on
 * the variant you tested.
 */
export function drawFigureOver(
  ctx: Render2DContext,
  scene: FigureScene,
  frame: FigureFrame,
  theme: OverFigureTheme
): void {
  const { width, height, elapsedMs } = frame;

  drawBackdrop(ctx, frame);

  const arrived =
    elapsedMs <= 0 ? 0 : entranceAt(elapsedMs, 0, theme.figureEntranceMs);

  if (scene.image && arrived > 0) {
    const inset = typeScale(frame) * theme.figureInsetRatio;
    const fitted = fitFigure(
      scene.image,
      { x: inset, y: inset, width: width - inset * 2, height: height - inset * 2 },
      theme.anchor
    );
    if (fitted.width > 0 && fitted.height > 0) {
      // Rises slightly as it fades, so it settles rather than appears. On the
      // overshoot curve, so it rises a little past its resting line and drops
      // back into it — the fade stays on the clamped curve above.
      const moved = figureTravelAt(elapsedMs, 0, theme.figureEntranceMs);
      const rise = height * theme.riseRatio * (1 - moved);
      drawFigureGlow(
        ctx,
        fitted.x + fitted.width / 2,
        fitted.y + rise + fitted.height / 2,
        frame,
        arrived
      );
      ctx.save();
      ctx.globalAlpha = arrived;
      ctx.drawImage(scene.image, fitted.x, fitted.y + rise, fitted.width, fitted.height);
      ctx.restore();
    }
  }

  drawOverText(ctx, scene.text, frame, theme);
}

function drawOverText(
  ctx: Render2DContext,
  text: string | null,
  frame: FigureFrame,
  theme: OverFigureTheme
): void {
  if (!text || text.trim() === "") return;

  const arrived = entranceAt(frame.elapsedMs, theme.textDelayMs, theme.textEntranceMs);
  if (arrived <= 0) return;

  const margin = Math.min(frame.width, frame.height) * theme.marginRatio;
  // Short edge, so the ratio means the same thing in both orientations. Equal
  // to the height at 1920x1080, so landscape output is byte for byte unchanged.
  const size = typeScale(frame) * theme.textSizeRatio;
  const lineHeight = size * theme.lineHeightRatio;
  const maxWidth = frame.width - margin * 2;

  ctx.save();
  ctx.font = `700 ${size}px ${TYPEFACE}`;
  const lines = wrapText(ctx, text.trim(), maxWidth);
  if (lines.length === 0) {
    ctx.restore();
    return;
  }

  // The scrim fades in with the words rather than ahead of them, so the frame
  // does not darken before there is anything to read.
  const scrimHeight = Math.max(
    frame.height * theme.scrimHeightRatio,
    lines.length * lineHeight + margin * 2
  );
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
