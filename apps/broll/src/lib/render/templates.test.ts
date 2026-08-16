import { describe, expect, it } from "vitest";
import {
  CHARACTER_CENTER_THEME,
  centerCharacterEntrance,
  centerTextEntrance,
  drawCharacterCenterFrame,
  type CharacterCenterScene,
} from "./character-center";
import {
  TEXT_CARD_THEME,
  drawTextCardFrame,
  fitTextSize,
  lineEntrance,
  type TextCardScene,
} from "./text-card";
import type { DrawableImage, Render2DContext } from "./context";

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
      // Roughly half an em per character, which is close to a real sans serif.
      // An earlier version charged a tenth of an em and nothing ever wrapped,
      // so the wrapping and shrinking paths were never actually exercised and
      // two tests passed for the wrong reason.
      const size = Number(this.font.match(/(\d+(?:\.\d+)?)px/)?.[1] ?? 10);
      return { width: text.length * size * 0.5 };
    },
    drawImage(_image, dx, dy, dWidth, dHeight) {
      calls.push({ op: "drawImage", x: dx, y: dy, width: dWidth, height: dHeight, alpha: this.globalAlpha });
    },
  };
  return ctx;
}

type Rec = ReturnType<typeof recorder>;
const texts = (c: Rec) => c.calls.filter((x): x is Extract<Call, { op: "fillText" }> => x.op === "fillText");
const rects = (c: Rec) => c.calls.filter((x): x is Extract<Call, { op: "fillRect" }> => x.op === "fillRect");
const images = (c: Rec) => c.calls.filter((x): x is Extract<Call, { op: "drawImage" }> => x.op === "drawImage");

const bitmap = (width: number, height: number): DrawableImage =>
  ({ width, height }) as unknown as DrawableImage;

const CUTOUT = bitmap(686, 1126);
const FRAME = { width: 1920, height: 1080, elapsedMs: 5_000 };

describe("character-center", () => {
  const SCENE: CharacterCenterScene = { text: "sovereignty is sacred", image: CUTOUT };
  const draw = (scene = SCENE, frame = FRAME) => {
    const ctx = recorder();
    drawCharacterCenterFrame(ctx, scene, frame);
    return ctx;
  };

  it("fills the frame height with the character and centres it", () => {
    const drawn = images(draw())[0];
    expect(drawn.height).toBeCloseTo(1080, 0);
    expect(drawn.x + drawn.width / 2).toBeCloseTo(960, 0);
  });

  it("puts a scrim behind the words so they read against any cutout", () => {
    // Without it, a dark jacket swallows the text on some emotions and not
    // others, which looks fine on whichever variant you happened to test.
    const scrims = rects(draw()).filter((r) => r.style === CHARACTER_CENTER_THEME.scrim && r.y > 0);
    expect(scrims.length).toBeGreaterThan(0);
    const scrim = scrims[0];
    expect(scrim.y + scrim.height).toBeCloseTo(1080, 0);
    expect(scrim.alpha).toBeLessThan(1);
  });

  it("does not darken the frame before there is anything to read", () => {
    // The scrim fades in with the words rather than ahead of them.
    const early = rects(draw(SCENE, { ...FRAME, elapsedMs: 60 }));
    expect(early.filter((r) => r.y > 0 && r.style === CHARACTER_CENTER_THEME.scrim)).toHaveLength(0);
  });

  it("renders the character with no text, and the text with no character", () => {
    expect(images(draw({ ...SCENE, text: null }))).toHaveLength(1);
    expect(texts(draw({ ...SCENE, text: null }))).toHaveLength(0);
    expect(images(draw({ ...SCENE, image: null }))).toHaveLength(0);
    expect(texts(draw({ ...SCENE, image: null })).length).toBeGreaterThan(0);
  });

  it("paints a valid frame with neither", () => {
    const ctx = draw({ text: null, image: null });
    // The frame is fully painted rather than left transparent, and carries
    // nothing but the backdrop. Asserted as a property rather than a call count:
    // the ground is a black fill plus the brand grid, so counting calls made this
    // test a check on how many grid lines a 1920x1080 frame happens to have.
    expect(images(ctx)).toHaveLength(0);
    expect(texts(ctx)).toHaveLength(0);
    expect(ctx.calls[0]).toMatchObject({ op: "fillRect", x: 0, y: 0, width: 1920, height: 1080 });
  });

  it("is a pure function of time", () => {
    expect(draw().calls).toEqual(draw().calls);
  });

  it("settles both entrances before the shortest scene", () => {
    expect(centerCharacterEntrance(4_000)).toBe(1);
    expect(centerTextEntrance(4_000)).toBe(1);
    expect(centerCharacterEntrance(0)).toBe(0);
    expect(centerTextEntrance(0)).toBe(0);
  });
});

