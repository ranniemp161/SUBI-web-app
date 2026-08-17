import { describe, expect, it } from "vitest";
import {
  MAX_OBJECT_ATTEMPTS,
  OBJECT_ASPECT_RATIO,
  OBJECT_RETRIES,
  OBJECT_TIMEOUT_MS,
  buildObjectPrompt,
} from "./object-prompt";
import { CHARACTER_STYLES } from "./styles";
import { IMAGE_SIZE } from "./character-prompt";

/**
 * The wording is the feature (spec `broll/0008`), so it is asserted rather than
 * intended — the same reason `character-prompt.test.ts` exists.
 *
 * Two properties matter most. The prompt must ask for a background that
 * segments cleanly, because the illustration is cut out in the browser and a
 * cast shadow survives that as a grey smear on the exact edge the composite is
 * judged by. And it must forbid text, because a generated label is words on
 * screen nobody said, in a product whose whole promise is that what is on screen
 * came out of the creator's own talk.
 */

describe("buildObjectPrompt", () => {
  it("asks for the subject it was given, verbatim", () => {
    expect(buildObjectPrompt("a medieval castle", "anime")).toContain("a medieval castle");
  });

  it("trims a subject the model padded with whitespace", () => {
    expect(buildObjectPrompt("  an oil barrel  ", "anime")).toContain("Draw an oil barrel,");
  });

  it("names the project's style, so the object matches the character", () => {
    // The whole reason an illustration is generated rather than pulled from a
    // stock set: it has to look like it belongs beside the creator's character
    // in the same edit.
    expect(buildObjectPrompt("a rocket", "anime")).toContain("anime");
    expect(buildObjectPrompt("a rocket", "3d-render")).toContain("3D render");
  });

  it("has wording for every style a project can be created in", () => {
    // A style with no description here would render an object in whatever the
    // model felt like, beside a character drawn deliberately.
    for (const style of CHARACTER_STYLES) {
      const prompt = buildObjectPrompt("a rocket", style.id);
      expect(prompt.length).toBeGreaterThan(100);
      expect(prompt).toContain("Draw a rocket");
    }
  });

  it("asks for a flat grey background with no shadow and no floor", () => {
    // Each clause is load bearing for the cutout, not tidiness. A gradient, a
    // vignette, a shadow and a floor line all survive background removal as
    // something clinging to the object's edge.
    const prompt = buildObjectPrompt("a castle", "anime");
    expect(prompt).toContain("flat, even light grey background");
    expect(prompt).toContain("no cast shadow");
    expect(prompt).toContain("no floor line");
  });

  it("forbids text, logos and labels", () => {
    // A generated sign is a claim the speaker never made, rendered as though
    // they had.
    const prompt = buildObjectPrompt("a castle", "anime");
    expect(prompt).toContain("Do not include any text");
    expect(prompt).toContain("logos");
  });

  it("forbids people, so an object scene never grows a second character", () => {
    expect(buildObjectPrompt("a castle", "anime")).toContain("Do not include any people");
  });

  it("keeps the whole object inside the frame", () => {
    // The alpha trim crops to the drawing, so an object touching the edge comes
    // back cropped rather than whole.
    const prompt = buildObjectPrompt("a castle", "anime");
    expect(prompt).toContain("whole object");
    expect(prompt).toMatch(/margin of empty space/);
  });
});

describe("image settings", () => {
  it("asks for a square frame, and the API's uppercase size", () => {
    // Square because an object has no reliable orientation — a castle is wide, a
    // rocket is tall. The `K` must be uppercase; the API rejects `1k`.
    expect(OBJECT_ASPECT_RATIO).toBe("1:1");
    expect(IMAGE_SIZE).toBe("1K");
  });

  it("does not re-pin a model of its own", async () => {
    // Two files disagreeing about which image model is pinned is how two code
    // paths quietly start billing at different rates. `character-prompt.ts` owns
    // that decision; this module must not have made a second one.
    const source = await import("./object-prompt");
    expect(source).not.toHaveProperty("DEFAULT_IMAGE_MODEL");
    expect(source).not.toHaveProperty("imageModel");
  });
});

describe("caps", () => {
  it("bounds redraws well above real use and well below a runaway", () => {
    // Not protecting the balance — every draw is charged — but a creator stuck
    // in a loop regenerating one castle at real cost.
    expect(MAX_OBJECT_ATTEMPTS).toBeGreaterThan(3);
    expect(MAX_OBJECT_ATTEMPTS).toBeLessThan(20);
  });

  it("times out faster than a character turn, because a creator is watching", () => {
    // This is one call with a scene pane open, not the sixth of six inside a
    // 300 second route ceiling.
    expect(OBJECT_TIMEOUT_MS).toBeLessThan(40_000);
    expect(OBJECT_RETRIES).toBe(1);
  });
});
