import { describe, expect, it } from "vitest";
import { toRenderable, type SceneBitmaps } from "./to-renderable";
import { RENDERABLE_TEMPLATES } from "./renderable";
import { LAYOUT_TEMPLATES } from "@/lib/scene-schema";
import type { SceneSummary } from "@/lib/scenes";

/**
 * The mapping three surfaces share, and until now the only piece of the render
 * path with no test at all.
 *
 * **This function is what stops the studio and the encoder disagreeing.** The
 * row still, the detail pane's preview and the worker all go through here and
 * then through `drawRenderable`, so a scene that maps one way for the screen and
 * another way for the file is exactly the bug `broll/0006` centralised this to
 * prevent. Adding the object templates was the first change since, which is why
 * it is finally worth pinning.
 */

function scene(over: Partial<SceneSummary> = {}): SceneSummary {
  return {
    id: "scene-1",
    startMs: 0,
    durationMs: 6_000,
    sourceText: "They built a castle on the hill.",
    visualType: "text",
    emotion: null,
    layoutTemplate: "text-card",
    overlayText: null,
    chart: null,
    chartRejectionReason: null,
    object: null,
    objectRejectionReason: null,
    objectAssetPath: null,
    objectAttempt: 0,
    strength: 0.6,
    included: true,
    origin: "planner",
    userEditedAt: null,
    ...over,
  };
}

const bitmap = (id: string) => ({ id }) as unknown as ImageBitmap;

const CUTOUT = bitmap("cutout");
const ILLUSTRATION = bitmap("illustration");

const EMPTY: SceneBitmaps = { characters: new Map(), objects: new Map() };

const loaded = (over: Partial<SceneBitmaps> = {}): SceneBitmaps => ({
  characters: new Map([["happy", CUTOUT]]),
  objects: new Map([["scene-1", ILLUSTRATION]]),
  ...over,
});

describe("toRenderable", () => {
  it("maps a text card to its words", () => {
    const result = toRenderable(scene({ overlayText: "the castle" }), EMPTY);
    expect(result).toEqual({ template: "text-card", scene: { text: "the castle" } });
  });

  it("falls back to the source line when there is no overlay text", () => {
    // A scene with nothing burned on it still says what it is about, and a blank
    // frame would be worse than the speaker's own words.
    const result = toRenderable(scene(), EMPTY);
    expect(result).toMatchObject({ scene: { text: "They built a castle on the hill." } });
  });

  it("carries the chart's type, not just its numbers", () => {
    // Dropping `type` here once drew every chart as bars, which turned a single
    // statistic into a one bar bar chart.
    const result = toRenderable(
      scene({
        layoutTemplate: "chart-full",
        chart: {
          type: "pie",
          title: "Fuel",
          values: [80, 20],
          labels: ["imported", "refined"],
          unit: "%",
          source_span: { start_char: 0, end_char: 10 },
        },
      }),
      EMPTY
    );
    expect(result).toMatchObject({ template: "chart-full", scene: { type: "pie" } });
  });

  it("refuses a chart template with no chart", () => {
    // The scene whose chart the honesty check dropped. Drawing it would be an
    // empty frame; the studio shows the downgrade note instead.
    expect(toRenderable(scene({ layoutTemplate: "chart-full" }), EMPTY)).toBeNull();
  });

  it("looks a character cutout up by emotion", () => {
    const result = toRenderable(
      scene({ layoutTemplate: "character-left", emotion: "happy" }),
      loaded()
    );
    expect(result).toMatchObject({ template: "character-left", image: CUTOUT });
  });

  it("looks an illustration up by scene id, not by emotion", () => {
    // The whole reason the two maps are separate: a cutout is shared by every
    // scene picking that emotion, an illustration belongs to one scene.
    const result = toRenderable(scene({ layoutTemplate: "object-full" }), loaded());
    expect(result).toMatchObject({ template: "object-full", objectImage: ILLUSTRATION });
  });

  it("renders an object scene before its illustration has decoded", () => {
    // Every object scene is briefly imageless by design: the signed URL is
    // fetched after first paint. Returning null here would blank the row and
    // then fill it, which reads as a flash rather than as loading.
    const result = toRenderable(scene({ layoutTemplate: "object-left" }), EMPTY);
    expect(result).toMatchObject({ template: "object-left", objectImage: null });
  });

  it("gives character-plus-object both images", () => {
    const result = toRenderable(
      scene({ layoutTemplate: "character-plus-object", emotion: "happy" }),
      loaded()
    );
    expect(result).toMatchObject({
      template: "character-plus-object",
      image: CUTOUT,
      objectImage: ILLUSTRATION,
    });
  });

  it("does not hand one scene another scene's illustration", () => {
    const result = toRenderable(
      scene({ id: "scene-2", layoutTemplate: "object-full" }),
      loaded()
    );
    expect(result).toMatchObject({ objectImage: null });
  });

  it("returns null for every template that has no renderer", () => {
    // The two still listed and undrawn. The studio turns this into "has no
    // renderer yet" rather than into a blank canvas.
    const undrawn = LAYOUT_TEMPLATES.filter(
      (template) => !(RENDERABLE_TEMPLATES as readonly string[]).includes(template)
    );
    expect(undrawn.length).toBeGreaterThan(0);
    for (const layoutTemplate of undrawn) {
      expect(toRenderable(scene({ layoutTemplate }), loaded())).toBeNull();
    }
  });

  it("maps every template that does have one", () => {
    // The other half: nothing renderable may fall through to null, or a creator
    // is offered a template that then previews as nothing.
    for (const layoutTemplate of RENDERABLE_TEMPLATES) {
      const mapped = toRenderable(
        scene({
          layoutTemplate,
          emotion: "happy",
          chart: {
            type: "bar",
            title: "t",
            values: [1],
            labels: [],
            unit: null,
            source_span: { start_char: 0, end_char: 1 },
          },
        }),
        loaded()
      );
      expect(mapped, layoutTemplate).not.toBeNull();
      expect(mapped?.template).toBe(layoutTemplate);
    }
  });
});
