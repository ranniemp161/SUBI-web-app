import { describe, it, expect } from "vitest";
import { alphaBounds } from "./trim";

/**
 * The trim geometry (spec `broll/0004` AC-18).
 *
 * `alphaBounds` is the half that is easy to get subtly wrong — an off by one
 * here shaves the character's outermost column, and a wrong alpha floor silently
 * trims nothing at all. It is pure and takes raw RGBA, so it is tested without a
 * canvas; `trimTransparent` around it is browser wiring.
 */

/** Build an RGBA buffer and paint one opaque rectangle into it. */
function canvas(
  width: number,
  height: number,
  rect: { left: number; top: number; width: number; height: number } | null,
  alpha = 255
): Uint8ClampedArray {
  const data = new Uint8ClampedArray(width * height * 4);
  if (!rect) return data;

  for (let y = rect.top; y < rect.top + rect.height; y += 1) {
    for (let x = rect.left; x < rect.left + rect.width; x += 1) {
      data[(y * width + x) * 4 + 3] = alpha;
    }
  }
  return data;
}

describe("alphaBounds", () => {
  it("returns the rectangle containing every opaque pixel", () => {
    const rect = { left: 3, top: 5, width: 4, height: 6 };
    expect(alphaBounds(canvas(20, 20, rect), 20, 20)).toEqual(rect);
  });

  it("is inclusive on both edges, so one opaque pixel is one pixel wide", () => {
    // The off by one that would shave the character's outermost column.
    const bounds = alphaBounds(canvas(10, 10, { left: 4, top: 4, width: 1, height: 1 }), 10, 10);
    expect(bounds).toEqual({ left: 4, top: 4, width: 1, height: 1 });
  });

  it("keeps a subject that touches the frame edge whole", () => {
    const full = { left: 0, top: 0, width: 8, height: 8 };
    expect(alphaBounds(canvas(8, 8, full), 8, 8)).toEqual(full);
  });

  it("returns null for a fully transparent image rather than a zero sized box", () => {
    // A segmentation that found no subject produces exactly this, and cropping
    // to a zero sized canvas would throw. The caller keeps the untrimmed image.
    expect(alphaBounds(canvas(8, 8, null), 8, 8)).toBeNull();
  });

  it("ignores the low alpha halo segmentation leaves around an edge", () => {
    // This is the whole reason the floor is not zero. Trimming at `> 0` keeps
    // the halo, so the bounding box becomes very nearly the whole frame and the
    // trim silently does nothing.
    const data = canvas(20, 20, { left: 0, top: 0, width: 20, height: 20 }, 4);
    const subject = { left: 8, top: 8, width: 3, height: 3 };
    for (let y = subject.top; y < subject.top + subject.height; y += 1) {
      for (let x = subject.left; x < subject.left + subject.width; x += 1) {
        data[(y * 20 + x) * 4 + 3] = 255;
      }
    }

    expect(alphaBounds(data, 20, 20)).toEqual(subject);
  });

  it("honours an explicit floor", () => {
    const data = canvas(6, 6, { left: 1, top: 1, width: 2, height: 2 }, 40);
    expect(alphaBounds(data, 6, 6, 60)).toBeNull();
    expect(alphaBounds(data, 6, 6, 20)).toEqual({ left: 1, top: 1, width: 2, height: 2 });
  });
});
