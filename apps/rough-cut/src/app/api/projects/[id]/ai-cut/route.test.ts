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
  // Controls claimAiCutSlot's return — true (the default) mirrors winning the
  // atomic claim; a test sets this false to simulate a concurrent request
  // that already holds it.
  claimSucceeds: true,
  claimCalls: [] as unknown[][],
  releaseCalls: [] as unknown[][],
  // When non-empty, getOwnedProject shifts and returns these in order before
  // falling back to `ownedProject` — lets a test simulate the project's state
  // changing between the route's two reads (initial fetch, then the re-check
  // after a lost claim).
  ownedProjectQueue: [] as (Record<string, unknown> | null)[],
}));

vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn(async () => ({ userId: state.clerkId })),
}));

vi.mock("@/lib/projects", () => ({
  getOwnedProject: vi.fn(async () =>
    state.ownedProjectQueue.length > 0 ? state.ownedProjectQueue.shift() : state.ownedProject
  ),
  claimAiCutSlot: vi.fn(async (projectId: string, userId: string) => {
    state.claimCalls.push([projectId, userId]);
    return state.claimSucceeds;
  }),
  releaseAiCutClaim: vi.fn(async (projectId: string) => {
    state.releaseCalls.push([projectId]);
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

import { POST, DELETE } from "./route";
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
  state.claimSucceeds = true;
  state.claimCalls = [];
  state.releaseCalls = [];
  state.ownedProjectQueue = [];
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

  // covers AC-1 (child 2): once aiCuts.ranges is non-empty, a re-run POST is
  // refused with 409 AI_CUT_ALREADY_RUN, before any charge or Gemini call.
  it("returns 409 AI_CUT_ALREADY_RUN and charges nothing when AI Cut has already run", async () => {
    state.clerkId = "clerk_1";
    state.ownedProject = {
      ...READY_PROJECT,
      aiCuts: { ranges: [{ start: 0, end: 1 }], model: "gemini-2.5-flash", createdAt: "now" },
    };
    const res = await POST(request(), { params });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { code?: string };
    expect(body.code).toBe("AI_CUT_ALREADY_RUN");
    expect(chargeAiCut).not.toHaveBeenCalled();
    expect(runAiRoughCut).not.toHaveBeenCalled();
  });

  // covers AC-2 (child 2): an empty-ranges aiCuts (or none at all) does not
  // trip the already-run guard — a first real run still charges and executes.
  it("still runs and charges when aiCuts exists but has an empty ranges array", async () => {
    state.clerkId = "clerk_1";
    state.ownedProject = {
      ...READY_PROJECT,
      aiCuts: { ranges: [], model: "gemini-2.5-flash", createdAt: "now" },
    };
    state.aiResult = AI_CUTS;
    const res = await POST(request(), { params });
    expect(res.status).toBe(200);
    expect(chargeAiCut).toHaveBeenCalledTimes(1);
  });
});

describe("POST /api/projects/:id/ai-cut — concurrent-run claim", () => {
  // covers the TOCTOU double-charge finding in docs/hardening/2026-07-09-uncommitted.md:
  // a losing concurrent request must be rejected by the atomic claim before
  // any charge, even though its own snapshot read of aiCuts looked empty.
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

  // A losing claim where the winner has since finished (real ranges landed)
  // should report the friendlier "already run" code, not "in progress".
  it("returns 409 AI_CUT_ALREADY_RUN when the claim is lost to a run that already finished", async () => {
    state.clerkId = "clerk_1";
    state.ownedProject = READY_PROJECT; // first read: looks empty
    state.claimSucceeds = false;
    // Second read (the post-claim-failure re-check): the winner has since
    // finished and written real results.
    state.ownedProjectQueue = [
      READY_PROJECT,
      {
        ...READY_PROJECT,
        aiCuts: { ranges: [{ start: 0, end: 1 }], model: "gemini-2.5-flash", createdAt: "now" },
      },
    ];
    const res = await POST(request(), { params });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { code?: string };
    expect(body.code).toBe("AI_CUT_ALREADY_RUN");
    expect(chargeAiCut).not.toHaveBeenCalled();
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

  it("does not release the claim after a successful run", async () => {
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

describe("DELETE /api/projects/:id/ai-cut", () => {
  // covers AC-4 (child 2): the DELETE route enforces the same auth check as POST.
  it("returns 401 when unauthenticated", async () => {
    const res = await DELETE(request(), { params });
    expect(res.status).toBe(401);
    expect(state.updates).toHaveLength(0);
  });

  // covers AC-4 (child 2): ownership is enforced the same way as POST.
  it("returns 404 for a project the caller doesn't own", async () => {
    state.clerkId = "clerk_1";
    state.ownedProject = null;
    const res = await DELETE(request(), { params });
    expect(res.status).toBe(404);
    expect(state.updates).toHaveLength(0);
  });

  // covers AC-3 (child 2): DELETE empties aiCuts, returns 200, and issues no refund.
  it("clears aiCuts to null, returns 200, and issues no refund", async () => {
    state.clerkId = "clerk_1";
    state.ownedProject = {
      ...READY_PROJECT,
      aiCuts: { ranges: [{ start: 0, end: 1 }], model: "gemini-2.5-flash", createdAt: "now" },
    };
    const res = await DELETE(request(), { params });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(state.updates).toHaveLength(1);
    expect(state.updates[0].aiCuts).toBeNull();
    expect(refundAiCut).not.toHaveBeenCalled();
  });

  // covers AC-3 (child 2): after a clear, a subsequent POST is allowed again
  // (the already-run guard reads project.aiCuts, and DELETE just nulled it).
  it("re-enables a fresh charged POST after clearing", async () => {
    state.clerkId = "clerk_1";
    state.ownedProject = {
      ...READY_PROJECT,
      aiCuts: { ranges: [{ start: 0, end: 1 }], model: "gemini-2.5-flash", createdAt: "now" },
    };
    await DELETE(request(), { params });

    // Simulate the DB write DELETE just made being reflected on the next read.
    state.ownedProject = { ...READY_PROJECT, aiCuts: null };
    state.aiResult = AI_CUTS;
    const res = await POST(request(), { params });
    expect(res.status).toBe(200);
    expect(chargeAiCut).toHaveBeenCalledTimes(1);
  });

  it("returns 500 and reports the error when the update throws", async () => {
    state.clerkId = "clerk_1";
    state.ownedProject = READY_PROJECT;
    const { db } = await import("@repo/db");
    const originalUpdate = db.update;
    db.update = () => {
      throw new Error("db unavailable");
    };
    const res = await DELETE(request(), { params });
    expect(res.status).toBe(500);
    db.update = originalUpdate;
  });
});
