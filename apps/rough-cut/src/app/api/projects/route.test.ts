import { describe, it, expect, vi, beforeEach } from "vitest";

const state = vi.hoisted(() => ({
  clerkId: null as string | null,
  authorizedUser: null as Record<string, unknown> | null,
  createRateAllowed: true,
  readRateAllowed: true,
  insertedRows: [] as Record<string, unknown>[],
  insertValuesCalls: [] as unknown[][],
  userRows: [] as Record<string, unknown>[],
  listedProjects: [] as Record<string, unknown>[],
}));

vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn(async () => ({ userId: state.clerkId })),
}));

vi.mock("@/lib/authz", () => ({
  getAuthorizedDbUser: vi.fn(async () => state.authorizedUser),
}));

vi.mock("@/lib/rate-limit", () => ({
  rateLimit: vi.fn(async () => ({
    allowed: state.createRateAllowed,
    remaining: state.createRateAllowed ? 59 : 0,
    limit: 60,
  })),
  readRateLimit: vi.fn(async () => ({
    allowed: state.readRateAllowed,
    remaining: state.readRateAllowed ? 1 : 0,
    limit: 1,
  })),
}));

vi.mock("@/lib/observability", () => ({ reportError: vi.fn() }));

const {
  returningMock,
  valuesMock,
  insertMock,
  orderByMock,
  selectWhereMock,
  selectFromMock,
  selectMock,
} = vi.hoisted(() => {
  const returningMock = vi.fn();
  const valuesMock = vi.fn();
  const insertMock = vi.fn(() => ({ values: valuesMock }));
  const orderByMock = vi.fn();
  const selectWhereMock = vi.fn(() => ({ orderBy: orderByMock }));
  const selectFromMock = vi.fn();
  const selectMock = vi.fn(() => ({ from: selectFromMock }));
  return {
    returningMock,
    valuesMock,
    insertMock,
    orderByMock,
    selectWhereMock,
    selectFromMock,
    selectMock,
  };
});

vi.mock("@repo/db", () => ({
  db: { insert: insertMock, select: selectMock },
  withDbRetry: vi.fn(async (cb: () => unknown) => cb()),
}));

vi.mock("@repo/db/schema", () => ({
  projects: {
    id: "projects.id",
    fileName: "projects.fileName",
    durationMs: "projects.durationMs",
    transcriptStatus: "projects.transcriptStatus",
    createdAt: "projects.createdAt",
    updatedAt: "projects.updatedAt",
    userId: "projects.userId",
  },
  users: "users-table",
}));

import { POST, GET } from "./route";
import { rateLimit, readRateLimit } from "@/lib/rate-limit";
import { getAuthorizedDbUser } from "@/lib/authz";

function postRequest(body: unknown) {
  return new Request("http://localhost/api/projects", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  state.clerkId = null;
  state.authorizedUser = null;
  state.createRateAllowed = true;
  state.readRateAllowed = true;
  state.insertedRows = [];
  state.insertValuesCalls = [];
  state.userRows = [];
  state.listedProjects = [];
  vi.clearAllMocks();

  returningMock.mockImplementation(async () => state.insertedRows);
  valuesMock.mockImplementation((vals: unknown) => {
    state.insertValuesCalls.push([vals]);
    return { returning: returningMock };
  });
  orderByMock.mockImplementation(async () => state.listedProjects);
  selectFromMock.mockImplementation((table: unknown) => {
    // Distinguish the two GET queries (users lookup vs. project list) by
    // which table `.from()` was called with, matching the route's two
    // sequential withDbRetry(db.select()...) calls.
    if (table === "users-table") {
      return { where: vi.fn(() => ({ limit: vi.fn(async () => state.userRows) })) };
    }
    return { where: selectWhereMock };
  });
});

describe("POST /api/projects", () => {
  it("returns 401 when unauthenticated", async () => {
    const res = await POST(postRequest({ fileName: "clip.mp4" }));
    expect(res.status).toBe(401);
    expect(getAuthorizedDbUser).not.toHaveBeenCalled();
  });

  it("returns 403 when the caller has no authorized (provisioned) user row", async () => {
    state.clerkId = "clerk_1";
    state.authorizedUser = null;
    const res = await POST(postRequest({ fileName: "clip.mp4" }));
    expect(res.status).toBe(403);
    expect(rateLimit).not.toHaveBeenCalled();
  });

  it("returns 429 when the per-user create rate limit is exceeded", async () => {
    state.clerkId = "clerk_1";
    state.authorizedUser = { id: "user-1" };
    state.createRateAllowed = false;
    const res = await POST(postRequest({ fileName: "clip.mp4" }));
    expect(res.status).toBe(429);
    expect(rateLimit).toHaveBeenCalledWith("create:clerk_1", 60, 3600);
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("returns 400 for an invalid body (missing fileName)", async () => {
    state.clerkId = "clerk_1";
    state.authorizedUser = { id: "user-1" };
    const res = await POST(postRequest({}));
    expect(res.status).toBe(400);
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("returns 400 when the body isn't valid JSON", async () => {
    state.clerkId = "clerk_1";
    state.authorizedUser = { id: "user-1" };
    const res = await POST(
      new Request("http://localhost/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "not json",
      })
    );
    expect(res.status).toBe(400);
  });

  it("creates the project with aiPolishRequested true when aiPolish: true is sent", async () => {
    state.clerkId = "clerk_1";
    state.authorizedUser = { id: "user-1" };
    state.insertedRows = [{ id: "proj-1", fileName: "clip.mp4", aiPolishRequested: true }];

    const res = await POST(
      postRequest({ fileName: "clip.mp4", durationMs: 5000, aiPolish: true })
    );

    expect(res.status).toBe(201);
    expect(state.insertValuesCalls[0][0]).toMatchObject({
      userId: "user-1",
      fileName: "clip.mp4",
      durationMs: 5000,
      aiPolishRequested: true,
    });
    const body = await res.json();
    expect(body).toEqual(state.insertedRows[0]);
  });

  it("defaults aiPolishRequested to false when aiPolish is omitted", async () => {
    state.clerkId = "clerk_1";
    state.authorizedUser = { id: "user-1" };
    state.insertedRows = [{ id: "proj-2", fileName: "clip.mp4", aiPolishRequested: false }];

    await POST(postRequest({ fileName: "clip.mp4" }));

    expect(state.insertValuesCalls[0][0]).toMatchObject({ aiPolishRequested: false });
  });

  it("returns 500 and reports the error when the insert throws", async () => {
    state.clerkId = "clerk_1";
    state.authorizedUser = { id: "user-1" };
    returningMock.mockRejectedValueOnce(new Error("db down"));

    const res = await POST(postRequest({ fileName: "clip.mp4" }));

    expect(res.status).toBe(500);
  });
});

describe("GET /api/projects", () => {
  it("returns 401 when unauthenticated", async () => {
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it("returns 429 when the read rate limit is exceeded", async () => {
    state.clerkId = "clerk_1";
    state.readRateAllowed = false;
    const res = await GET();
    expect(res.status).toBe(429);
    expect(readRateLimit).toHaveBeenCalledWith("clerk_1");
  });

  it("returns an empty array when the user has no db row yet", async () => {
    state.clerkId = "clerk_1";
    state.userRows = [];
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });

  it("returns the caller's projects, newest first", async () => {
    state.clerkId = "clerk_1";
    state.userRows = [{ id: "user-1" }];
    state.listedProjects = [
      { id: "p2", fileName: "b.mp4", transcriptStatus: "ready" },
      { id: "p1", fileName: "a.mp4", transcriptStatus: "processing" },
    ];
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(state.listedProjects);
  });
});
