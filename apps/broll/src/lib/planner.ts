import "server-only";
import { reportError } from "@repo/server-shared/observability";
import {
  modelSceneSchema,
  buildSceneResponseSchema,
  normalizeModelScene,
  MIN_SCENE_DURATION_MS,
  MAX_SCENE_DURATION_MS,
  type SceneChart,
  type VisualType,
  type LayoutTemplate,
} from "./scene-schema";
import { traceChart } from "./honesty";
import { formatUtterancesForPrompt, type Utterance } from "./utterances";
import type { CharacterEmotion } from "./emotions";

/**
 * The scene planner: one Gemini call, parsed scene by scene, with every chart
 * value traced back to the line it was read from (spec `broll/0003`).
 *
 * Server only because it reads `GEMINI_API_KEY`. The pure pieces this builds on
 * — the utterance merge, the scene schema, the honesty check — live in their own
 * modules so they can be unit tested without a network or a key.
 *
 * Plain `fetch` to the REST API rather than an SDK, matching
 * `apps/rough-cut/src/lib/ai-rough-cut.ts`: one endpoint, one request shape, and
 * a dependency tree and test story that stay trivial.
 */

/**
 * Pinned, never an env var and never a `-latest` alias (spec `0003`, Value
 * sourcing). A model id that can change under the app is a plan whose output
 * shape can change without a deploy, and this route spends money.
 */
export const PLANNER_MODEL = "gemini-3.6-flash";

const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${PLANNER_MODEL}:generateContent`;

/**
 * The transcript ceiling, measured in estimated **input tokens**, because that
 * is what actually bounds the call — not bytes, and not runtime (AC-55).
 *
 * **Provisional and unmeasured** (spec `0003` Follow-up): 250,000 tokens at
 * roughly four characters per token is arithmetic, the same debt
 * `MAX_DOCUMENT_BYTES` already carries in `@repo/transcript`. This is a second,
 * narrower gate than that 5 MB document cap, which is about what can be stored
 * rather than what can be planned.
 */
export const MAX_PLAN_INPUT_TOKENS = 250_000;
const CHARS_PER_TOKEN = 4;

/** Long enough for a real transcript, inside the route's own 300s ceiling. */
const REQUEST_TIMEOUT_MS = 240_000;

/** Which step the run is on, streamed to the client as it moves (AC-52). */
export type PlanPhase = "merging" | "planning" | "validating";

/** A scene as it will be stored: every timing resolved from our own merge. */
export type PlannedScene = {
  startMs: number;
  durationMs: number;
  sourceText: string;
  sourceStartMs: number;
  sourceEndMs: number;
  visualType: VisualType;
  emotion: CharacterEmotion | null;
  layoutTemplate: LayoutTemplate;
  overlayText: string | null;
  chart: SceneChart | null;
  /**
   * Why this scene's chart was dropped, or null (spec `0005` AC-87).
   *
   * Stored on the scene rather than left in the run response, because a scene
   * the planner meant as text and a scene that lost its chart are the same row
   * once `chart` is NULL, so the difference cannot be recovered on a reload.
   */
  chartRejectionReason: string | null;
  strength: number;
  /**
   * Whether this scene starts checked (spec `0005` AC-85). Decided by
   * `applySurplusRule`, and owned by the creator from the moment they see it.
   */
  included: boolean;
};

/** Why one proposed scene, or one chart, did not survive (AC-24, AC-54). */
export type PlanRejection = {
  /** The utterance the model cited, when it named one we could resolve. */
  utteranceIndex: number | null;
  reason: string;
  /** A dropped chart keeps its scene; a rejected scene does not (AC-53). */
  kind: "scene" | "chart";
};

export type PlanResult = {
  scenes: PlannedScene[];
  rejections: PlanRejection[];
};

/** Codes the route turns into a status and a message the user can act on. */
export type PlannerErrorCode =
  | "not_configured"
  | "model_unavailable"
  | "too_long"
  | "failed";

export class PlannerError extends Error {
  readonly code: PlannerErrorCode;

  constructor(code: PlannerErrorCode, message: string) {
    super(message);
    this.name = "PlannerError";
    this.code = code;
  }
}

export function isPlannerConfigured(): boolean {
  return Boolean(process.env.GEMINI_API_KEY);
}

/**
 * How many scenes to aim for: `ceil(runtime_in_minutes × 1.2)` (AC-50).
 *
 * A 9:46 transcript targets about twelve, not seven hundred — the unit is
 * minutes, and spec `0002`'s table had it as seconds, which is the arithmetic
 * this constant exists to keep honest. The multiplier itself is still a guess
 * (spec `0001` open question 5) and is tuned in AC-28.
 *
 * Guidance only. A plan returning more or fewer is accepted; nothing here or in
 * the parser enforces it (AC-60).
 */
export const SCENES_PER_MINUTE = 1.2;

export function sceneCountTarget(durationMs: number): number {
  const minutes = Math.max(0, durationMs) / 60_000;
  return Math.max(1, Math.ceil(minutes * SCENES_PER_MINUTE));
}

/** Roughly four characters per token; deliberately an estimate, see the cap. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

const SYSTEM_INSTRUCTION = `
You plan B-roll cutaways for a talking-head video. You are given the speaker's
own transcript, already merged into whole lines and numbered.

