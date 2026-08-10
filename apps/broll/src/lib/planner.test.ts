import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// `planner.ts` carries `import "server-only"`, whose default export throws
// outside Next's react-server condition — stubbed here exactly as
// `projects.test.ts` does.
vi.mock("server-only", () => ({}));
vi.mock("@repo/server-shared/observability", () => ({ reportError: vi.fn() }));

import {
  sceneCountTarget,
  estimateTokens,
  collectScenes,
  buildPlannerPrompt,
  runScenePlan,
  PlannerError,
  PLANNER_MODEL,
  MAX_PLAN_INPUT_TOKENS,
} from "./planner";
import type { Utterance } from "./utterances";

const utterances: Utterance[] = [
  { index: 0, text: "We cut fuel imports by 80% in three years.", startMs: 0, endMs: 5_000 },
  { index: 1, text: "Most of it came from one policy.", startMs: 5_200, endMs: 9_000 },
];

function modelScene(over: Record<string, unknown> = {}) {
  return {
    utterance_index: 0,
    duration_ms: 6_000,
    visual_type: "character",
    emotion: "thoughtful",
    layout_template: "character-left",
    overlay_text: "three years",
    chart: null,
    strength: 0.7,
    ...over,
  };
}

describe("sceneCountTarget (AC-50)", () => {
  it("targets about twelve scenes for a 9:46 transcript, not seven hundred", () => {
    // Project 0620, the real one this was sized against: 586,800ms.
    expect(sceneCountTarget(586_800)).toBe(12);
  });

  it("reads the runtime in minutes, which is the whole correction", () => {
    expect(sceneCountTarget(60_000)).toBe(2);
    expect(sceneCountTarget(600_000)).toBe(12);
  });

  it("never targets zero, however short the transcript", () => {
    expect(sceneCountTarget(0)).toBe(1);
    expect(sceneCountTarget(1_000)).toBe(1);
  });
});

describe("estimateTokens", () => {
  it("estimates at roughly four characters per token", () => {
    expect(estimateTokens("a".repeat(400))).toBe(100);
  });

  it("puts a realistic transcript far under the cap", () => {
    expect(estimateTokens("word ".repeat(20_000))).toBeLessThan(MAX_PLAN_INPUT_TOKENS);
  });
});

describe("buildPlannerPrompt", () => {
  it("states the target as guidance and numbers every line (AC-60)", () => {
    const prompt = buildPlannerPrompt(utterances, 12);

    expect(prompt).toContain("roughly 12 scenes");
    expect(prompt).toContain("guidance, not a quota");
    expect(prompt).toContain("[0] (0:00) We cut fuel imports");
    expect(prompt).toContain("[1] (0:05) Most of it");
  });

  it("does not restate the output shape in prose (AC-23)", () => {
    // The shape is carried entirely by the generated responseSchema. A prose
    // copy here is what AC-23 exists to prevent.
    const prompt = buildPlannerPrompt(utterances, 12);
    expect(prompt).not.toContain("layout_template");
    expect(prompt).not.toContain("visual_type");
  });
});

