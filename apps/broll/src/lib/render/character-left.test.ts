import { describe, expect, it } from "vitest";
import {
  CHARACTER_LEFT_THEME,
  characterEntrance,
  drawCharacterLeftFrame,
  fitCharacter,
  textEntrance,
  wrapText,
  type CharacterLeftScene,
} from "./character-left";
import type { DrawableImage, Render2DContext } from "./context";

type Call =
  | { op: "fillRect"; x: number; y: number; width: number; height: number; style: string }
  | { op: "fillText"; text: string; x: number; y: number; alpha: number }
  | {
      op: "drawImage";
      x: number;
      y: number;
      width: number;
      height: number;
      alpha: number;
    };

/**
 * Records draw calls. `measureText` charges a fixed width per character, which
 * is enough for the wrapper: the tests assert where breaks land, not glyph
 * metrics.
 */
function recorder(charWidth = 10) {
  const calls: Call[] = [];
  const ctx: Render2DContext & { calls: Call[] } = {
    calls,
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 0,
    lineJoin: "round",
    lineCap: "round",
    font: "",
    textAlign: "left",
    textBaseline: "top",
    globalAlpha: 1,
    save() {},
    restore() {},
    translate() {},
    beginPath() {},
    closePath() {},
    moveTo() {},
    lineTo() {},
    arc() {},
    rect() {},
    clip() {},
    fill() {},
    stroke() {},
    fillRect(x, y, width, height) {
      calls.push({ op: "fillRect", x, y, width, height, style: String(this.fillStyle) });
    },
    fillText(text, x, y) {
      calls.push({ op: "fillText", text, x, y, alpha: this.globalAlpha });
    },
    measureText(text) {
      return { width: text.length * charWidth };
    },
    drawImage(_image, dx, dy, dWidth, dHeight) {
      calls.push({
        op: "drawImage",
        x: dx,
        y: dy,
        width: dWidth,
        height: dHeight,
        alpha: this.globalAlpha,
      });
    },
  };
  return ctx;
}

type Rec = ReturnType<typeof recorder>;

/**
 * A stand in for a decoded cutout. `DrawableImage` is the browser's real image
 * source union, because a structural type could not be satisfied by an actual
 * canvas context, so a test stub has to be cast. The renderer only ever reads
 * `width` and `height` off it, which is what makes the cast safe here.
 */
const bitmap = (width: number, height: number): DrawableImage =>
  ({ width, height }) as unknown as DrawableImage;

/** Matches a real stored cutout: portrait, cropped to its own bounding box. */
const CUTOUT: DrawableImage = bitmap(686, 1126);

const SCENE: CharacterLeftScene = {
  text: "that Trump agreement does not bind us",
  image: CUTOUT,
};

const FRAME = { width: 1920, height: 1080, elapsedMs: 5_000 };

const images = (ctx: Rec) =>
  ctx.calls.filter((c): c is Extract<Call, { op: "drawImage" }> => c.op === "drawImage");
const texts = (ctx: Rec) =>
  ctx.calls.filter((c): c is Extract<Call, { op: "fillText" }> => c.op === "fillText");

const draw = (scene: CharacterLeftScene, frame = FRAME) => {
  const ctx = recorder();
  drawCharacterLeftFrame(ctx, scene, frame);
  return ctx;
};

