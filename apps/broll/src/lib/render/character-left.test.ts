import { describe, expect, it } from "vitest";
import {
  CHARACTER_LEFT_THEME,
  characterEntrance,
  drawCharacterLeftFrame,
  textEntrance,
  type CharacterLeftScene,
} from "./character-left";
import type { DrawableImage } from "./context";
import { bitmap, images, recorder, texts } from "./test-recorder";

/** Matches a real stored cutout: portrait, cropped to its own bounding box. */
const CUTOUT: DrawableImage = bitmap(686, 1126);

const SCENE: CharacterLeftScene = {
  text: "that Trump agreement does not bind us",
  image: CUTOUT,
};

const FRAME = { width: 1920, height: 1080, elapsedMs: 5_000 };


const draw = (scene: CharacterLeftScene, frame = FRAME) => {
  const ctx = recorder({ charWidth: 10 });
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
    // The frame is fully painted rather than left transparent, and carries
    // nothing but the backdrop. Asserted as a property rather than a call count:
    // the ground is a black fill plus the brand grid, so counting calls made this
    // test a check on how many grid lines a 1920x1080 frame happens to have.
    expect(images(ctx)).toHaveLength(0);
    expect(texts(ctx)).toHaveLength(0);
    const ground = ctx.calls[0];
    expect(ground).toMatchObject({ op: "fillRect", x: 0, y: 0, width: 1920, height: 1080 });
    expect(ctx.calls[0]).toMatchObject({ op: "fillRect" });
  });

  it("keeps the character inside the frame", () => {
    const ctx = draw(SCENE);
    const character = images(ctx)[0];
    expect(character.y).toBeGreaterThanOrEqual(0);
    expect(character.y + character.height).toBeLessThanOrEqual(1080 + 1);
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

// ---------------------------------------------------------------------------
// Portrait. `character-left` is the only template that changes composition with
// orientation, because it is the only one whose whole idea is a side by side
// split — and a 9:16 frame has no side to put anything on.
// ---------------------------------------------------------------------------

const PORTRAIT = { width: 1080, height: 1920, elapsedMs: 5_000 };

describe("character-left in a portrait frame", () => {
  it("stacks: the character stands on the bottom edge, the words sit above it", () => {
    const drawn = images(draw(SCENE, PORTRAIT))[0];
    const band = 1920 * CHARACTER_LEFT_THEME.portraitCharacterBandRatio;

    expect(drawn.y + drawn.height).toBeCloseTo(1920, 0);
    // Every word is clear of the band the character occupies.
    for (const line of texts(draw(SCENE, PORTRAIT))) {
      expect(line.y).toBeLessThan(1920 - band);
    }
  });

  it("gives the character the whole frame width to fit into, not 40% of it", () => {
    // The bug this template was reshaped for: 0.4 * 1080 is a 432px column
    // beside a 1920px tall frame, which strands a small figure in a mostly
    // empty one.
    const drawn = images(draw(SCENE, PORTRAIT))[0];
    expect(drawn.width).toBeGreaterThan(1080 * 0.6);
    expect(drawn.x + drawn.width / 2).toBeCloseTo(540, 0);
  });

  it("travels in from below rather than from the side", () => {
    // Sliding horizontally under a stacked layout reads as a mistake, not a
    // move. Landscape keeps its horizontal slide; this asserts they differ.
    const early = images(draw(SCENE, { ...PORTRAIT, elapsedMs: 120 }))[0];
    const settled = images(draw(SCENE, PORTRAIT))[0];
    expect(early.y).toBeGreaterThan(settled.y);
    expect(early.x).toBeCloseTo(settled.x, 0);
  });

  it("sizes the words off the short edge, so they are not capped by the long one", () => {
    // The ratio is a share of the short edge in both orientations. Off the
    // height, 0.085 would set 163px type inside a 1080px wide frame.
    // This recorder does not carry the font per call, and the template sets it
    // once before filling, so the context holds it after the draw.
    const sizeOf = (frame: typeof FRAME) =>
      Number(draw(SCENE, frame).font.match(/(\d+(?:\.\d+)?)px/)?.[1]);

    expect(sizeOf(PORTRAIT)).toBeCloseTo(1080 * CHARACTER_LEFT_THEME.textSizeRatio, 0);
    // The short edge is the height in landscape, so that case is unchanged.
    expect(sizeOf(FRAME)).toBeCloseTo(1080 * CHARACTER_LEFT_THEME.textSizeRatio, 0);
  });

  it("leaves landscape composition untouched", () => {
    // The guard on the whole change: a landscape frame must draw exactly what it
    // drew before orientation existed as a concept.
    const drawn = images(draw(SCENE, FRAME))[0];
    expect(drawn.x).toBeLessThan(1920 * CHARACTER_LEFT_THEME.characterColumnRatio);
    for (const line of texts(draw(SCENE, FRAME))) {
      expect(line.x).toBeGreaterThanOrEqual(1920 * CHARACTER_LEFT_THEME.characterColumnRatio);
    }
  });
});
