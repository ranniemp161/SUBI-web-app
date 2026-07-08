import { describe, it, expect, vi, beforeEach } from "vitest";

const state = vi.hoisted(() => ({
  clerkId: null as string | null,
  ownedProject: null as Record<string, unknown> | null,
  rateAllowed: true,
  configured: true,
  aiResult: null as Record<string, unknown> | null,
  aiError: false,
  updates: [] as Record<string, unknown>[],
  chargeStatus: "charged" as "charged" | "insufficient",
  chargeCalls: [] as unknown[][],
  refundCalls: [] as unknown[][],
}));

vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn(async () => ({ userId: state.clerkId })),
}));

vi.mock("@/lib/projects", () => ({
  getOwnedProject: vi.fn(async () => state.ownedProject),
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

vi.mock("@repo/db", () => {
  function chain(getResult: () => unknown, onSet?: (v: Record<string, unknown>) => void) {
    const proxy: unknown = new Proxy(function () {}, {
      get(_t, prop) {
        if (prop === "then") {
          return (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
            Promise.resolve(getResult()).then(res, rej);
        }
        if (prop === "set") {
          return (v: Record<string, unknown>) => {
            onSet?.(v);
            return proxy;
          };
        }
        return () => proxy;
      },
    });
    return proxy;
  }
  return {
    db: {
      update: () => chain(() => [], (v) => state.updates.push(v)),
    },
  };
});

import { POST } from "./route";
import { rateLimit } from "@/lib/rate-limit";
import { runAiRoughCut } from "@/lib/ai-rough-cut";
import { chargeAiCut, refundAiCut } from "@/lib/credits";

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

const AI_CUTS = { ranges: [], model: "gemini-2.5-flash", createdAt: "now" };

beforeEach(() => {
  state.clerkId = null;
  state.ownedProject = null;
  state.rateAllowed = true;
  state.configured = true;
  state.aiResult = null;
  state.aiError = false;
  state.updates = [];
  state.chargeStatus = "charged";
  state.chargeCalls = [];
  state.refundCalls = [];
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
  it("runs Gemini over the transcript, stores the result, and returns it", async () => {
    state.clerkId = "clerk_1";
    state.ownedProject = READY_PROJECT;
    state.aiResult = AI_CUTS;
    const res = await POST(request(), { params });
    expect(res.status).toBe(200);
    expect(runAiRoughCut).toHaveBeenCalledWith(
      (READY_PROJECT.transcript as { words: unknown }).words
    );
    expect(state.updates).toHaveLength(1);
    expect(state.updates[0].aiCuts).toBe(AI_CUTS);
    expect(await res.json()).toEqual(AI_CUTS);
    expect(state.refundCalls).toHaveLength(0);
  });

  it("returns 422, stores nothing, and refunds the charge when the transcript trips the size guard", async () => {
    state.clerkId = "clerk_1";
    state.ownedProject = READY_PROJECT;
    state.aiResult = null; // configured + words present, so null = size guard
    const res = await POST(request(), { params });
    expect(res.status).toBe(422);
    expect(state.updates).toHaveLength(0);
    expect(refundAiCut).toHaveBeenCalledWith("user-1", VALID_ID, 5, undefined);
  });

  it("returns 502, stores nothing, and refunds the charge when the Gemini request fails", async () => {
    state.clerkId = "clerk_1";
    state.ownedProject = READY_PROJECT;
    state.aiError = true;
    const res = await POST(request(), { params });
    expect(res.status).toBe(502);
    expect(state.updates).toHaveLength(0);
    expect(refundAiCut).toHaveBeenCalledWith("user-1", VALID_ID, 5, undefined);
  });
});
