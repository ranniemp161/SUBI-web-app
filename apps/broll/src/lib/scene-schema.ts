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

/** The templates the planner may write, whether or not one renders yet (AC-57). */
export const LAYOUT_TEMPLATES = [
  "character-left",
  "character-center",
  "chart-full",
  "character-plus-chart",
  "text-card",
  "split-compare",
  // Spec `broll/0008`. An object scene draws a generated illustration of the
  // thing the speaker named, in the project's character style.
  "object-full",
  "object-left",
  "character-plus-object",
] as const;

export type LayoutTemplate = (typeof LAYOUT_TEMPLATES)[number];

/**
 * The templates the **planner is allowed to propose**, which is not the same
 * list as the templates that exist.
 *
 * `character-plus-chart` and `split-compare` are planned but have no drawer, so
 * a scene on one of them can never be rendered or exported. Offering them to the
 * model spent a scene slot on something the creator cannot make: on the
 * reference project that was one scene of twelve, permanently stuck showing "no
 * renderer yet". The model does not pick what it is not offered, which is a
 * cheaper fix than two renderers and is undone by deleting one line here the day
 * those renderers land.
 *
 * **Deliberately a literal rather than an import of `RENDERABLE_TEMPLATES`.**
 * That constant lives beside the `switch` in `render/renderable.ts`, which pulls
 * in every template drawer; importing it here would drag canvas drawing code
 * into the planner's server bundle to read one array of strings. The two lists
 * are kept in step by an assertion in `scene-schema.test.ts` instead, which
 * fails the moment a renderer is added or removed without updating this.
 *
 * `LAYOUT_TEMPLATES` stays the full set: `visual_type` derives from it for all
 * six, the PATCH route validates against it, and rows planned before this
 * existed may still hold either of the two.
 */
export const PLANNABLE_TEMPLATES = [
  "character-left",
  "character-center",
  "chart-full",
  "text-card",
  "object-full",
  "object-left",
  "character-plus-object",
] as const;

/**
 * The templates that composite a generated illustration (spec `broll/0008`).
 *
 * **Here rather than in `scene-templates.ts` because the planner needs it.**
 * That module imports `RENDERABLE_TEMPLATES`, which sits beside the `switch` in
 * `render/renderable.ts` and pulls in every template drawer; the planner reads
 * this list to know when a rejected subject has to take its template down with
 * it, and dragging canvas code into the planner's server bundle to answer that
 * is the same trade `PLANNABLE_TEMPLATES` above already refuses.
 * `scene-templates.ts` re-exports it, so there is still one list.
 */
export const OBJECT_TEMPLATES = [
  "object-full",
  "object-left",
  "character-plus-object",
] as const;

export function isObjectTemplate(template: string): boolean {
  return (OBJECT_TEMPLATES as readonly string[]).includes(template);
}

/** The templates that composite a character, and therefore carry an emotion. */
export const CHARACTER_TEMPLATES = [
  "character-left",
  "character-center",
  "character-plus-object",
] as const;

export function isCharacterTemplate(template: string): boolean {
  return (CHARACTER_TEMPLATES as readonly string[]).includes(template);
}

/**
 * Where a scene lands when what it was going to draw did not survive its trace.
 *
 * Words are the one treatment that needs nothing but the line itself, which is
 * what makes it the honest fallback rather than a failure state.
 */
export const FALLBACK_TEMPLATE = "text-card" satisfies (typeof LAYOUT_TEMPLATES)[number];

/** What is actually on screen. Mirrors `broll_scenes.visual_type`. */
export const VISUAL_TYPES = ["character", "infographic", "text", "object"] as const;

export type VisualType = (typeof VISUAL_TYPES)[number];

/**
 * What is on screen, derived from the layout (AC-76).
 *
 * **`visual_type` is never accepted from a client.** Two writable fields
 * encoding the same fact is a contradiction waiting to be stored: a request
 * could say `text-card` and `character` together, and every later reader would
 * have to guess which one meant it.
 *
 * Total over every template, including the two with no renderer, because the
 * planner writes those and a derivation with a hole in it is a derivation that
 * cannot be trusted as one.
 *
 * `character-plus-object` reads as `character` rather than `object`: a frame
 * with the creator in it is a character scene to everyone looking at it, and the
 * object is the prop. The same reading `character-plus-chart` already gets.
 */
