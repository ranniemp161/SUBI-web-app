import { describe, it, expect, vi, beforeEach } from "vitest";

const state = vi.hoisted(() => ({
  clerkId: null as string | null,
  ownedProject: null as Record<string, unknown> | null,
  rateAllowed: true,
  configured: true,
  aiResult: null as Record<string, unknown> | null,
  aiError: false,
  chargeStatus: "charged" as "charged" | "insufficient",
  chargeCalls: [] as unknown[][],
  refundCalls: [] as unknown[][],
  runCount: 0,
  runLimit: 3,
  createdRun: null as Record<string, unknown> | null,
  createCalls: [] as unknown[][],
  // Controls claimAiCutSlot's return — true (the default) mirrors winning the
  // atomic claim; a test sets this false to simulate a concurrent request
  // that already holds it.
  claimSucceeds: true,
  claimCalls: [] as unknown[][],
  releaseCalls: [] as unknown[][],
}));

vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn(async () => ({ userId: state.clerkId })),
}));

vi.mock("@/lib/projects", () => ({
  AI_CUT_RUN_LIMIT: 3,
  getOwnedProject: vi.fn(async () => state.ownedProject),
  countAiCutRuns: vi.fn(async () => state.runCount),
  claimAiCutSlot: vi.fn(async (projectId: string, userId: string) => {
    state.claimCalls.push([projectId, userId]);
    return state.claimSucceeds;
  }),
  releaseAiCutClaim: vi.fn(async (projectId: string) => {
    state.releaseCalls.push([projectId]);
  }),
  createAiCutRun: vi.fn(async (projectId: string, ranges: unknown, model: string) => {
    state.createCalls.push([projectId, ranges, model]);
    return state.createdRun;
  }),
}));

vi.mock("@/lib/rate-limit", () => ({
  rateLimit: vi.fn(async () => ({
    allowed: state.rateAllowed,
    remaining: state.rateAllowed ? 9 : 0,
    limit: 10,
  })),
}));

vi.mock("@/lib/ai-rough-cut", () => ({
  isAiRoughCutConfigured: vi.fn(() => state.configured),
  runAiRoughCut: vi.fn(async () => {
    if (state.aiError) throw new Error("gemini down");
    return state.aiResult;
  }),
}));

vi.mock("@/lib/observability", () => ({ reportError: vi.fn() }));

vi.mock("@/lib/credits", () => ({
  costSecondsForDurationMs: (durationMs: number | null | undefined) =>
    durationMs ? Math.ceil(durationMs / 1000) : 60,
  chargeAiCut: vi.fn(async (userId: string, projectId: string, costSeconds: number) => {
    state.chargeCalls.push([userId, projectId, costSeconds]);
    return { status: state.chargeStatus };
  }),
  refundAiCut: vi.fn(async (userId: string, projectId: string, costSeconds: number) => {
    state.refundCalls.push([userId, projectId, costSeconds]);
  }),
}));

import { POST } from "./route";
import { rateLimit } from "@/lib/rate-limit";
import { runAiRoughCut } from "@/lib/ai-rough-cut";
import { chargeAiCut, refundAiCut } from "@/lib/credits";
import { countAiCutRuns, createAiCutRun } from "@/lib/projects";

const VALID_ID = "12345678-1234-1234-1234-123456789abc";
const params = Promise.resolve({ id: VALID_ID });
const request = () => new Request("http://localhost", { method: "POST" });

const READY_PROJECT = {
  id: VALID_ID,
  userId: "user-1",
  durationMs: 5000,
  transcriptStatus: "ready",
  transcript: {
    words: [{ word: "hello", start: 0, end: 0.5, confidence: 1 }],
    text: "hello",
    duration: 1,
  },
};

const AI_CUTS = { ranges: [], model: "gemini-2.5-flash" };
const CREATED_RUN = {
  id: "run-1",
  runNumber: 1,
  ranges: [],
  model: "gemini-2.5-flash",
  createdAt: "now",
};