describe("collectScenes", () => {
  it("keeps the valid scenes when one is malformed (AC-24)", () => {
    const result = collectScenes(
      [modelScene(), modelScene({ emotion: "furious" }), modelScene({ utterance_index: 1 })],
      utterances
    );

    expect(result.scenes).toHaveLength(2);
    expect(result.rejections).toHaveLength(1);
    expect(result.rejections[0]).toMatchObject({ kind: "scene" });
  });

  it("rejects a scene citing a line that does not exist", () => {
    const result = collectScenes([modelScene({ utterance_index: 99 })], utterances);

    expect(result.scenes).toHaveLength(0);
    expect(result.rejections[0]).toMatchObject({
      utteranceIndex: 99,
      reason: expect.stringContaining("does not exist"),
    });
  });

  it("takes every timing from the cited line, never from the model", () => {
    const result = collectScenes([modelScene({ utterance_index: 1 })], utterances);

    expect(result.scenes[0]).toMatchObject({
      startMs: 5_200,
      sourceStartMs: 5_200,
      sourceEndMs: 9_000,
      sourceText: "Most of it came from one policy.",
    });
  });

  it("clamps the model's duration into the four to eight second window", () => {
    const long = collectScenes([modelScene({ duration_ms: 45_000 })], utterances);
    const short = collectScenes([modelScene({ duration_ms: 200 })], utterances);

    expect(long.scenes[0].durationMs).toBe(8_000);
    expect(short.scenes[0].durationMs).toBe(4_000);
  });

  it("keeps a chart whose numbers are in the cited line", () => {
    const result = collectScenes(
      [
        modelScene({
          visual_type: "infographic",
          emotion: null,
          layout_template: "chart-full",
          chart: {
            type: "bar",
            title: "Fuel imports",
            values: [80],
            labels: ["cut"],
            unit: "%",
            source_span: { start_char: 0, end_char: 41 },
          },
        }),
      ],
      utterances
    );

    expect(result.scenes[0].chart).not.toBeNull();
    expect(result.rejections).toHaveLength(0);
  });

  it("drops an untraceable chart but keeps its scene (AC-54)", () => {
    const result = collectScenes(
      [
        modelScene({
          utterance_index: 1,
          chart: {
            type: "bar",
            title: "Share",
            values: [72],
            labels: ["policy"],
            unit: "%",
            source_span: { start_char: 0, end_char: 32 },
          },
        }),
      ],
      utterances
    );

    // "Most of it came from one policy" quantifies nothing. The 72% is invented,
    // so the chart goes and the scene stays.
    expect(result.scenes).toHaveLength(1);
    expect(result.scenes[0].chart).toBeNull();
    expect(result.rejections[0]).toMatchObject({ kind: "chart" });
  });

  it("nulls the emotion when there is no character on screen", () => {
    const result = collectScenes(
      [modelScene({ visual_type: "text", emotion: "happy", layout_template: "text-card" })],
      utterances
    );

    expect(result.scenes[0].emotion).toBeNull();
  });

  it("orders scenes by start time (AC-42)", () => {
    const result = collectScenes(
      [modelScene({ utterance_index: 1 }), modelScene({ utterance_index: 0 })],
      utterances
    );

    expect(result.scenes.map((s) => s.startMs)).toEqual([0, 5_200]);
  });

  it("accepts a plan longer or shorter than any target (AC-60)", () => {
    const many = collectScenes(
      Array.from({ length: 40 }, () => modelScene()),
      utterances
    );

    expect(many.scenes).toHaveLength(40);
    expect(many.rejections).toHaveLength(0);
  });

  it("reports a reply that is not a list at all", () => {
    const result = collectScenes({ scenes: [] }, utterances);
    expect(result.scenes).toHaveLength(0);
    expect(result.rejections[0].reason).toContain("did not return a list");
  });
});

describe("runScenePlan", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
    process.env.GEMINI_API_KEY = "test-key";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.GEMINI_API_KEY;
  });

  function geminiReply(body: unknown, finishReason = "STOP") {
    return {
      ok: true,
      json: async () => ({
        candidates: [
          { content: { parts: [{ text: JSON.stringify(body) }] }, finishReason },
        ],
        usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 20 },
      }),
    };
  }

  it("plans, streaming its phases in order", async () => {
    fetchMock.mockResolvedValue(geminiReply([modelScene()]));
    const phases: string[] = [];

    const result = await runScenePlan({
      utterances,
      sceneTarget: 12,
      onPhase: (p) => phases.push(p),
    });

    expect(result.scenes).toHaveLength(1);
    expect(phases).toEqual(["planning", "validating"]);
  });

  it("sends the generated responseSchema, not a hand written one (AC-23)", async () => {
    fetchMock.mockResolvedValue(geminiReply([]));
    await runScenePlan({ utterances, sceneTarget: 12 });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    const schema = body.generationConfig.responseSchema;

    expect(schema.type).toBe("array");
    expect(Object.keys(schema.items.properties)).toContain("layout_template");
    expect(body.generationConfig.responseMimeType).toBe("application/json");
  });

  it("calls the pinned model, never an alias", async () => {
    fetchMock.mockResolvedValue(geminiReply([]));
    await runScenePlan({ utterances, sceneTarget: 12 });

    expect(fetchMock.mock.calls[0][0]).toContain(PLANNER_MODEL);
    expect(fetchMock.mock.calls[0][0]).not.toContain("latest");
  });

  it("translates a retired model into something actionable (AC-27)", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 404,
      text: async () => `{"error":{"status":"NOT_FOUND","message":"models/${PLANNER_MODEL} is not found"}}`,
    });

    await expect(runScenePlan({ utterances, sceneTarget: 12 })).rejects.toMatchObject({
      code: "model_unavailable",
      message: expect.stringContaining(PLANNER_MODEL),
    });
  });

  it("refuses a truncated reply rather than storing half a plan", async () => {
    fetchMock.mockResolvedValue(geminiReply([modelScene()], "MAX_TOKENS"));

    await expect(runScenePlan({ utterances, sceneTarget: 12 })).rejects.toMatchObject({
      code: "too_long",
    });
  });

  it("says so when no API key is configured", async () => {
    delete process.env.GEMINI_API_KEY;

    await expect(runScenePlan({ utterances, sceneTarget: 12 })).rejects.toBeInstanceOf(
      PlannerError
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("surfaces unparseable JSON as a retryable failure", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        candidates: [{ content: { parts: [{ text: "not json" }] }, finishReason: "STOP" }],
      }),
    });

    await expect(runScenePlan({ utterances, sceneTarget: 12 })).rejects.toMatchObject({
      code: "failed",
    });
  });
});
