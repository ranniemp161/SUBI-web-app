import type { DrawableImage, Render2DContext } from "./context";
import { fitCharacter, wrapText } from "./layout";

/**
 * The `character-center` template: character centred, full bleed
 * (`design-prompt.md`), with the words sitting across the lower frame.
 *
 * The largest single bucket on a real plan: 4 of the reference project's 12
 * scenes, more than any other template.
 *
 * Full bleed means the character fills the frame height rather than sitting in
 * a column. `fitCharacter` gets the whole frame as its box, which for a
 * portrait cutout in a landscape frame is height bound, so it fills top to
 * bottom and is centred horizontally.
 *
 * Text sits **over** the character here rather than beside it, so it needs a
 * scrim to stay readable against whatever the cutout happens to be doing at the
 * bottom of the frame. Without it, dark hair or a dark jacket swallows the
 * words on some emotions and not others, which is the worst kind of bug: it
 * looks fine on the variant you tested.
 *
 * Drawing is a pure function of time and inputs, like every template here.
 */

export const CHARACTER_CENTER_THEME = {
  background: "#0b0f19",
  text: "#f4f6fb",
  /** The scrim behind the words, so they read against any cutout. */
  scrim: "#0b0f19",
  scrimAlpha: 0.72,
  /** Share of frame height the scrim covers, measured from the bottom. */
  scrimHeightRatio: 0.3,
  marginRatio: 0.07,
  textSizeRatio: 0.075,
  lineHeightRatio: 1.22,
  /** How far the character rises as it fades in, as a share of frame height. */
  riseRatio: 0.03,
  characterEntranceMs: 560,
  textDelayMs: 180,
  textEntranceMs: 460,
} as const;

export interface CharacterCenterScene {
  /** A few words burned on screen, or null. */
  text: string | null;
  /** The chosen emotion's cutout, already decoded, or null if it is missing. */
  image: DrawableImage | null;
}

function easeOutCubic(t: number): number {
  const clamped = Math.min(1, Math.max(0, t));
  return 1 - (1 - clamped) ** 3;
}

/** How far the character has arrived at `elapsedMs`, from 0 to 1. */
export function centerCharacterEntrance(elapsedMs: number): number {
  if (!Number.isFinite(elapsedMs) || elapsedMs <= 0) return 0;
  return easeOutCubic(elapsedMs / CHARACTER_CENTER_THEME.characterEntranceMs);
}

/** How far the words have arrived at `elapsedMs`, from 0 to 1, after the delay. */
export function centerTextEntrance(elapsedMs: number): number {
  const theme = CHARACTER_CENTER_THEME;
  if (!Number.isFinite(elapsedMs)) return 0;
  return easeOutCubic((elapsedMs - theme.textDelayMs) / theme.textEntranceMs);
}

/** Draws one frame of the `character-center` template. */
export function drawCharacterCenterFrame(
  ctx: Render2DContext,
  scene: CharacterCenterScene,
  frame: { width: number; height: number; elapsedMs: number }
): void {
  const { width, height, elapsedMs } = frame;
  const theme = CHARACTER_CENTER_THEME;

  ctx.fillStyle = theme.background;
  ctx.fillRect(0, 0, width, height);

  const arrived = centerCharacterEntrance(elapsedMs);

  if (scene.image && arrived > 0) {
    const fitted = fitCharacter(scene.image, { x: 0, y: 0, width, height });
    if (fitted.width > 0 && fitted.height > 0) {
      // Rises slightly as it fades, so it settles rather than appears.
      const rise = height * theme.riseRatio * (1 - arrived);
      ctx.save();
      ctx.globalAlpha = arrived;
      ctx.drawImage(scene.image, fitted.x, fitted.y + rise, fitted.width, fitted.height);
      ctx.restore();
    }
  }

  drawCenteredText(ctx, scene.text, { width, height, elapsedMs });
}

function drawCenteredText(
  ctx: Render2DContext,
  text: string | null,
  frame: { width: number; height: number; elapsedMs: number }
): void {
  if (!text || text.trim() === "") return;

  const theme = CHARACTER_CENTER_THEME;
  const arrived = centerTextEntrance(frame.elapsedMs);
  if (arrived <= 0) return;

  const margin = Math.min(frame.width, frame.height) * theme.marginRatio;
  const size = frame.height * theme.textSizeRatio;
  const lineHeight = size * theme.lineHeightRatio;
  const maxWidth = frame.width - margin * 2;

  ctx.save();
  ctx.font = `700 ${size}px sans-serif`;
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