beforeEach(() => {
  state.clerkId = null;
  state.ownedProject = null;
  state.rateAllowed = true;
  state.configured = true;
  state.aiResult = null;
  state.aiError = false;
  state.chargeStatus = "charged";
  state.chargeCalls = [];
  state.refundCalls = [];
  state.runCount = 0;
  state.createdRun = CREATED_RUN;
  state.createCalls = [];
  state.claimSucceeds = true;
  state.claimCalls = [];
  state.releaseCalls = [];
  vi.clearAllMocks();
});

describe("POST /api/projects/:id/ai-cut — gates", () => {
  it("returns 401 when unauthenticated (never touches the rate limiter)", async () => {
    const res = await POST(request(), { params });
    expect(res.status).toBe(401);
    expect(rateLimit).not.toHaveBeenCalled();
  });

  it("returns 429 once the per-user limit is exceeded, before any Gemini call", async () => {
    state.clerkId = "clerk_1";
    state.rateAllowed = false;
    const res = await POST(request(), { params });
    expect(res.status).toBe(429);
    expect(rateLimit).toHaveBeenCalledWith("ai-cut:clerk_1", 10, 3600);
    expect(runAiRoughCut).not.toHaveBeenCalled();
  });

  it("returns 404 for a project the caller doesn't own", async () => {
    state.clerkId = "clerk_1";
    state.ownedProject = null;
    const res = await POST(request(), { params });
    expect(res.status).toBe(404);
    expect(runAiRoughCut).not.toHaveBeenCalled();
  });

  it("returns 503 when no Gemini key is configured", async () => {
    state.clerkId = "clerk_1";
    state.ownedProject = READY_PROJECT;
    state.configured = false;
    const res = await POST(request(), { params });
    expect(res.status).toBe(503);
    expect(runAiRoughCut).not.toHaveBeenCalled();
  });

  it("returns 409 when the transcript isn't ready or has no words", async () => {
    state.clerkId = "clerk_1";
    state.ownedProject = { ...READY_PROJECT, transcriptStatus: "processing" };
    expect((await POST(request(), { params })).status).toBe(409);

    state.ownedProject = { ...READY_PROJECT, transcript: { words: [], text: "", duration: 0 } };
    expect((await POST(request(), { params })).status).toBe(409);
    expect(runAiRoughCut).not.toHaveBeenCalled();
  });

  // covers AC-2: a project already at the 3-run cap is refused before any
  // claim or charge, with the machine-readable AI_CUT_RUN_LIMIT_REACHED code.
  it("returns 409 AI_CUT_RUN_LIMIT_REACHED and charges nothing when at the run cap", async () => {
    state.clerkId = "clerk_1";
    state.ownedProject = READY_PROJECT;
    state.runCount = 3;
    const res = await POST(request(), { params });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { code?: string };
    expect(body.code).toBe("AI_CUT_RUN_LIMIT_REACHED");
    expect(countAiCutRuns).toHaveBeenCalledWith(VALID_ID);
    expect(state.claimCalls).toHaveLength(0);
    expect(chargeAiCut).not.toHaveBeenCalled();
    expect(runAiRoughCut).not.toHaveBeenCalled();
  });

  // covers AC-1: under the cap, a run is created even though prior runs exist.
  it("still runs and charges when under the run cap, even with prior runs stored", async () => {
    state.clerkId = "clerk_1";
    state.ownedProject = READY_PROJECT;
    state.runCount = 2;
    state.aiResult = AI_CUTS;
    const res = await POST(request(), { params });
    expect(res.status).toBe(200);
    expect(chargeAiCut).toHaveBeenCalledTimes(1);
  });
});

