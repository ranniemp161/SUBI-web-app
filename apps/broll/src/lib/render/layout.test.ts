import { describe, expect, it } from "vitest";
import { fitCharacter, wrapText } from "./layout";
import type { DrawableImage, Render2DContext } from "./context";

/** Only `measureText` is exercised here; a fixed width per character is enough. */
const measurer = (charWidth = 10): Pick<Render2DContext, "measureText"> => ({
  measureText: (text: string) => ({ width: text.length * charWidth }),
});

const bitmap = (width: number, height: number): DrawableImage =>
  ({ width, height }) as unknown as DrawableImage;

/** Matches a real stored cutout: portrait, cropped to its own bounding box. */
const CUTOUT: DrawableImage = bitmap(686, 1126);

describe("fitCharacter", () => {
  const box = { x: 0, y: 0, width: 400, height: 1000 };

  it("preserves the aspect ratio", () => {
    const fitted = fitCharacter(CUTOUT, box);
    expect(fitted.width / fitted.height).toBeCloseTo(686 / 1126, 6);
  });

  it("anchors to the bottom, so every emotion stands on the same floor", () => {
    // Stored cutouts vary in width per emotion (686 to 866 against a constant
    // 1126 tall). Anchoring anywhere but the bottom makes them bob between
    // scenes.
    const narrow = fitCharacter({ width: 686, height: 1126 }, box);
    const wide = fitCharacter({ width: 866, height: 1127 }, box);
    expect(narrow.y + narrow.height).toBeCloseTo(box.height, 6);
    expect(wide.y + wide.height).toBeCloseTo(box.height, 6);
  });

  it("centres horizontally within its column", () => {
    const fitted = fitCharacter(CUTOUT, box);
    expect(fitted.x + fitted.width / 2).toBeCloseTo(box.width / 2, 6);
  });

  it("never exceeds the box on either axis", () => {
    for (const image of [
      { width: 4000, height: 100 },
      { width: 100, height: 4000 },
      { width: 686, height: 1126 },
    ]) {
      const fitted = fitCharacter(image, box);
      expect(fitted.width).toBeLessThanOrEqual(box.width + 1e-9);
      expect(fitted.height).toBeLessThanOrEqual(box.height + 1e-9);
    }
  });

  it("fills a landscape frame's height for a portrait cutout, without a cover mode", () => {
    // Worth pinning: a full bleed centred character needs to fill the frame,
    // and contain already does that here because a portrait image in a
    // landscape box is height bound. This is why no cover mode exists.
    const frame = { x: 0, y: 0, width: 1920, height: 1080 };
    const fitted = fitCharacter(CUTOUT, frame);
    expect(fitted.height).toBeCloseTo(1080, 6);
    expect(fitted.x + fitted.width / 2).toBeCloseTo(960, 6);
  });

  it("returns nothing drawable for a degenerate image", () => {
    expect(fitCharacter({ width: 0, height: 100 }, box).width).toBe(0);
    expect(fitCharacter({ width: 100, height: 0 }, box).height).toBe(0);
  });
});

describe("wrapText", () => {
  const ctx = measurer();

  it("breaks on words to fit the width", () => {
    // 10px per character in the recorder, so 100px is 10 characters.
    expect(wrapText(ctx, "one two three four", 100)).toEqual(["one two", "three four"]);
  });

  it("keeps a single word that cannot fit rather than splitting or dropping it", () => {
    // These are the speaker's own words burned on screen. An overhang is better
    // than a hyphen, and far better than losing the word.
    expect(wrapText(ctx, "internationalisation", 50)).toEqual(["internationalisation"]);
  });

  it("collapses whitespace and ignores empty input", () => {
    expect(wrapText(ctx, "  a   b  ", 1000)).toEqual(["a b"]);
    expect(wrapText(ctx, "", 1000)).toEqual([]);
    expect(wrapText(ctx, "   ", 1000)).toEqual([]);
  });
});