Your job is to pick the lines that are worth cutting away from, and to say what
should be on screen for each one.

THE ONE RULE THAT MATTERS: never invent a number. A chart may only contain
figures the cited line literally contains. If a line quantifies something
vaguely — "most of it", "a huge share", "way down" — there is no chart in it,
and the honest answer is a null chart with a text or character treatment. Every
chart you return is checked in code against the exact characters you cite, and a
chart whose numbers are not found there is discarded. Guessing a plausible
figure does not help the creator; it makes the video wrong under their name.

When you do return a chart, set source_span to the character offsets, into the
cited line's own text, of the words the figures come from. Count characters from
zero at the first character of that line.

Prefer fewer, stronger scenes over covering every line. A line that is pure
connective speech does not need a cutaway.
`.trim();

/** The task and the rules. The output *shape* comes from the schema (AC-23). */
export function buildPlannerPrompt(
  utterances: readonly Utterance[],
  target: number
): string {
  return [
    `Aim for roughly ${target} scenes across this transcript. That is guidance, not a quota:`,
    `returning somewhat more or fewer is fine if the material calls for it.`,
    ``,
    `TRANSCRIPT (one numbered line per utterance, with its timecode):`,
    formatUtterancesForPrompt(utterances),
  ].join("\n");
}

type GeminiResponse = {
  candidates?: {
    content?: { parts?: { text?: string }[] };
    finishReason?: string;
  }[];
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    thoughtsTokenCount?: number;
  };
};

/**
 * Turn a failed HTTP response into an error the user can act on (AC-27).
 *
 * There is deliberately **no separate probe call**. `models.list()` is known to
 * lie (spec `0001` rationale §3), and a probe costs money to answer a question
 * the real call answers anyway — so the real call's own 404 is the availability
 * check, translated here rather than surfaced raw.
 */
function translateFailure(status: number, body: string): PlannerError {
  const mentionsModel = body.includes(PLANNER_MODEL) || body.includes("NOT_FOUND");
  if (status === 404 && mentionsModel) {
    return new PlannerError(
      "model_unavailable",
      `The planner's model (${PLANNER_MODEL}) is no longer available. This needs a code change to pin a current model — it is not something you can fix by retrying.`
    );
  }
  if (status === 429) {
    return new PlannerError(
      "failed",
      "The planner is being rate limited upstream. Try again in a few minutes."
    );
  }
  return new PlannerError("failed", "The planner could not reach the model. Try again.");
}

/**
 * Assemble one stored scene from one model proposal.
 *
 * Everything about *time* is resolved here from the utterance the model cited,
 * never from what the model wrote: `start_ms` is the line's own start, and the
 * only timing the model contributes is how long the cutaway holds, clamped into
 * the window `scene-schema.ts` fixes. A model can misjudge how
 * long a cutaway should run; it cannot misreport where a line sits, because it
 * is never asked to.
 */
