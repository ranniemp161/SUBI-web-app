import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { SAFE_AREA, isPortrait, safeAreaInsets, safeContentBox } from "./layout";
import { drawRenderable, type Renderable } from "./renderable";
import { BRAND } from "./theme";
import { bitmap, images, recorder, texts, type Call, type Recorder } from "./test-recorder";

/**
 * The portrait safe area: spec `broll/0009` AC-196 and AC-197.
 *
 * Reels, Shorts and TikTok paint their own chrome over the bottom and the right
 * of a vertical video, so a word placed there is a word nobody reads. These
 * tests are structural proxies, not judgements: none of them can say whether a
 * frame looks right, only whether anything the platform will cover is being
 * asked to carry meaning.
 */

const PORTRAIT = { width: 1080, height: 1920, elapsedMs: 5_000, durationMs: 6_000 };
const LANDSCAPE = { width: 1920, height: 1080, elapsedMs: 5_000, durationMs: 6_000 };

/**
 * Stand-in bitmaps. `Renderable` asks for a real `ImageBitmap` because that is
 * what the encoder hands it; the layout maths reads a width and a height and
 * nothing else, so the cast buys a fixture rather than hiding a problem.
 */
const CUTOUT = bitmap(686, 1126) as unknown as ImageBitmap;
const OBJECT = bitmap(1024, 1024) as unknown as ImageBitmap;
const WORDS = "the whole point is that a caption bar must never cross a word";

/** One of every template that draws, with enough content to fill a frame. */
const RENDERABLES: Renderable[] = [
  {
    template: "chart-full",
    scene: {
      title: "what the quarter actually did, told at some length",
      type: "bar",
      values: [12, 48, 31, 66, 25],
      labels: ["one", "two", "three", "four", "five"],
      unit: "%",
    },
  },
  { template: "text-card", scene: { text: WORDS } },
  { template: "character-left", scene: { text: WORDS }, image: CUTOUT },
  { template: "character-center", scene: { text: WORDS }, image: CUTOUT },
  { template: "object-full", scene: { text: WORDS }, objectImage: OBJECT },
  { template: "object-left", scene: { text: WORDS }, objectImage: OBJECT },
  {
    template: "character-plus-object",
    scene: { text: WORDS },
    image: CUTOUT,
    objectImage: OBJECT,
  },
];

/**
 * Short words, so greedy wrapping packs each line right up against the width it
 * was given.
 *
 * This matters more than it looks. With ordinary words a line stops one long
 * word short of the limit, and a template that wrapped against the whole frame
 * instead of the safe box would still draw every line inside the reserve by
 * luck, passing the check for the wrong reason. Dense short words leave the
 * wrapper nowhere to hide.
 */
const DENSE = Array(40).fill("an ox in the mud").join(" ");

/** The same scene with different words on it, whatever shape the template is. */
const withText = (renderable: Renderable, text: string): Renderable =>
  ({ ...renderable, scene: { ...renderable.scene, text } }) as Renderable;

const draw = (renderable: Renderable, frame = PORTRAIT): Recorder => {
  const ctx = recorder();
  drawRenderable(ctx, renderable, frame);
  return ctx;
};

/**
 * The width the recorder would have measured for a piece of text in the font it
 * was drawn in, so a line's right hand edge can be checked rather than only its
 * anchor. Mirrors the recorder's own rule, half an em per character.
 */
const inkWidth = (call: Extract<Call, { op: "fillText" }>): number => {
  const size = Number(call.font.match(/(\d+(?:\.\d+)?)px/)?.[1] ?? 10);
  return call.text.length * size * 0.5;
};

/**
 * The marks a template put on the frame, with the ground left out.
 *
 * The backdrop's flat fill and its grid, the scrim and the figure glow are all
 * rectangles too, and every one of them is allowed to reach the frame's edge:
 * they are the ground the marks sit on, and stopping them at the safe area line
 * would draw exactly the visible edge the treatment exists to avoid. A gradient
 * stringifies to an object on the recorder, which is what separates them from a
 * mark painted in a flat brand colour.
 */
const marks = (ctx: Recorder) =>
  ctx.calls.filter(
    (call): call is Extract<Call, { op: "fillRect" | "roundRect" }> =>
      (call.op === "roundRect" ||
        (call.op === "fillRect" &&
          call.style !== BRAND.background &&
          !call.style.startsWith("[object"))) &&
      call.width > 0 &&
      call.height > 0
  );

describe("safeAreaInsets", () => {
  it("reserves nothing in landscape", () => {
    // Nothing covers a 16:9 clip dropped into an NLE, so every landscape frame
    // must be what it was before the reserve existed.
    expect(safeAreaInsets(LANDSCAPE)).toEqual({ bottom: 0, right: 0 });
    expect(safeContentBox(LANDSCAPE)).toEqual({ width: 1920, height: 1080 });
  });

  it("reserves the caption block and the action rail in portrait", () => {
    expect(safeAreaInsets(PORTRAIT)).toEqual({ bottom: 1920 * 0.18, right: 1080 * 0.11 });
    expect(safeContentBox(PORTRAIT)).toEqual({
      width: 1080 * (1 - 0.11),
      height: 1920 * (1 - 0.18),
    });
  });

  it("measures each reserve against its own axis", () => {
    // The bottom is a share of the height and the right a share of the width.
    // Measuring both off the short edge, the way type sizes are measured, would
    // reserve a band with nothing to do with the chrome it is covering.
    const tall = { width: 720, height: 1280 };
    expect(safeAreaInsets(tall).bottom).toBeCloseTo(1280 * SAFE_AREA.bottomRatio, 6);
    expect(safeAreaInsets(tall).right).toBeCloseTo(720 * SAFE_AREA.rightRatio, 6);
  });

  it("treats a square frame as landscape, like every other portrait branch", () => {
    expect(isPortrait({ width: 1080, height: 1080 })).toBe(false);
    expect(safeAreaInsets({ width: 1080, height: 1080 })).toEqual({ bottom: 0, right: 0 });
  });
});

