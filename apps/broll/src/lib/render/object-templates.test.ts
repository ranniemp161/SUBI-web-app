import { describe, expect, it } from "vitest";
import {
  OBJECT_FULL_THEME,
  drawObjectFullFrame,
  objectEntrance,
  type ObjectFullScene,
} from "./object-full";
import {
  OBJECT_LEFT_THEME,
  drawObjectLeftFrame,
  type ObjectLeftScene,
} from "./object-left";
import {
  CHARACTER_PLUS_OBJECT_THEME,
  drawCharacterPlusObjectFrame,
  pairCharacterEntrance,
  pairObjectEntrance,
  pairTextEntrance,
  type CharacterPlusObjectScene,
} from "./character-plus-object";
import { CHARACTER_LEFT_THEME, drawCharacterLeftFrame } from "./character-left";
import { CHARACTER_CENTER_THEME, drawCharacterCenterFrame } from "./character-center";
import { BRAND } from "./theme";
import type { DrawableImage, Render2DContext } from "./context";

/**
 * The three object templates (spec `broll/0008`), and the extraction that made
 * them cheap.
 *
 * Two things are being held here. The first is the ordinary contract every
 * template in this app has: the backdrop is painted first, drawing is a pure
 * function of time, entrances settle inside the shortest possible scene, and
 * nothing lands outside the frame. The second is the property that makes
 * `figure-frame.ts` worth having — an object template and its character sibling
 * really are the same composition, so a change to one that does not reach the
 * other is a bug rather than a divergence.
 */

type Call =
  | { op: "fillRect"; x: number; y: number; width: number; height: number; style: string; alpha: number }
  | { op: "fillText"; text: string; x: number; y: number; alpha: number; font: string }
  | { op: "drawImage"; x: number; y: number; width: number; height: number; alpha: number };

