import { z } from "zod";
import { CHARACTER_EMOTIONS } from "./emotions";

/**
 * The scene contract: one Zod schema, and the model's output shape derived from
 * it (spec `broll/0003` AC-23).
 *
 * **One schema, two consumers.** The same object below parses the model's reply
 * *and* generates the `responseSchema` sent to Gemini, so adding a field here
 * changes what the model is asked for with no prose to keep in step. There is
 * deliberately no hand written copy of this shape anywhere in the prompt — a
 * second copy is how a schema and a prompt drift apart in silence.
 *
 * Pure: no database, no network, no `server-only`. The scene list renders these
 * types in the browser.
 */

/** The six templates the planner may write, whether or not one renders yet (AC-57). */
export const LAYOUT_TEMPLATES = [
  "character-left",
  "character-center",
  "chart-full",
  "character-plus-chart",
  "text-card",
  "split-compare",
] as const;

export type LayoutTemplate = (typeof LAYOUT_TEMPLATES)[number];

/** What is actually on screen. Mirrors `broll_scenes.visual_type`. */
export const VISUAL_TYPES = ["character", "infographic", "text"] as const;

export type VisualType = (typeof VISUAL_TYPES)[number];

/**
 * How long a b-roll asset runs. Four to eight seconds, fixed in spec
 * `broll/0002`'s column table.
 *
 * The model proposes a length inside this window and nothing else about
 * timing: a scene's `start_ms` is taken from the utterance it cites, never from
 * the model. A model can misjudge how long a cutaway should hold; it cannot
 * misreport where the line it cited actually sits, because it is never asked.
 */
export const MIN_SCENE_DURATION_MS = 4_000;
export const MAX_SCENE_DURATION_MS = 8_000;

/**
 * A quantified claim lifted from one line, with the span it was read out of.
 *
 * `source_span` holds character offsets into the **cited utterance's text**, not
 * a quoted string. Offsets rather than a quotation because a model that
 * misquotes its own citation would otherwise be indistinguishable from one that
 * cited nothing at all, and both would silently cost a real chart (AC-54).
 */
const chartSchema = z.object({
  type: z
    .string()
    .min(1)
    .describe(
      "How to draw it, lowercase: bar, line, pie, or a single big number. " +
        "Pick whatever the claim actually is."
    ),
  title: z.string().min(1).describe("A short label for the chart, from the speaker's own framing."),
  values: z
    .array(z.number())
    .min(1)
    .describe("The numbers, in the order they are spoken. Every one must appear in source_span."),
  labels: z
    .array(z.string())
    .describe("One label per value, in the same order. May be empty if the line names none."),
  unit: z
    .string()
    .nullable()
    .describe(
      "The unit as the speaker said it (%, percent, x, million). Null if the line states none. " +
        "Never supply a unit the line does not contain."
    ),
  source_span: z
    .object({
      start_char: z.int().nonnegative(),
      end_char: z.int().nonnegative(),
    })
    .describe(
      "Character offsets into the cited utterance's text, marking the exact words the " +
        "numbers were read from. This is checked in code: values that cannot be found " +
        "inside these offsets are discarded."
    ),
});

/**
 * One proposed scene, exactly as the model returns it.
 *
 * Note what is absent: no timecode, and no source text. Both are resolved from
 * `utterance_index` against the planner's own merge, so the model's job is to
 * choose lines and treatments, never to restate numbers it was given.
 */
export const modelSceneSchema = z.object({
  utterance_index: z
    .int()
    .nonnegative()
    .describe("The [n] of the transcript line this scene illustrates."),
  duration_ms: z
    .int()
    .describe(
      `How long the cutaway should hold, between ${MIN_SCENE_DURATION_MS} and ${MAX_SCENE_DURATION_MS} milliseconds.`
    ),
  visual_type: z.enum(VISUAL_TYPES).describe("Whether this scene is character, infographic, or text led."),
  emotion: z
    .enum(CHARACTER_EMOTIONS)
    .nullable()
    .describe("Which character variant to composite. Null on a chart only or text only scene."),
  layout_template: z.enum(LAYOUT_TEMPLATES).describe("Which layout to composite into."),
  overlay_text: z
    .string()
    .nullable()
    .describe("A few words to burn on screen, or null. Keep it under about eight words."),
  chart: chartSchema
    .nullable()
    .describe(
      "The quantified claim in this line, or null. Null is the right answer far more often " +
        "than not: a line that says 'most of it' or 'a huge share' has no chart in it, and " +
        "inventing a number for one is the single worst thing you can do here."
    ),
  strength: z
    .number()
    .min(0)
    .max(1)
    .describe("How strongly this line calls for a cutaway, 0 to 1."),
});