describe("AC-196: nothing that carries meaning enters the reserve", () => {
  const content = safeContentBox(PORTRAIT);

  it.each(RENDERABLES.map((r) => [r.template, r] as const))(
    "%s keeps its words clear of the caption block and the action rail",
    (_template, renderable) => {
      const drawn = texts(draw(renderable));
      expect(drawn.length).toBeGreaterThan(0);

      for (const call of drawn) {
        // The baseline is the one that matters most: the caption block comes up
        // from the bottom, so a line sitting below this is a line nobody reads.
        expect(call.y).toBeLessThanOrEqual(content.height);
        expect(call.x).toBeGreaterThanOrEqual(0);
        expect(call.x).toBeLessThanOrEqual(content.width);
      }
    }
  );

  it.each(
    RENDERABLES.filter((r) => r.template !== "chart-full").map(
      (r) => [r.template, withText(r, DENSE)] as const
    )
  )("%s wraps its lines inside the safe width, not the frame width", (_template, renderable) => {
    // Only the chart is left out, and only because its value and category
    // labels are drawn centred on their bar: the recorder keeps the anchor and
    // not the alignment, so the sum below would be measuring the wrong edge.
    // Every other template hands the cursor a left edge it worked out itself.
    for (const call of texts(draw(renderable))) {
      expect(call.x + inkWidth(call)).toBeLessThanOrEqual(content.width + 1e-6);
    }
  });

  it.each(RENDERABLES.map((r) => [r.template, r] as const))(
    "%s keeps its marks clear of the reserve",
    (_template, renderable) => {
      for (const mark of marks(draw(renderable))) {
        expect(mark.x).toBeGreaterThanOrEqual(0);
        expect(mark.x + mark.width).toBeLessThanOrEqual(content.width + 1e-6);
        expect(mark.y + mark.height).toBeLessThanOrEqual(content.height + 1e-6);
      }
    }
  );

  it("centres a text card in the space the platform leaves, not in the frame", () => {
    // The sweeps above are weakest exactly here. A text card is centred, so a
    // short block still lands clear of the reserve whether or not the reserve
    // was applied, and the check passes for the wrong reason. What actually
    // moved is the centre the block is hung from, so that is what this asserts.
    const card = RENDERABLES.find((r) => r.template === "text-card");
    if (!card) throw new Error("text-card missing from the fixtures");

    const drawn = texts(draw(card));
    expect(drawn.length).toBeGreaterThan(1);

    const middle = (drawn[0].y + drawn[drawn.length - 1].y) / 2;
    expect(middle).toBeLessThan(PORTRAIT.height / 2);
    expect(Math.abs(middle - content.height / 2)).toBeLessThan(content.height * 0.05);
  });

  it("exempts figures, which is the rule that is a judgement rather than a measurement", () => {
    // A caption bar across a character's shins is cosmetic and the shot still
    // reads. Holding the figure to the same margin would shrink every portrait
    // cutout by a fifth or crop it, and `character-left`'s portrait band stands
    // the cutout on the frame edge on purpose so characters share a floor line
    // across scenes. So this asserts the opposite of every test above: the
    // figure does reach into the reserved band, and that is correct.
    const left = RENDERABLES.find((r) => r.template === "character-left");
    if (!left) throw new Error("character-left missing from the fixtures");
    const drawn = images(draw(left));
    expect(drawn).toHaveLength(1);
    expect(drawn[0].y + drawn[0].height).toBeGreaterThan(content.height);
  });

  it("leaves landscape output alone", () => {
    // The reserve is zero at 1920x1080, so the words still run to the frame's
    // own margins. Pinning this stops the safe area quietly shrinking every
    // clip this app has ever rendered.
    expect(safeContentBox(LANDSCAPE)).toEqual({ width: 1920, height: 1080 });

    const card = RENDERABLES.find((r) => r.template === "text-card");
    if (!card) throw new Error("text-card missing from the fixtures");
    expect(texts(draw(card, LANDSCAPE)).length).toBeGreaterThan(0);
  });
});

describe("AC-197: the guide cannot reach an exported frame", () => {
  it("is drawn by the studio, and nothing the encoder imports mentions it", () => {
    // The guarantee is structural rather than conditional. The worker draws
    // through `drawRenderable`, `drawRenderable` reaches only this directory,
    // and nothing in this directory can reach the guide, so there is no path
    // from an encode to it. A `showGuide` flag on the frame object would have
    // been one boolean away from being wrong instead.
    const sources = readdirSync(__dirname).filter(
      (name) => name.endsWith(".ts") && !name.endsWith(".test.ts")
    );
    expect(sources.length).toBeGreaterThan(10);

    for (const name of sources) {
      const source = readFileSync(path.join(__dirname, name), "utf8");
      expect(source).not.toContain("drawSafeAreaGuide");
      expect(source).not.toContain("safe-area-guide");
    }
  });

  it("draws nothing labelled as a guide in any template", () => {
    // The same rule from the other side: a portrait frame's marks are the
    // template's own, and none of them is an annotation about the frame.
    for (const renderable of RENDERABLES) {
      const drawn = texts(draw(renderable));
      expect(drawn.some((call) => call.text.toLowerCase().includes("safe"))).toBe(false);
    }
  });
});
