import type { Render2DContext } from "./context";
import { runLineText, wrapRuns } from "./text";

/**
 * Layout maths shared by every template.
 *
 * Both pieces here were written for `character-left` and are needed verbatim by
 * `character-center` and `text-card`, so they live in one place rather than
 * being copied. A second copy of the fitting rule would let two templates
 * disagree about where a character stands.
 */

/**
 * The edge every type size and every inset is measured against.
 *
 * **This is the short edge, and in a landscape frame that IS the height, so
 * swapping a `height *` for a `typeScale(...)` changes nothing at 1920x1080.**
 * Every template used to size its type off the frame height, which is correct
 * right up until the frame is taller than it is wide. At 1080x1920 the long
 * edge is the height, so `0.11 * height` is a 211px cap trying to fit an 1080px
 * frame, and `chart-full`'s big number (`0.26`) overflows the frame outright.
 *
 * Sizing off the short edge instead keeps a template's proportions readable in
 * both orientations from one set of ratios, rather than needing a second theme
 * per orientation.
 */
export function typeScale(box: { width: number; height: number }): number {
  return Math.min(box.width, box.height);
}

/**
 * Whether this frame is taller than it is wide.
 *
 * Only the side by side templates branch on this, and only for composition: a
 * template whose whole idea is "figure beside the words" has no room to put
 * anything beside anything in a 9:16 frame. Square counts as landscape, which is
 * arbitrary and only has to be decided somewhere.
 */
export function isPortrait(frame: { width: number; height: number }): boolean {
  return frame.height > frame.width;
}

/**
 * Breaks `text` into lines that fit `maxWidth`, measured through the context.
 *
 * The plain string face of `text.ts`'s run wrapper, for the text a creator never
 * marks up: a chart's title, a label. It wraps by exactly the same rule, orphan
 * control included, because a second wrapping implementation is how two parts of
 * one frame start breaking lines differently.
 *
 * A word longer than the line is left on its own line rather than split: these
 * are the speaker's own words burned on screen, so an overhang reads better
 * than a hyphen, and dropping it would lose what was said.
 */
export function wrapText(
  ctx: Pick<Render2DContext, "measureText">,
  text: string,
  maxWidth: number
): string[] {
  return wrapRuns(ctx, [{ text, emphasis: false }], maxWidth).map(runLineText);
}

/**
 * Where a fitted image sits inside the space left over.
 *
 * `bottom` is what a character wants: cutouts are cropped to their own bounding
 * box, so only a shared floor line stops them bobbing between scenes. `center`
 * is what a generated object wants — a rocket or a barrel has no feet, and
 * standing it on the frame edge reads as a mistake rather than as a decision
 * (spec `broll/0008`).
 */
export type FitAnchor = "bottom" | "center";

/**
 * Fits an image into a box while preserving its aspect ratio, centred
 * horizontally and anchored vertically by `anchor`.
 *
 * Character cutouts are portrait and their widths vary per emotion (the stored
 * set runs 686 to 866 wide against a constant 1126 tall), because each is
 * cropped to its own bounding box. Anchoring to the bottom is what keeps them
 * standing on the same floor line rather than bobbing between scenes.
 *
 * There is deliberately no "cover" mode. One was written for the full bleed
 * centred template and removed: a portrait cutout inside a landscape frame is
 * already height bound under contain, so the two produce identical results for
 * every image this app generates (the generation frame is 3:4). The mode only
 * differed for a landscape source, which cannot occur here.
 */
export function fitFigure(
  image: { width: number; height: number },
  box: { x: number; y: number; width: number; height: number },
  anchor: FitAnchor = "bottom"
): { x: number; y: number; width: number; height: number } {
  if (image.width <= 0 || image.height <= 0) {
    return { x: box.x, y: box.y, width: 0, height: 0 };
  }

  const scale = Math.min(box.width / image.width, box.height / image.height);

  const width = image.width * scale;
  const height = image.height * scale;
  const slack = box.height - height;

  return {
    x: box.x + (box.width - width) / 2,
    y: box.y + (anchor === "center" ? slack / 2 : slack),
    width,
    height,
  };
}

/**
 * The bottom anchored fit, under the name every character template already calls
 * it by. Kept so the character path reads as what it is rather than as a special
 * case of something more general.
 */
export function fitCharacter(
  image: { width: number; height: number },
  box: { x: number; y: number; width: number; height: number }
): { x: number; y: number; width: number; height: number } {
  return fitFigure(image, box, "bottom");
}

/**
 * The margins a portrait clip keeps clear, as shares of the frame.
 *
 * Reels, Shorts and TikTok all paint their own chrome over the bottom of a
 * vertical video (the caption and the handle) and down its right hand side (the
 * action rail). Neither is something this app can move, so the frame has to give
 * way instead. Landscape is unaffected: nothing covers a 16:9 clip dropped into
 * an NLE.
 *
 * 18% of the height covers the caption block across all three with a little
 * room; 11% of the width covers the action rail, the densest chrome of the
 * three (spec `broll/0009`).
 */
export const SAFE_AREA = {
  bottomRatio: 0.18,
  rightRatio: 0.11,
} as const;

/**
 * How much of the frame the platform's own chrome is expected to cover.
 *
 * Zero on both axes in landscape, so every caller can apply this
 * unconditionally and stay byte for byte identical at 1920x1080.
 */
export function safeAreaInsets(frame: { width: number; height: number }): {
  bottom: number;
  right: number;
} {
  if (!isPortrait(frame)) return { bottom: 0, right: 0 };
  return {
    bottom: frame.height * SAFE_AREA.bottomRatio,
    right: frame.width * SAFE_AREA.rightRatio,
  };
}

/**
 * The part of the frame **text and chart marks** may use.
 *
 * **Figures are deliberately not held to this**, which is the one rule in the
 * vertical frame that is a judgement rather than a measurement. A caption bar
 * crossing a character's shins is cosmetic and the shot still reads; a caption
 * bar crossing a word destroys the thing the frame was for. Holding a figure to
 * the same margin would either shrink every portrait cutout by a fifth or crop
 * it, and `character-left`'s portrait band deliberately stands the cutout on
 * the frame edge so characters share a floor line across scenes.
 *
 * That is also why this is a box a template lays out against rather than a clip
 * applied centrally the way the push is: a central clip cannot tell a word from
 * a figure, so it would crop both.
 *
 * The origin stays at 0,0 — the reserve is on the bottom and the right only —
 * so a caller substitutes this for the frame's own width and height and needs
 * no offset.
 */
export function safeContentBox(frame: { width: number; height: number }): {
  width: number;
  height: number;
} {
  const inset = safeAreaInsets(frame);
  return { width: frame.width - inset.right, height: frame.height - inset.bottom };
}