describe("text-card", () => {
  const LINE = "all of Lebanon must burn for every tear of an Israeli mother";
  const SCENE: TextCardScene = { text: LINE };
  const draw = (scene = SCENE, frame = FRAME) => {
    const ctx = recorder();
    drawTextCardFrame(ctx, scene, frame);
    return ctx;
  };

  it("draws every word of the line across its lines", () => {
    const joined = texts(draw()).map((t) => t.text).join(" ");
    for (const word of LINE.split(" ")) expect(joined).toContain(word);
  });

  it("shrinks long text to fit rather than overflowing", () => {
    const size = (c: Rec) => Number(texts(c)[0].font.match(/(\d+(?:\.\d+)?)px/)?.[1]);
    const short = draw({ text: "burn" });
    const long = draw({ text: LINE.repeat(6) });
    expect(size(long)).toBeLessThan(size(short));
  });

  it("sizes against the frame, not the margin inset box", () => {
    // The theme states its ratios as shares of frame height. Deriving them from
    // the inset box instead made every card smaller than documented.
    const size = Number(texts(draw({ text: "burn" }))[0].font.match(/(\d+(?:\.\d+)?)px/)?.[1]);
    expect(size).toBeCloseTo(1080 * TEXT_CARD_THEME.maxTextSizeRatio, 6);
  });

  it("never shrinks below the readable floor, even for absurd input", () => {
    const ctx = draw({ text: "word ".repeat(400) });
    const size = Number(texts(ctx)[0].font.match(/(\d+(?:\.\d+)?)px/)?.[1]);
    expect(size).toBeGreaterThanOrEqual(1080 * TEXT_CARD_THEME.minTextSizeRatio - 1e-6);
  });

  it("staggers the lines so the block reads in", () => {
    const early = draw(SCENE, { ...FRAME, elapsedMs: 30 });
    const settled = draw(SCENE, { ...FRAME, elapsedMs: 5_000 });
    expect(texts(early).length).toBeLessThan(texts(settled).length);
  });

  it("paints a valid frame for empty or missing text", () => {
    for (const text of [null, "", "   "] as const) {
      const ctx = draw({ text });
      expect(texts(ctx)).toHaveLength(0);
      expect(ctx.calls[0]).toMatchObject({ op: "fillRect", x: 0, y: 0, width: 1920, height: 1080 });
    }
  });

  it("is a pure function of time", () => {
    expect(draw().calls).toEqual(draw().calls);
  });
});

describe("fitTextSize", () => {
  it("returns the lines it measured, so the caller does not wrap twice", () => {
    const ctx = recorder();
    const { lines, size } = fitTextSize(
      ctx,
      "one two three four five",
      { width: 400, height: 864 },
      1080
    );
    expect(lines.join(" ")).toBe("one two three four five");
    expect(size).toBeGreaterThan(0);
  });
});

describe("lineEntrance", () => {
  it("delays each line behind the one above it", () => {
    expect(lineEntrance(100, 0)).toBeGreaterThan(lineEntrance(100, 1));
    expect(lineEntrance(0, 3)).toBe(0);
  });

  it("settles every line well before the shortest scene", () => {
    for (let index = 0; index < 10; index += 1) expect(lineEntrance(4_000, index)).toBe(1);
  });
});