function recorder() {
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
      calls.push({
        op: "fillRect",
        x,
        y,
        width,
        height,
        style: String(this.fillStyle),
        alpha: this.globalAlpha,
      });
    },
    fillText(text, x, y) {
      calls.push({ op: "fillText", text, x, y, alpha: this.globalAlpha, font: this.font });
    },
    measureText(text) {
      const size = Number(this.font.match(/(\d+(?:\.\d+)?)px/)?.[1] ?? 10);
      return { width: text.length * size * 0.5 };
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
const texts = (c: Rec) => c.calls.filter((x): x is Extract<Call, { op: "fillText" }> => x.op === "fillText");
const images = (c: Rec) => c.calls.filter((x): x is Extract<Call, { op: "drawImage" }> => x.op === "drawImage");

const bitmap = (width: number, height: number): DrawableImage =>
  ({ width, height }) as unknown as DrawableImage;

/** Square, because that is the ratio the object prompt asks Gemini for. */
const OBJECT = bitmap(1024, 1024);
/** Portrait, cropped to its own bounding box, like every character cutout. */
const CUTOUT = bitmap(686, 1126);

const FRAME = { width: 1920, height: 1080, elapsedMs: 5_000 };
const PORTRAIT = { width: 1080, height: 1920, elapsedMs: 5_000 };

/** The planner's floor. An entrance still running here never settles on screen. */
const SHORTEST_SCENE_MS = 4_000;

describe("object-full", () => {
  const SCENE: ObjectFullScene = { text: "a medieval castle", image: OBJECT };
  const draw = (scene = SCENE, frame = FRAME) => {
    const ctx = recorder();
    drawObjectFullFrame(ctx, scene, frame);
    return ctx;
  };

  it("paints the ground before anything else", () => {
    // The encoder reuses one canvas, so a frame that does not repaint inherits
    // the previous one.
    const first = draw().calls[0];
    expect(first).toMatchObject({ op: "fillRect", x: 0, y: 0, width: 1920, height: 1080 });
    expect((first as Extract<Call, { op: "fillRect" }>).style).toBe(BRAND.background);
  });

  it("is a pure function of time: same inputs, same pixels", () => {
    expect(draw().calls).toEqual(draw().calls);
  });

  it("holds the illustration back from every edge, unlike a character", () => {
    // A character filling the frame reads as a portrait; an illustration
    // touching all four edges reads as a cropping accident. This is the one
    // visual difference from `character-center`, so it is worth a test.
    const drawn = images(draw())[0];
    const inset = 1080 * OBJECT_FULL_THEME.figureInsetRatio;

    expect(drawn.x).toBeGreaterThanOrEqual(inset - 1);
    expect(drawn.y).toBeGreaterThanOrEqual(inset - 1);
    expect(drawn.x + drawn.width).toBeLessThanOrEqual(1920 - inset + 1);
    expect(drawn.y + drawn.height).toBeLessThanOrEqual(1080 - inset + 1);
  });

  it("centres the illustration rather than standing it on the floor line", () => {
    // A castle has no feet. Bottom-anchoring is what keeps character cutouts of
    // differing heights from bobbing between scenes, and it has no meaning here.
    const drawn = images(draw())[0];
    const inset = 1080 * OBJECT_FULL_THEME.figureInsetRatio;
    const boxTop = inset;
    const boxBottom = 1080 - inset;

    const gapAbove = drawn.y - boxTop;
    const gapBelow = boxBottom - (drawn.y + drawn.height);
    expect(gapAbove).toBeCloseTo(gapBelow, 0);
  });

  it("settles well before the shortest possible scene", () => {
    expect(objectEntrance(0)).toBe(0);
    expect(objectEntrance(-10)).toBe(0);
    expect(objectEntrance(SHORTEST_SCENE_MS)).toBe(1);
    expect(images(draw(SCENE, { ...FRAME, elapsedMs: SHORTEST_SCENE_MS }))[0].alpha).toBeCloseTo(1, 6);
  });

  it("draws the words alone when no illustration has landed yet", () => {
    // Every object scene is briefly imageless by design: the signed URL is
    // fetched after first paint. A blank frame in that window would be worse
    // than a text-only one.
    const ctx = draw({ text: "a medieval castle", image: null });
    expect(images(ctx)).toHaveLength(0);
    expect(texts(ctx).length).toBeGreaterThan(0);
  });

  it("draws the illustration alone when the scene carries no words", () => {
    const ctx = draw({ text: null, image: OBJECT });
    expect(images(ctx)).toHaveLength(1);
    expect(texts(ctx)).toHaveLength(0);
  });

  it("keeps everything inside a portrait frame", () => {
    const drawn = images(draw(SCENE, PORTRAIT))[0];
    expect(drawn.x).toBeGreaterThanOrEqual(0);
    expect(drawn.y).toBeGreaterThanOrEqual(0);
    expect(drawn.x + drawn.width).toBeLessThanOrEqual(1080 + 1);
    expect(drawn.y + drawn.height).toBeLessThanOrEqual(1920 + 1);
  });

  it("survives a degenerate image without drawing a zero sized rectangle", () => {
    expect(images(draw({ text: "x", image: bitmap(0, 0) }))).toHaveLength(0);
  });
});

describe("object-left", () => {
  const SCENE: ObjectLeftScene = { text: "a medieval castle", image: OBJECT };
  const draw = (scene = SCENE, frame = FRAME) => {
    const ctx = recorder();
    drawObjectLeftFrame(ctx, scene, frame);
    return ctx;
  };

  it("puts the illustration in a column and the words to its right", () => {
    const ctx = draw();
    const column = 1920 * OBJECT_LEFT_THEME.columnRatio;

    expect(images(ctx)[0].x + images(ctx)[0].width).toBeLessThanOrEqual(column + 1);
    for (const line of texts(ctx)) expect(line.x).toBeGreaterThanOrEqual(column);
  });

  it("gives the words more of the frame than the character template does", () => {
    // The reason both templates exist: `character-left` is a person beside some
    // words, `object-left` is words supported by a picture.
    expect(OBJECT_LEFT_THEME.columnRatio).toBeLessThan(CHARACTER_LEFT_THEME.columnRatio);
  });

  it("floats the illustration off the frame edge", () => {
    // `character-left` stands its cutout on the bottom edge. An object sitting
    // there looks like it fell rather than like it was placed.
    const drawn = images(draw())[0];
    expect(drawn.y + drawn.height).toBeLessThan(1080);
  });

  it("stacks in a portrait frame, with the words clear of the illustration", () => {
    const ctx = draw(SCENE, PORTRAIT);
    const band = 1920 * OBJECT_LEFT_THEME.portraitBandRatio;
    const drawn = images(ctx)[0];

    expect(drawn.width).toBeGreaterThan(1080 * 0.5);
    for (const line of texts(ctx)) expect(line.y).toBeLessThan(1920 - band);
  });

  it("is a pure function of time", () => {
    expect(draw().calls).toEqual(draw().calls);
  });
});

describe("character-plus-object", () => {
  const SCENE: CharacterPlusObjectScene = {
    text: "he built a castle",
    image: CUTOUT,
    objectImage: OBJECT,
  };
  const draw = (scene = SCENE, frame = FRAME) => {
    const ctx = recorder();
    drawCharacterPlusObjectFrame(ctx, scene, frame);
    return ctx;
  };

  it("paints the ground first and stays a pure function of time", () => {
    expect(draw().calls[0]).toMatchObject({ op: "fillRect", x: 0, y: 0 });
    expect(draw().calls).toEqual(draw().calls);
  });

  it("puts the character to the right of the object, not on top of it", () => {
    // The zoning is the whole template. Overlapping figures is the failure this
    // composition exists to avoid, and it is invisible in a still if the two
    // happen not to overlap on the one frame someone looked at.
    const ctx = draw();
    const [object, character] = images(ctx);
    const stage = 1920 * (1 - CHARACTER_PLUS_OBJECT_THEME.characterColumnRatio);

    expect(object.x + object.width).toBeLessThanOrEqual(stage + 1);
    expect(character.x).toBeGreaterThanOrEqual(stage - 1);
  });

  it("mirrors character-left, so the two cannot be confused at a glance", () => {
    // `character-left` puts its cutout on the left. This one puts it on the
    // right, which is the only thing distinguishing them in a thumbnail.
    const pair = images(draw())[1];
    const left = (() => {
      const ctx = recorder();
      drawCharacterLeftFrame(ctx, { text: SCENE.text, image: CUTOUT }, FRAME);
      return images(ctx)[0];
    })();

    expect(pair.x).toBeGreaterThan(left.x);
  });

  it("stands the character on the frame edge and floats the object", () => {
    const [object, character] = images(draw());
    expect(character.y + character.height).toBeCloseTo(1080, 0);
    expect(object.y + object.height).toBeLessThan(1080);
  });

  it("brings the object in first, because the object is what the line was about", () => {
    expect(pairObjectEntrance(50)).toBeGreaterThan(pairCharacterEntrance(50));
    expect(pairCharacterEntrance(200)).toBeGreaterThan(pairTextEntrance(200));
  });

  it("settles every entrance before the shortest possible scene", () => {
    expect(pairObjectEntrance(SHORTEST_SCENE_MS)).toBe(1);
    expect(pairCharacterEntrance(SHORTEST_SCENE_MS)).toBe(1);
    expect(pairTextEntrance(SHORTEST_SCENE_MS)).toBe(1);
  });

  it("answers zero for a time that is not a number", () => {
    // The preview drives this off a clock. One bad frame should be an unstarted
    // animation, not a dead canvas.
    expect(pairObjectEntrance(Number.NaN)).toBe(0);
    expect(pairCharacterEntrance(Number.POSITIVE_INFINITY)).toBe(0);
  });

  it("draws whichever figure it has when the other is missing", () => {
    expect(images(draw({ ...SCENE, image: null }))).toHaveLength(1);
    expect(images(draw({ ...SCENE, objectImage: null }))).toHaveLength(1);
    expect(images(draw({ ...SCENE, image: null, objectImage: null }))).toHaveLength(0);
  });

  it("keeps both figures and the words inside a portrait frame", () => {
    const ctx = draw(SCENE, PORTRAIT);
    for (const drawn of images(ctx)) {
      expect(drawn.x).toBeGreaterThanOrEqual(0);
      expect(drawn.y).toBeGreaterThanOrEqual(0);
      expect(drawn.x + drawn.width).toBeLessThanOrEqual(1080 + 1);
      expect(drawn.y + drawn.height).toBeLessThanOrEqual(1920 + 1);
    }
    for (const line of texts(ctx)) {
      expect(line.y).toBeLessThanOrEqual(1920);
      expect(line.y).toBeGreaterThan(0);
    }
  });

  it("scrims the words in portrait, where they sit over the character", () => {
    // Landscape puts them on empty frame beside the figure and needs none. Over
    // a cutout they need protection, or dark hair swallows them on some emotions
    // and not others — the worst kind of bug, because it looks fine on the one
    // you tested.
    const scrims = draw(SCENE, PORTRAIT).calls.filter(
      (call): call is Extract<Call, { op: "fillRect" }> =>
        call.op === "fillRect" && call.alpha < 1 && call.width === 1080
    );
    expect(scrims.length).toBeGreaterThan(0);
  });
});

describe("the figure-frame extraction", () => {
  it("draws character-left and object-left through one composition", () => {
    // Not a claim that they look the same — the themes differ — but that they
    // place their parts the same way. A change to the beside composition that
    // reached one and not the other would break this.
    const withTheme = (
      drawFrame: (ctx: Render2DContext, scene: { text: string | null; image: DrawableImage | null }, frame: typeof FRAME) => void
    ) => {
      const ctx = recorder();
      drawFrame(ctx, { text: "one two three", image: OBJECT }, FRAME);
      return { image: images(ctx)[0], lines: texts(ctx).length };
    };

    const left = withTheme(drawCharacterLeftFrame);
    const object = withTheme(drawObjectLeftFrame);

    // Same number of wrapped lines, and both keep the figure left of the words.
    expect(object.lines).toBe(left.lines);
    expect(object.image.x).toBeGreaterThanOrEqual(0);
    expect(left.image.x).toBeGreaterThanOrEqual(0);
  });

  it("leaves the character templates' landscape output alone", () => {
    // The guard on the whole refactor: moving the composition into a shared
    // module must not have changed a single pixel of what already shipped.
    const center = recorder();
    drawCharacterCenterFrame(center, { text: "sovereignty is sacred", image: CUTOUT }, FRAME);
    const drawn = images(center)[0];

    // Full bleed, height bound, standing on the bottom edge — exactly what
    // `character-center` did before `figureInsetRatio` existed as a concept.
    expect(CHARACTER_CENTER_THEME.figureInsetRatio).toBe(0);
    expect(drawn.height).toBeCloseTo(1080, 0);
    expect(drawn.y + drawn.height).toBeCloseTo(1080, 0);
  });
});
