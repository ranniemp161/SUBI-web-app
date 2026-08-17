import { describe, it, expect } from "vitest";
import {
  modelSceneSchema,
  buildSceneResponseSchema,
  normalizeModelScene,
  LAYOUT_TEMPLATES,
  PLANNABLE_TEMPLATES,
  MIN_SCENE_DURATION_MS,
  MAX_SCENE_DURATION_MS,
} from "./scene-schema";
import { CHARACTER_EMOTIONS } from "./emotions";
import { RENDERABLE_TEMPLATES, isRenderableTemplate } from "./render/renderable";

function validScene() {
  return {
    utterance_index: 3,
    duration_ms: 6000,
    visual_type: "character" as const,
    emotion: "thoughtful" as const,
    layout_template: "character-left" as const,
    overlay_text: "three years",
    chart: null,
    object: null,
    strength: 0.7,
  };
}

describe("modelSceneSchema", () => {
  it("accepts a well formed scene", () => {
    expect(modelSceneSchema.safeParse(validScene()).success).toBe(true);
  });

  it("accepts a chart carrying its source span", () => {
    const scene = {
      ...validScene(),
      visual_type: "infographic" as const,
      layout_template: "chart-full" as const,
      emotion: null,
      chart: {
        type: "bar",
        title: "Fuel imports",
        values: [80],
        labels: ["cut"],
        unit: "%",
        source_span: { start_char: 4, end_char: 30 },
      },
    };

    expect(modelSceneSchema.safeParse(scene).success).toBe(true);
  });

  it("rejects an emotion outside the generated set (AC-24)", () => {
    // The critical test scenario in spec 0003: one malformed scene must be
    // rejectable on its own, not take the whole plan down with it.
    const result = modelSceneSchema.safeParse({ ...validScene(), emotion: "furious" });
    expect(result.success).toBe(false);
  });

  it("rejects an unknown layout template", () => {
    const result = modelSceneSchema.safeParse({
      ...validScene(),
      layout_template: "picture-in-picture",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a strength outside 0 to 1", () => {
    expect(modelSceneSchema.safeParse({ ...validScene(), strength: 1.4 }).success).toBe(false);
  });

  it("rejects a chart with no values", () => {
    const result = modelSceneSchema.safeParse({
      ...validScene(),
      chart: {
        type: "bar",
        title: "Nothing",
        values: [],
        labels: [],
        unit: null,
        source_span: { start_char: 0, end_char: 4 },
      },
    });
    expect(result.success).toBe(false);
  });

  it("accepts a null chart, which is the common and correct answer", () => {
    expect(modelSceneSchema.safeParse({ ...validScene(), chart: null }).success).toBe(true);
  });
});

describe("normalizeModelScene", () => {
  // Every one of these is a shape structured output actually produces for
  // "nothing". The first live run had all 13 scenes rejected, which is what
  // this exists to stop: lenient about shape, strict about claims.
  function parsed(over: Record<string, unknown>) {
    return modelSceneSchema.safeParse(
      normalizeModelScene({ ...validScene(), ...over })
    );
  }

  it("reads an empty chart object as no chart", () => {
    const result = parsed({ chart: {} });
    expect(result.success).toBe(true);
    expect(result.success && result.data.chart).toBeNull();
  });

  it("reads a missing chart key as no chart", () => {
    const scene = { ...validScene() } as Record<string, unknown>;
    delete scene.chart;
    const result = modelSceneSchema.safeParse(normalizeModelScene(scene));

    expect(result.success).toBe(true);
    expect(result.success && result.data.chart).toBeNull();
  });

  it("reads a chart with no values as no chart", () => {
    // Not a chart at all — and dropping it stores no number, so nothing is
    // invented by being forgiving here.
    const result = parsed({
      chart: {
        type: "bar",
        title: "Something",
        values: [],
        labels: [],
        unit: null,
        source_span: { start_char: 0, end_char: 4 },
      },
    });

    expect(result.success).toBe(true);
    expect(result.success && result.data.chart).toBeNull();
  });

  it("reads a chart with no cited span as no chart", () => {
    const result = parsed({
      chart: { type: "bar", title: "T", values: [80], labels: [], unit: "%" },
    });

    expect(result.success).toBe(true);
    expect(result.success && result.data.chart).toBeNull();
  });

  it("reads an empty emotion as null", () => {
    const result = parsed({ emotion: "" });
    expect(result.success).toBe(true);
    expect(result.success && result.data.emotion).toBeNull();
  });

  it("reads an empty overlay_text as null", () => {
    const result = parsed({ overlay_text: "" });
    expect(result.success).toBe(true);
    expect(result.success && result.data.overlay_text).toBeNull();
  });

  it("reads numeric strings as numbers", () => {
    const result = parsed({ duration_ms: "6000", strength: "0.8", utterance_index: "2" });

    expect(result.success).toBe(true);
    expect(result.success && result.data.duration_ms).toBe(6_000);
    expect(result.success && result.data.strength).toBe(0.8);
  });

  it("coerces chart values written as strings, which still get traced", () => {
    const result = parsed({
      chart: {
        type: "bar",
        title: "Fuel",
        values: ["80"],
        labels: ["cut"],
        unit: "%",
        source_span: { start_char: 0, end_char: 30 },
      },
    });

    expect(result.success).toBe(true);
    expect(result.success && result.data.chart?.values).toEqual([80]);
  });

  it("still rejects an emotion that is a real word but not one of ours", () => {
    // Leniency is about spelling "nothing", never about widening the
    // vocabulary the character pipeline has to generate.
    expect(parsed({ emotion: "furious" }).success).toBe(false);
  });

  it("still rejects a value that is a word rather than a number", () => {
    const result = parsed({
      chart: {
        type: "bar",
        title: "Fuel",
        values: ["eighty"],
        labels: ["cut"],
        unit: "%",
        source_span: { start_char: 0, end_char: 30 },
      },
    });

    expect(result.success).toBe(false);
  });

  it("leaves a well formed scene untouched", () => {
    const scene = validScene();
    expect(modelSceneSchema.safeParse(normalizeModelScene(scene)).success).toBe(true);
  });
});

describe("buildSceneResponseSchema", () => {
  const schema = buildSceneResponseSchema();
  const items = schema.items as Record<string, unknown>;
  const properties = items.properties as Record<string, Record<string, unknown>>;

  it("describes an array of scenes", () => {
    expect(schema.type).toBe("array");
    expect(items.type).toBe("object");
  });

  it("carries every field of the Zod schema, and nothing hand written (AC-23)", () => {
    // The point of AC-23: this list is not maintained by hand. If a field is
    // added to `modelSceneSchema`, it appears here and in the model contract
    // with no prose edit anywhere — and this assertion is what proves the
    // derivation is real rather than a coincidence of two copies agreeing.
    expect(Object.keys(properties).sort()).toEqual(
      Object.keys(modelSceneSchema.shape).sort()
    );
  });

  it("passes the enums through, so the model is told the vocabulary", () => {
    // **This used to assert `LAYOUT_TEMPLATES` and the change is deliberate.**
    // The model is told the templates it may propose, which is the subset that
    // has a renderer — offering `split-compare` or `character-plus-chart` spent
    // a scene slot on something the creator could never export. The full list
    // still governs `visual_type`, the PATCH route, and rows already planned.
    expect(properties.layout_template.enum).toEqual([...PLANNABLE_TEMPLATES]);
    expect(properties.emotion.enum ?? []).toEqual(
      expect.arrayContaining([...CHARACTER_EMOTIONS])
    );
  });

  it("carries the field descriptions, which live only in the Zod schema", () => {
    expect(String(properties.chart.description)).toContain("inventing a number");
    expect(String(properties.duration_ms.description)).toContain(
      String(MIN_SCENE_DURATION_MS)
    );
    expect(String(properties.duration_ms.description)).toContain(
      String(MAX_SCENE_DURATION_MS)
    );
  });

  it("marks the nullable fields nullable rather than omitting them", () => {
    expect(properties.chart.nullable).toBe(true);
    expect(properties.emotion.nullable).toBe(true);
    expect(properties.overlay_text.nullable).toBe(true);
  });

  it("strips the JSON Schema keywords Gemini's OpenAPI subset does not accept", () => {
    const serialized = JSON.stringify(schema);
    expect(serialized).not.toContain("$schema");
    expect(serialized).not.toContain("additionalProperties");
    expect(serialized).not.toContain("exclusiveMinimum");
  });
});

describe("PLANNABLE_TEMPLATES", () => {
  it("is exactly the set that has a renderer", () => {
    // The link between two lists that deliberately do not import each other:
    // `RENDERABLE_TEMPLATES` sits beside the drawing `switch` and pulls in every
    // template drawer, which has no business in the planner's server bundle.
    // This assertion is what stops them drifting — add a renderer without
    // adding it here and the planner will never propose it.
    expect([...PLANNABLE_TEMPLATES].sort()).toEqual([...RENDERABLE_TEMPLATES].sort());
  });

  it("offers the model no template it cannot render", () => {
    // The actual guarantee. A scene the model proposes must be one a creator can
    // export, or the slot is wasted on something permanently stuck.
    for (const template of PLANNABLE_TEMPLATES) {
      expect(isRenderableTemplate(template)).toBe(true);
    }
  });

  it("is a subset of the full template list, not a replacement for it", () => {
    // `visual_type` derives over all six, the PATCH route validates against all
    // six, and rows planned before this existed may hold either of the other two.
    for (const template of PLANNABLE_TEMPLATES) {
      expect(LAYOUT_TEMPLATES).toContain(template);
    }
    expect(PLANNABLE_TEMPLATES.length).toBeLessThan(LAYOUT_TEMPLATES.length);
  });
});
