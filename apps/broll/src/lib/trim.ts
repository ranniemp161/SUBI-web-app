/**
 * Alpha trim: crop a cutout down to the character's own bounding box (spec
 * `broll/0004` AC-18).
 *
 * **Why this exists at all.** Background removal returns an image the size of
 * its input, so an untrimmed character is a mostly empty PNG. Every Phase 4
 * template then scales and positions empty canvas, and `broll_assets.width` /
 * `height` describe the generation frame rather than the character, which is the
 * one thing those columns exist not to do.
 *
 * `alphaBounds` is pure and takes raw RGBA bytes, so the geometry — the part
 * that is easy to get subtly wrong at an edge — is unit tested without a canvas.
 * `trimTransparent` is the browser half that wraps it.
 */

export type Bounds = {
  left: number;
  top: number;
  width: number;
  height: number;
};

/**
 * Pixels at or below this alpha are treated as background.
 *
 * Not zero. Segmentation leaves a halo of very low alpha around the edge, and
 * trimming at `> 0` keeps that halo and so trims to very nearly the whole frame,
 * which silently defeats the whole step. Eight of 255 is about three percent:
 * high enough to ignore the halo, low enough that no part of a drawn character
 * falls under it.
 */
const ALPHA_FLOOR = 8;

/**
 * The smallest rectangle containing every pixel more opaque than `ALPHA_FLOOR`.
 *
 * Returns null when the image is entirely transparent, which is a real outcome
 * rather than a defensive branch: a segmentation that found no subject produces
 * exactly that, and cropping it to a zero sized canvas would throw. The caller
 * keeps the untrimmed image and says so.
 */
export function alphaBounds(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  floor: number = ALPHA_FLOOR
): Bounds | null {
  let left = width;
  let right = -1;
  let top = height;
  let bottom = -1;

  for (let y = 0; y < height; y += 1) {
    const rowStart = y * width * 4;
    for (let x = 0; x < width; x += 1) {
      // The alpha byte of pixel (x, y). Reading only every fourth byte is what
      // keeps this a single pass over a 1K image rather than a decode.
      if (data[rowStart + x * 4 + 3] <= floor) continue;
      if (x < left) left = x;
      if (x > right) right = x;
      if (y < top) top = y;
      if (y > bottom) bottom = y;
    }
  }

  if (right < 0 || bottom < 0) return null;

  return {
    left,
    top,
    // Inclusive on both edges: a single opaque pixel is one pixel wide, not
    // zero. Off by one here would shave the character's outermost column.
    width: right - left + 1,
    height: bottom - top + 1,
  };
}

/**
 * Crop a cutout to its character and hand back a PNG (AC-18, AC-19).
 *
 * **PNG in, PNG out, with no JPEG anywhere between Gemini and storage.** JPEG
 * ringing lands exactly on the character edge the whole product is judged by,
 * and JPEG has no alpha channel at all, so a single intermediate would undo both
 * the cutout and the trim.
 *
 * Browser only: it needs `createImageBitmap` and a canvas. The capability probe
 * in `segmentation.ts` proves both before any money moves.
 */
export async function trimTransparent(
  png: Blob
): Promise<{ blob: Blob; width: number; height: number }> {
  const bitmap = await createImageBitmap(png);

  try {
    const source = document.createElement("canvas");
    source.width = bitmap.width;
    source.height = bitmap.height;
    const sourceCtx = source.getContext("2d", { willReadFrequently: true });
    if (!sourceCtx) throw new Error("no 2d context");
    sourceCtx.drawImage(bitmap, 0, 0);

    const { data } = sourceCtx.getImageData(0, 0, bitmap.width, bitmap.height);
    const bounds = alphaBounds(data, bitmap.width, bitmap.height);

    // Nothing opaque to crop to. Store the image as it came rather than failing
    // the run: an unusable cutout the user can see and regenerate beats an error
    // after six images have already been paid for.
    if (!bounds) {
      return { blob: png, width: bitmap.width, height: bitmap.height };
    }

    const cropped = document.createElement("canvas");
    cropped.width = bounds.width;
    cropped.height = bounds.height;
    const croppedCtx = cropped.getContext("2d");
    if (!croppedCtx) throw new Error("no 2d context");
    croppedCtx.drawImage(
      bitmap,
      bounds.left,
      bounds.top,
      bounds.width,
      bounds.height,
      0,
      0,
      bounds.width,
      bounds.height
    );

    const blob = await new Promise<Blob>((resolve, reject) => {
      cropped.toBlob(
        (out) => (out ? resolve(out) : reject(new Error("toBlob returned null"))),
        "image/png"
      );
    });

    return { blob, width: bounds.width, height: bounds.height };
  } finally {
    // A 1K bitmap held past its use is a megabyte of GPU memory, and six of them
    // land in a single run.
    bitmap.close();
  }
}
