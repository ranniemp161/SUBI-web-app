import { describe, it, expect, vi, beforeEach } from "vitest";

const state = vi.hoisted(() => ({
  clerkId: null as string | null,
  ownedProject: null as Record<string, unknown> | null,
  rateAllowed: true,
  run: null as Record<string, unknown> | null,
  deleteCalls: [] as unknown[][],
}));

vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn(async () => ({ userId: state.clerkId })),
}));

vi.mock("@/lib/projects", () => ({
  getOwnedProject: vi.fn(async () => state.ownedProject),
  getAiCutRun: vi.fn(async () => state.run),
  deleteAiCutRunAndRenumber: vi.fn(async (projectId: string, runId: string) => {
    state.deleteCalls.push([projectId, runId]);
  }),
  renameAiCutRun: vi.fn(async (_projectId: string, _runId: string, name: string | null) => {
    return state.run ? { ...state.run, name } : null;
  }),
}));

vi.mock("@/lib/rate-limit", () => ({
  rateLimit: vi.fn(async () => ({
    allowed: state.rateAllowed,
    remaining: state.rateAllowed ? 9 : 0,
    limit: 10,
  })),
}));

vi.mock("@/lib/observability", () => ({ reportError: vi.fn() }));

import { DELETE, PATCH } from "./route";
import { deleteAiCutRunAndRenumber, renameAiCutRun } from "@/lib/projects";

const VALID_ID = "12345678-1234-1234-1234-123456789abc";
const RUN_ID = "run-1";
const params = Promise.resolve({ id: VALID_ID, runId: RUN_ID });
const request = () => new Request("http://localhost", { method: "DELETE" });

const RUN = { id: RUN_ID, runNumber: 1, ranges: [], model: "gemini-2.5-flash", createdAt: "now" };

beforeEach(() => {
  state.clerkId = null;
  state.ownedProject = null;
  state.rateAllowed = true;
  state.run = null;
  state.deleteCalls = [];
  vi.clearAllMocks();
});

describe("DELETE /api/projects/:id/ai-cut/runs/:runId", () => {
  it("returns 401 when unauthenticated", async () => {
    const res = await DELETE(request(), { params });
    expect(res.status).toBe(401);
  });

  it("returns 429 once the per-user limit is exceeded", async () => {
    state.clerkId = "clerk_1";
    state.rateAllowed = false;
    const res = await DELETE(request(), { params });
    expect(res.status).toBe(429);
    expect(deleteAiCutRunAndRenumber).not.toHaveBeenCalled();
  });

  it("returns 404 for a project the caller doesn't own", async () => {
    state.clerkId = "clerk_1";
    state.ownedProject = null;
    const res = await DELETE(request(), { params });
    expect(res.status).toBe(404);
  });

  // covers AC-6: a runId not belonging to this project returns 404.
  it("returns 404 AI_CUT_RUN_NOT_FOUND when the run doesn't belong to this project", async () => {
    state.clerkId = "clerk_1";
    state.ownedProject = { id: VALID_ID, userId: "user-1", activeAiCutRunId: null };
    state.run = null;
    const res = await DELETE(request(), { params });
    expect(res.status).toBe(404);
    const body = (await res.json()) as { code?: string };
    expect(body.code).toBe("AI_CUT_RUN_NOT_FOUND");
    expect(deleteAiCutRunAndRenumber).not.toHaveBeenCalled();
  });

  // covers AC-4: deleting the currently active run is blocked with 409.
  it("returns 409 AI_CUT_RUN_IS_ACTIVE when the run is the active one", async () => {
    state.clerkId = "clerk_1";
    state.ownedProject = { id: VALID_ID, userId: "user-1", activeAiCutRunId: RUN_ID };
    state.run = RUN;
    const res = await DELETE(request(), { params });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { code?: string };
    expect(body.code).toBe("AI_CUT_RUN_IS_ACTIVE");
    expect(deleteAiCutRunAndRenumber).not.toHaveBeenCalled();
  });

  it("deletes a non-active run and returns ok", async () => {
    state.clerkId = "clerk_1";
    state.ownedProject = { id: VALID_ID, userId: "user-1", activeAiCutRunId: "other-run" };
    state.run = RUN;
    const res = await DELETE(request(), { params });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(state.deleteCalls).toEqual([[VALID_ID, RUN_ID]]);
  });
});

describe("PATCH /api/projects/:id/ai-cut/runs/:runId", () => {
  const patchRequest = (body: unknown) =>
    new Request("http://localhost", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

  it("returns 401 when unauthenticated", async () => {
    const res = await PATCH(patchRequest({ name: "foo" }), { params });
    expect(res.status).toBe(401);
  });

  it("returns 429 once the per-user limit is exceeded", async () => {
    state.clerkId = "clerk_1";
    state.rateAllowed = false;
    const res = await PATCH(patchRequest({ name: "foo" }), { params });
    expect(res.status).toBe(429);
  });

  it("returns 404 for a project the caller doesn't own", async () => {
    state.clerkId = "clerk_1";
    state.ownedProject = null;
    const res = await PATCH(patchRequest({ name: "foo" }), { params });
    expect(res.status).toBe(404);
  });

  it("returns 404 when the run doesn't exist", async () => {
    state.clerkId = "clerk_1";
    state.ownedProject = { id: VALID_ID, userId: "user-1", activeAiCutRunId: null };
    state.run = null;
    const res = await PATCH(patchRequest({ name: "foo" }), { params });
    expect(res.status).toBe(404);
  });

  it("renames a run and returns it", async () => {
    state.clerkId = "clerk_1";
    state.ownedProject = { id: VALID_ID, userId: "user-1", activeAiCutRunId: "other-run" };
    state.run = RUN;
    const res = await PATCH(patchRequest({ name: "Awesome Cut" }), { params });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { name?: string };
    expect(body.name).toBe("Awesome Cut");
  });
});