export function visualTypeForTemplate(template: LayoutTemplate): VisualType {
  switch (template) {
    case "character-left":
    case "character-center":
    case "character-plus-chart":
    case "character-plus-object":
      return "character";
    case "chart-full":
    case "split-compare":
      return "infographic";
    case "object-full":
    case "object-left":
      return "object";
    default:
      return "text";
  }
}

/**
 * How long a b-roll asset runs. Four to ten seconds.
 *
 * **These two constants are the only home for that window.** The prompt's field
 * description interpolates them, the clamp reads them, and the tests assert
 * against them rather than against literals, so the range can move in one edit.
 * The ceiling went from eight to ten seconds on 2026-08-12 at the engineer's
 * call: b roll is a cutaway, so the number is bounded by what a talking head
 * edit can absorb, not by anything technical.
 *
 * The model proposes a length inside this window and nothing else about
 * timing: a scene's `start_ms` is taken from the utterance it cites, never from
 * the model. A model can misjudge how long a cutaway should hold; it cannot
 * misreport where the line it cited actually sits, because it is never asked.
 */
export const MIN_SCENE_DURATION_MS = 4_000;
export const MAX_SCENE_DURATION_MS = 10_000;

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
 * A concrete thing the speaker named, with the span it was named in.
 *
 * **The sibling of `chartSchema`, and deliberately shaped like it** (spec
 * `broll/0008`). A chart earns its place by tracing its numbers back to the
 * cited line; an object earns its place the same way, one notch lighter — the
 * subject has to be a noun that actually appears in the span. That gate is what
 * stops the app illustrating a castle nobody mentioned, which is the same
 * category of invention as a statistic nobody said, just in pictures.
 *
 * `source_span` holds character offsets rather than a quoted string, for the
 * reason `chartSchema` gives: a model that misquotes its own citation would
 * otherwise be indistinguishable from one that cited nothing.
 */
const objectSchema = z.object({
  subject: z
    .string()
    .min(1)
    .describe(
      "The one concrete, depictable thing the speaker named — 'a medieval castle', " +
        "'an oil barrel', 'a rocket'. Use the speaker's own noun, and keep it to a short " +
        "noun phrase. Never a concept, never a mood, never a named person."
    ),
  source_span: z
    .object({
      start_char: z.int().nonnegative(),
      end_char: z.int().nonnegative(),
    })
    .describe(
      "Character offsets into the cited utterance's text, marking where the speaker named " +
        "that thing. This is checked in code: a subject that cannot be found inside these " +
        "offsets is discarded and the scene falls back to text."
    ),
});

export type SceneObject = z.infer<typeof objectSchema>;

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
  visual_type: z
    .enum(VISUAL_TYPES)
    .describe("Whether this scene is character, infographic, object, or text led."),
  emotion: z
    .enum(CHARACTER_EMOTIONS)
    .nullable()
    .describe("Which character variant to composite. Null on a chart only or text only scene."),
  layout_template: z
    .enum(PLANNABLE_TEMPLATES)
    .describe("Which layout to composite into."),
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
  object: objectSchema
    .nullable()
    .describe(
      "The one concrete thing this line names and asks the viewer to picture, or null. " +
        "Null far more often than not: a line has an object only when the speaker names " +
        "something you could draw, and picking one they did not name is as bad as " +
        "inventing a number. Prefer an object over a plain text card when the line has one."
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

  // Same leniency, same reasoning: an object with no subject, or with nowhere
  // cited to check it against, is not an object. Reading it as "no object" keeps
  // the scene and stores no claim.
  const object = scene.object;
  if (object && typeof object === "object" && !Array.isArray(object)) {
    const o = { ...(object as Record<string, unknown>) };
    const subject = typeof o.subject === "string" ? o.subject.trim() : "";
    const hasSpan = Boolean(o.source_span) && typeof o.source_span === "object";
    if (subject !== "") o.subject = subject;
    scene.object = subject !== "" && hasSpan ? o : null;
  } else {
    scene.object = null;
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