export type ModelScene = z.infer<typeof modelSceneSchema>;
export type SceneChart = z.infer<typeof chartSchema>;

/** A numeric string is still a number the model read; a word is not. */
function asNumber(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  if (trimmed === "" || !/^-?\d+(\.\d+)?$/.test(trimmed)) return value;
  return Number(trimmed);
}

/**
 * Fold the shapes a model uses for "nothing" into the one the schema means by
 * it, before parsing.
 *
 * **Lenient about shape, strict about claims** — the spec's own invariant 7.
 * Structured output reliably returns `{}` for a nullable object and `""` for a
 * nullable string, and rejecting a whole scene over that spelling throws away a
 * perfectly good suggestion for a reason the creator cannot see or fix. None of
 * this invents anything: an empty chart becomes no chart, which stores no
 * number, and a chart carrying no values is not a chart in the first place. The
 * honesty check (AC-54) still runs on everything that survives, and every real
 * number still has to be found in the line it cited.
 */
export function normalizeModelScene(candidate: unknown): unknown {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    return candidate;
  }
  const scene = { ...(candidate as Record<string, unknown>) };

  scene.utterance_index = asNumber(scene.utterance_index);
  scene.duration_ms = asNumber(scene.duration_ms);
  scene.strength = asNumber(scene.strength);

  // "", "none" and a missing key all mean the same thing here.
  if (scene.emotion === "" || scene.emotion === "none" || scene.emotion === undefined) {
    scene.emotion = null;
  }
  if (scene.overlay_text === "" || scene.overlay_text === undefined) {
    scene.overlay_text = null;
  }

  const chart = scene.chart;
  if (chart && typeof chart === "object" && !Array.isArray(chart)) {
    const c = { ...(chart as Record<string, unknown>) };
    if (c.unit === "" || c.unit === "none" || c.unit === undefined) c.unit = null;
    if (Array.isArray(c.values)) c.values = c.values.map(asNumber);

    // A chart with no numbers, or with nowhere cited to check them against, is
    // not a chart. Storing it as "no chart" is the honest reading, and it keeps
    // the scene.
    const hasValues = Array.isArray(c.values) && c.values.length > 0;
    const hasSpan = Boolean(c.source_span) && typeof c.source_span === "object";
    scene.chart = hasValues && hasSpan ? c : null;
  } else {
    scene.chart = null;
  }

  return scene;
}

/**
 * Gemini's `responseSchema` is an OpenAPI 3.0 subset and rejects, or silently
 * mishandles, the JSON Schema keywords outside it. Zod's own exporter is the
 * derivation (AC-23); this only removes what the API does not accept.
 */
const UNSUPPORTED_KEYS = new Set([
  "$schema",
  "additionalProperties",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "const",
  "default",
  "examples",
  "id",
  "$id",
]);

function stripUnsupported(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(stripUnsupported);
  if (node === null || typeof node !== "object") return node;

  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    if (UNSUPPORTED_KEYS.has(key)) continue;
    out[key] = stripUnsupported(value);
  }
  return out;
}

/**
 * The `responseSchema` payload for the Gemini call, generated from
 * `modelSceneSchema` (AC-23).
 *
 * Built on every call rather than frozen into a constant, so it can never be a
 * stale snapshot of a schema someone has since edited. It is a handful of
 * objects; the cost is nothing next to the call it accompanies.
 */
export function buildSceneResponseSchema(): Record<string, unknown> {
  const scene = z.toJSONSchema(modelSceneSchema, {
    target: "openapi-3.0",
    io: "output",
  });

  return {
    type: "array",
    items: stripUnsupported(scene),
  };
}