function assembleScene(
  parsed: ReturnType<typeof modelSceneSchema.parse>,
  utterance: Utterance,
  rejections: PlanRejection[]
): PlannedScene {
  let chart: SceneChart | null = null;
  // Attributed here, on the scene being assembled, which is stronger than the
  // `utteranceIndex` match spec `0005` asks for and never wrong for the same
  // reason: this *is* the scene whose chart was dropped. Matching afterwards by
  // array position would mis-attach, because `collectScenes` sorts by `startMs`
  // once assembly is done; matching by `utteranceIndex` would still be ambiguous
  // when two scenes cite the same line and both lose a chart.
  let chartRejectionReason: string | null = null;
  if (parsed.chart) {
    const trace = traceChart(parsed.chart, utterance.text);
    if (trace.traced) {
      chart = parsed.chart;
    } else {
      // The scene survives as a text treatment — a bad chart never discards the
      // scene, and an untraceable number is never stored (AC-54).
      chartRejectionReason = trace.reason;
      rejections.push({
        utteranceIndex: utterance.index,
        reason: `chart dropped: ${trace.reason}`,
        kind: "chart",
      });
    }
  }

  return {
    startMs: utterance.startMs,
    durationMs: Math.min(
      MAX_SCENE_DURATION_MS,
      Math.max(MIN_SCENE_DURATION_MS, parsed.duration_ms)
    ),
    sourceText: utterance.text,
    sourceStartMs: utterance.startMs,
    sourceEndMs: utterance.endMs,
    visualType: parsed.visual_type,
    // The column means "which character variant to composite", so it is null
    // whenever there is no character on screen — spec `0002`'s own definition.
    emotion: parsed.visual_type === "character" ? parsed.emotion : null,
    layoutTemplate: parsed.layout_template,
    overlayText: parsed.overlay_text,
    chart,
    chartRejectionReason,
    strength: parsed.strength,
    // Provisional. `applySurplusRule` decides this once the whole plan is in,
    // because "beyond the target" is a fact about the plan, not about a scene.
    included: true,
  };
}

/**
 * Check the strongest scenes up to the planner's own target, and uncheck the
 * rest (AC-85).
 *
 * **Unchecked, never dropped.** A surplus scene is still stored, still listed
 * and still one click from being included — the model proposing more than the
 * target is not evidence that the extras are bad, only that the creator should
 * choose. Dropping them would decide for them and would lose material the
 * planner was paid to find.
 *
 * The tiebreak is `start_ms` ascending, so two scenes the model scored
 * identically resolve by where they sit rather than by the order they happened
 * to arrive in. Without it the same transcript could plan differently twice.
 *
 * **The ranking has no evidence behind it**, exactly like `SCENES_PER_MINUTE`,
 * which is the number it reuses rather than inventing a second one. AC-28's
 * tuning run should revisit both together.
 *
 * Returns the scenes in the order given, so the plan order the rest of the app
 * reads is untouched.
 */
export function applySurplusRule(
  scenes: readonly PlannedScene[],
  target: number
): PlannedScene[] {
  if (scenes.length <= target) {
    return scenes.map((scene) => ({ ...scene, included: true }));
  }

  const keep = new Set(
    scenes
      .map((scene, position) => ({ scene, position }))
      .sort(
        (a, b) =>
          b.scene.strength - a.scene.strength || a.scene.startMs - b.scene.startMs
      )
      .slice(0, target)
      .map((entry) => entry.position)
  );

  return scenes.map((scene, position) => ({ ...scene, included: keep.has(position) }));
}

/**
 * Validate the model's reply one scene at a time (AC-24).
 *
 * Strict about claims, lenient about shape: a single malformed scene is
 * reported and skipped while every valid one is kept. Failing the whole plan
 * because one of twenty scenes named an emotion that does not exist would
 * throw away a good run and a paid call.
 */