describe("POST /api/projects/:id/ai-cut — concurrent-run claim", () => {
  // covers AC-5: a losing concurrent request is rejected by the atomic claim
  // before any charge.
  it("returns 409 AI_CUT_IN_PROGRESS and charges nothing when the atomic claim is lost", async () => {
    state.clerkId = "clerk_1";
    state.ownedProject = READY_PROJECT;
    state.claimSucceeds = false;
    const res = await POST(request(), { params });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { code?: string };
    expect(body.code).toBe("AI_CUT_IN_PROGRESS");
    expect(state.claimCalls).toHaveLength(1);
    expect(chargeAiCut).not.toHaveBeenCalled();
    expect(runAiRoughCut).not.toHaveBeenCalled();
  });

  it("releases the claim (without charging again) when credits are insufficient", async () => {
    state.clerkId = "clerk_1";
    state.ownedProject = READY_PROJECT;
    state.chargeStatus = "insufficient";
    const res = await POST(request(), { params });
    expect(res.status).toBe(402);
    expect(state.releaseCalls).toEqual([[VALID_ID]]);
  });

  it("releases the claim when the Gemini request fails", async () => {
    state.clerkId = "clerk_1";
    state.ownedProject = READY_PROJECT;
    state.aiError = true;
    const res = await POST(request(), { params });
    expect(res.status).toBe(502);
    expect(state.releaseCalls).toEqual([[VALID_ID]]);
  });

  it("releases the claim when the transcript trips the size guard", async () => {
    state.clerkId = "clerk_1";
    state.ownedProject = READY_PROJECT;
    state.aiResult = null;
    const res = await POST(request(), { params });
    expect(res.status).toBe(422);
    expect(state.releaseCalls).toEqual([[VALID_ID]]);
  });

  it("does not release the claim after a successful run (createAiCutRun clears it)", async () => {
    state.clerkId = "clerk_1";
    state.ownedProject = READY_PROJECT;
    state.aiResult = AI_CUTS;
    const res = await POST(request(), { params });
    expect(res.status).toBe(200);
    expect(state.releaseCalls).toHaveLength(0);
  });
});

describe("POST /api/projects/:id/ai-cut — credits", () => {
  it("charges before calling Gemini, using the project's duration", async () => {
    state.clerkId = "clerk_1";
    state.ownedProject = READY_PROJECT;
    state.aiResult = AI_CUTS;
    await POST(request(), { params });
    expect(chargeAiCut).toHaveBeenCalledWith("user-1", VALID_ID, 5, undefined);
    expect(state.chargeCalls).toHaveLength(1);
  });

  it("returns 402 and never calls Gemini when credits are insufficient", async () => {
    state.clerkId = "clerk_1";
    state.ownedProject = READY_PROJECT;
    state.chargeStatus = "insufficient";
    const res = await POST(request(), { params });
    expect(res.status).toBe(402);
    const body = (await res.json()) as { code?: string; requiredSeconds?: number };
    expect(body.code).toBe("INSUFFICIENT_CREDITS");
    expect(body.requiredSeconds).toBe(5);
    expect(runAiRoughCut).not.toHaveBeenCalled();
  });
});

describe("POST /api/projects/:id/ai-cut — the run itself", () => {
  it("runs Gemini over the transcript, creates a versioned run, and returns it", async () => {
    state.clerkId = "clerk_1";
    state.ownedProject = READY_PROJECT;
    state.aiResult = AI_CUTS;
    const res = await POST(request(), { params });
    expect(res.status).toBe(200);
    expect(runAiRoughCut).toHaveBeenCalledWith(
      (READY_PROJECT.transcript as { words: unknown }).words
    );
    expect(createAiCutRun).toHaveBeenCalledWith(VALID_ID, AI_CUTS.ranges, AI_CUTS.model);
    expect(await res.json()).toEqual(CREATED_RUN);
    expect(state.refundCalls).toHaveLength(0);
  });

  it("creates nothing and refunds the charge when the transcript trips the size guard", async () => {
    state.clerkId = "clerk_1";
    state.ownedProject = READY_PROJECT;
    state.aiResult = null; // configured + words present, so null = size guard
    const res = await POST(request(), { params });
    expect(res.status).toBe(422);
    expect(createAiCutRun).not.toHaveBeenCalled();
    expect(refundAiCut).toHaveBeenCalledWith("user-1", VALID_ID, 5, undefined);
  });

  it("creates nothing and refunds the charge when the Gemini request fails", async () => {
    state.clerkId = "clerk_1";
    state.ownedProject = READY_PROJECT;
    state.aiError = true;
    const res = await POST(request(), { params });
    expect(res.status).toBe(502);
    expect(createAiCutRun).not.toHaveBeenCalled();
    expect(refundAiCut).toHaveBeenCalledWith("user-1", VALID_ID, 5, undefined);
  });
});