describe("drawCharacterLeftFrame", () => {
  it("paints the full frame background before anything else", () => {
    expect(draw(SCENE).calls[0]).toMatchObject({
      op: "fillRect",
      x: 0,
      y: 0,
      width: 1920,
      height: 1080,
      style: CHARACTER_LEFT_THEME.background,
    });
  });

  it("draws the character in the left column and the text to its right", () => {
    const ctx = draw(SCENE);
    const character = images(ctx)[0];
    const column = 1920 * CHARACTER_LEFT_THEME.characterColumnRatio;

    expect(character.x + character.width).toBeLessThanOrEqual(column + 1);
    for (const line of texts(ctx)) expect(line.x).toBeGreaterThanOrEqual(column);
  });

  it("is a pure function of time: same inputs, same pixels", () => {
    expect(draw(SCENE).calls).toEqual(draw(SCENE).calls);
  });

  it("slides the character in and settles it at the column edge", () => {
    const early = images(draw(SCENE, { ...FRAME, elapsedMs: 120 }))[0];
    const settled = images(draw(SCENE, { ...FRAME, elapsedMs: 5_000 }))[0];
    expect(early.x).toBeLessThan(settled.x);
    expect(early.alpha).toBeLessThan(1);
    expect(settled.alpha).toBeCloseTo(1, 6);
  });

  it("brings the text in behind the character, not with it", () => {
    // Both arriving on the same frame reads as one block sliding in. The text
    // is deliberately delayed, so at the character's start it is still absent.
    const atStart = draw(SCENE, { ...FRAME, elapsedMs: 40 });
    expect(images(atStart)).toHaveLength(1);
    expect(texts(atStart)).toHaveLength(0);
  });

  it("fades and rises the text rather than snapping it in", () => {
    const mid = texts(draw(SCENE, { ...FRAME, elapsedMs: 300 }))[0];
    const settled = texts(draw(SCENE, { ...FRAME, elapsedMs: 5_000 }))[0];
    expect(mid.alpha).toBeGreaterThan(0);
    expect(mid.alpha).toBeLessThan(1);
    expect(mid.y).toBeGreaterThan(settled.y);
  });

  it("still renders the text when the cutout is missing", () => {
    // A missing image is not a broken frame. Losing the words with it would be.
    const ctx = draw({ ...SCENE, image: null });
    expect(images(ctx)).toHaveLength(0);
    expect(texts(ctx).length).toBeGreaterThan(0);
  });

  it("still renders the character when there is no overlay text", () => {
    for (const text of [null, "", "   "]) {
      const ctx = draw({ ...SCENE, text });
      expect(images(ctx)).toHaveLength(1);
      expect(texts(ctx)).toHaveLength(0);
    }
  });

  it("produces a valid frame with neither a cutout nor text", () => {
    const ctx = draw({ text: null, image: null });
    expect(ctx.calls).toHaveLength(1);
    expect(ctx.calls[0]).toMatchObject({ op: "fillRect" });
  });

  it("keeps the character inside the frame", () => {
    const ctx = draw(SCENE);
    const character = images(ctx)[0];
    expect(character.y).toBeGreaterThanOrEqual(0);
    expect(character.y + character.height).toBeLessThanOrEqual(1080 + 1);
  });
});

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

  it("returns nothing drawable for a degenerate image", () => {
    expect(fitCharacter({ width: 0, height: 100 }, box).width).toBe(0);
    expect(fitCharacter({ width: 100, height: 0 }, box).height).toBe(0);
  });
});

describe("wrapText", () => {
  const ctx = recorder();

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

describe("entrances", () => {
  it("the character arrives from zero to one", () => {
    expect(characterEntrance(0)).toBe(0);
    expect(characterEntrance(-10)).toBe(0);
    expect(characterEntrance(CHARACTER_LEFT_THEME.characterEntranceMs)).toBe(1);
  });

  it("the text waits, then arrives", () => {
    expect(textEntrance(0)).toBe(0);
    expect(textEntrance(CHARACTER_LEFT_THEME.textDelayMs)).toBe(0);
    expect(
      textEntrance(CHARACTER_LEFT_THEME.textDelayMs + CHARACTER_LEFT_THEME.textEntranceMs)
    ).toBe(1);
  });

  it("both are settled well before the shortest possible scene", () => {
    // The planner's floor is 4s. An entrance still running at that point would
    // mean a clip that never settles.
    expect(characterEntrance(4_000)).toBe(1);
    expect(textEntrance(4_000)).toBe(1);
  });
});