export function collectScenes(
  raw: unknown,
  utterances: readonly Utterance[]
): PlanResult {
  const scenes: PlannedScene[] = [];
  const rejections: PlanRejection[] = [];

  if (!Array.isArray(raw)) {
    return {
      scenes,
      rejections: [
        { utteranceIndex: null, reason: "the model did not return a list of scenes", kind: "scene" },
      ],
    };
  }

  for (const candidate of raw) {
    // Fold the model's spellings of "nothing" into the schema's before parsing:
    // lenient about shape, strict about claims.
    const normalized = normalizeModelScene(candidate);
    const parsed = modelSceneSchema.safeParse(normalized);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      const index =
        typeof (normalized as { utterance_index?: unknown })?.utterance_index === "number"
          ? ((normalized as { utterance_index: number }).utterance_index)
          : null;
      rejections.push({
        utteranceIndex: index,
        reason: `${issue?.path.join(".") || "scene"}: ${issue?.message ?? "invalid"}`,
        kind: "scene",
      });

      // The first rejection carries the shape that caused it. Without this, a
      // run where every scene fails reports a count and nothing to act on,
      // which is exactly how the first live run went.
      if (rejections.length === 1) {
        console.log(
          `[broll-plan] first rejected scene: ${JSON.stringify(candidate).slice(0, 600)}`
        );
      }
      continue;
    }

    const utterance = utterances[parsed.data.utterance_index];
    if (!utterance) {
      // A citation of a line that does not exist is not a scene we can place,
      // and it is the one shape the schema cannot catch on its own.
      rejections.push({
        utteranceIndex: parsed.data.utterance_index,
        reason: "cites a transcript line that does not exist",
        kind: "scene",
      });
      continue;
    }

    scenes.push(assembleScene(parsed.data, utterance, rejections));
  }

  // The export order and the list order in one (AC-42).
  scenes.sort((a, b) => a.startMs - b.startMs);
  return { scenes, rejections };
}

/**
 * Run the plan: one streamed phase change, one Gemini call, then validation.
 *
 * Throws `PlannerError` for anything the user should be told about. The caller
 * owns the money, and the refund decision is **scenes committed**, not scenes
 * returned — see the route.
 */
export async function runScenePlan(input: {
  utterances: readonly Utterance[];
  sceneTarget: number;
  onPhase?: (phase: PlanPhase) => void;
}): Promise<PlanResult> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new PlannerError(
      "not_configured",
      "The planner isn't configured on this server."
    );
  }

  const prompt = buildPlannerPrompt(input.utterances, input.sceneTarget);

  input.onPhase?.("planning");

  let response: Response;
  try {
    response = await fetch(GEMINI_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM_INSTRUCTION }] },
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.4,
          responseMimeType: "application/json",
          // Generated from the Zod schema on every call, so the model contract
          // can never be a stale copy of it (AC-23).
          responseSchema: buildSceneResponseSchema(),
        },
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    reportError("Scene planner request failed", error);
    throw new PlannerError(
      "failed",
      "The planner could not reach the model. Try again."
    );
  }

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    const translated = translateFailure(response.status, body);
    reportError("Scene planner rejected by Gemini", new Error(body.slice(0, 500)), {
      status: response.status,
      code: translated.code,
    });
    throw translated;
  }

  const payload = (await response.json()) as GeminiResponse;
  const candidate = payload.candidates?.[0];

  // A truncated reply is a half list, and half a plan silently missing its tail
  // is worse than a failure the user can retry.
  if (candidate?.finishReason && candidate.finishReason !== "STOP") {
    throw new PlannerError(
      "too_long",
      "This transcript produced more of a plan than the model could return in one go. Try a shorter one."
    );
  }

  const text = candidate?.content?.parts?.[0]?.text;
  if (typeof text !== "string") {
    throw new PlannerError("failed", "The planner got an empty answer. Try again.");
  }

  console.log(
    `[broll-plan] usage model=${PLANNER_MODEL} prompt=${payload.usageMetadata?.promptTokenCount ?? "?"} output=${payload.usageMetadata?.candidatesTokenCount ?? "?"} target=${input.sceneTarget}`
  );

  input.onPhase?.("validating");

  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    reportError("Scene planner returned unparseable JSON", error);
    throw new PlannerError("failed", "The planner's answer could not be read. Try again.");
  }

  const result = collectScenes(raw, input.utterances);
  return {
    ...result,
    // Applied to what survived validation, not to what the model returned: a
    // scene that was rejected never had a claim on a slot (AC-85).
    scenes: applySurplusRule(result.scenes, input.sceneTarget),
  };
}
