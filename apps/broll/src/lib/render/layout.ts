import type { Render2DContext } from "./context";

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
 * A word longer than the line is left on its own line rather than split: these
 * are the speaker's own words burned on screen, so an overhang reads better
 * than a hyphen, and dropping it would lose what was said.
 */
export function wrapText(
  ctx: Pick<Render2DContext, "measureText">,
  text: string,
  maxWidth: number
): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];

  const lines: string[] = [];
  let current = words[0];

  for (const word of words.slice(1)) {
    const candidate = `${current} ${word}`;
    if (ctx.measureText(candidate).width <= maxWidth) {
      current = candidate;
    } else {
      lines.push(current);
      current = word;
    }
  }
  lines.push(current);
  return lines;
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
