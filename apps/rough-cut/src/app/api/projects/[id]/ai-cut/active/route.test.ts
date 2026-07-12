import { describe, it, expect, vi, beforeEach } from "vitest";

const state = vi.hoisted(() => ({
  clerkId: null as string | null,
  ownedProject: null as Record<string, unknown> | null,
  rateAllowed: true,
  activeRun: null as Record<string, unknown> | null,
  setActiveCalls: [] as unknown[][],
}));

vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn(async () => ({ userId: state.clerkId })),
}));

vi.mock("@/lib/projects", () => ({
  getOwnedProject: vi.fn(async () => state.ownedProject),
  setActiveAiCutRun: vi.fn(async (projectId: string, runId: string) => {
    state.setActiveCalls.push([projectId, runId]);
    return state.activeRun;
  }),
}));

vi.mock("@/lib/rate-limit", () => ({
  aiCutRateLimit: vi.fn(async () => ({
    allowed: state.rateAllowed,
    remaining: state.rateAllowed ? 9 : 0,
    limit: 10,
  })),
}));

vi.mock("@/lib/observability", () => ({ reportError: vi.fn() }));

import { PATCH } from "./route";
import { setActiveAiCutRun } from "@/lib/projects";

const VALID_ID = "12345678-1234-1234-1234-123456789abc";
const RUN_ID = "run-1";
const params = Promise.resolve({ id: VALID_ID });
const request = (body: unknown) =>
  new Request("http://localhost", { method: "PATCH", body: JSON.stringify(body) });

const OWNED_PROJECT = { id: VALID_ID, userId: "user-1" };
const RUN = { id: RUN_ID, runNumber: 2, ranges: [], model: "gemini-2.5-flash", createdAt: "now" };

beforeEach(() => {
  state.clerkId = null;
  state.ownedProject = null;
  state.rateAllowed = true;
  state.activeRun = null;
  state.setActiveCalls = [];
  vi.clearAllMocks();
});

describe("PATCH /api/projects/:id/ai-cut/active", () => {
  it("returns 401 when unauthenticated", async () => {
    const res = await PATCH(request({ runId: RUN_ID }), { params });
    expect(res.status).toBe(401);
  });

  it("returns 429 once the per-user limit is exceeded", async () => {
    state.clerkId = "clerk_1";
    state.rateAllowed = false;
    const res = await PATCH(request({ runId: RUN_ID }), { params });
    expect(res.status).toBe(429);
    expect(setActiveAiCutRun).not.toHaveBeenCalled();
  });

  it("returns 404 for a project the caller doesn't own", async () => {
    state.clerkId = "clerk_1";
    state.ownedProject = null;
    const res = await PATCH(request({ runId: RUN_ID }), { params });
    expect(res.status).toBe(404);
  });

  it("returns 400 when runId is missing", async () => {
    state.clerkId = "clerk_1";
    state.ownedProject = OWNED_PROJECT;
    const res = await PATCH(request({}), { params });
    expect(res.status).toBe(400);
    expect(setActiveAiCutRun).not.toHaveBeenCalled();
  });

  // covers AC-6: a runId that doesn't belong to this project returns 404, not
  // a silent success and not leaking whether the run exists elsewhere.
  it("returns 404 AI_CUT_RUN_NOT_FOUND when the run doesn't belong to this project", async () => {
    state.clerkId = "clerk_1";
    state.ownedProject = OWNED_PROJECT;
    state.activeRun = null;
    const res = await PATCH(request({ runId: RUN_ID }), { params });
    expect(res.status).toBe(404);
    const body = (await res.json()) as { code?: string };
    expect(body.code).toBe("AI_CUT_RUN_NOT_FOUND");
  });

  // covers AC-3: switching active succeeds and returns the run in the same
  // shape POST does.
  it("switches the active run and returns it", async () => {
    state.clerkId = "clerk_1";
    state.ownedProject = OWNED_PROJECT;
    state.activeRun = RUN;
    const res = await PATCH(request({ runId: RUN_ID }), { params });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(RUN);
    expect(state.setActiveCalls).toEqual([[VALID_ID, RUN_ID]]);
  });
});
