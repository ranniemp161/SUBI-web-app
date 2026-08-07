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
  nextCursor: undefined as string | undefined,
  listThrows: false,
  listCalls: [] as Array<{ userId: string; options: unknown }>,
}));

// The page query itself is exercised directly in lib/projects.test.ts; here the
// route's job is auth, rate limiting, parameter handling, and the cursor header.
vi.mock("@/lib/projects", () => ({
  findUserIdByClerkId: vi.fn(async () =>
    state.userRows.length > 0 ? (state.userRows[0].id as string) : null
  ),
  listProjectPage: vi.fn(async (userId: string, options: unknown) => {
    state.listCalls.push({ userId, options });
    if (state.listThrows) throw new Error("Invalid project cursor.");
    return { data: state.listedProjects, nextCursor: state.nextCursor };
  }),
}));

vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn(async () => ({ userId: state.clerkId })),
}));

vi.mock("@repo/server-shared/authz", () => ({
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
    edl: "projects.edl",
  },
  users: "users-table",
}));

import { POST, GET } from "./route";
import { rateLimit, readRateLimit } from "@/lib/rate-limit";
import { getAuthorizedDbUser } from "@repo/server-shared/authz";

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
  state.nextCursor = undefined;
  state.listThrows = false;
  state.listCalls = [];
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

  it("creates the project with aiPolishRequested always true (ADR 0004 child 1, AC-2)", async () => {
    state.clerkId = "clerk_1";
    state.authorizedUser = { id: "user-1" };
    state.insertedRows = [{ id: "proj-1", fileName: "clip.mp4", aiPolishRequested: true }];

    const res = await POST(
      postRequest({ fileName: "clip.mp4", durationMs: 5000 })
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

  it("rejects a request body that still sends an aiPolish field (strict schema)", async () => {
    state.clerkId = "clerk_1";
    state.authorizedUser = { id: "user-1" };

    const res = await POST(
      postRequest({ fileName: "clip.mp4", aiPolish: false })
    );

    expect(res.status).toBe(400);
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("returns 500 and reports the error when the insert throws", async () => {
    state.clerkId = "clerk_1";
    state.authorizedUser = { id: "user-1" };
    returningMock.mockRejectedValueOnce(new Error("db down"));

    const res = await POST(postRequest({ fileName: "clip.mp4" }));

    expect(res.status).toBe(500);
  });
});

function getRequest(query = "") {
  return new Request(`http://localhost/api/projects${query}`);
}

describe("GET /api/projects", () => {
  it("returns 401 when unauthenticated", async () => {
    const res = await GET(getRequest());
    expect(res.status).toBe(401);
  });

  it("returns 429 when the read rate limit is exceeded", async () => {
    state.clerkId = "clerk_1";
    state.readRateAllowed = false;
    const res = await GET(getRequest());
    expect(res.status).toBe(429);
    expect(readRateLimit).toHaveBeenCalledWith("clerk_1");
  });

  it("returns an empty array when the user has no db row yet", async () => {
    state.clerkId = "clerk_1";
    state.userRows = [];
    const res = await GET(getRequest());
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
    const res = await GET(getRequest());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(state.listedProjects);
  });

  it("includes a hasEdl boolean per row for the dashboard's 'Ready for step 2' label (ADR 0004 child 1, AC-5)", async () => {
    state.clerkId = "clerk_1";
    state.userRows = [{ id: "user-1" }];
    state.listedProjects = [
      { id: "p1", fileName: "a.mp4", transcriptStatus: "ready", hasEdl: false },
      { id: "p2", fileName: "b.mp4", transcriptStatus: "ready", hasEdl: true },
    ];
    const res = await GET(getRequest());
    const body = await res.json();
    expect(body[0].hasEdl).toBe(false);
    expect(body[1].hasEdl).toBe(true);
  });
});

// This route used to select every row a user had ever created, with no limit.
describe("GET /api/projects — paging", () => {
  beforeEach(() => {
    state.clerkId = "clerk_1";
    state.userRows = [{ id: "user-1" }];
  });

  it("passes the cursor and limit through to the page query", async () => {
    await GET(getRequest("?cursor=abc&limit=25"));
    expect(state.listCalls).toEqual([
      { userId: "user-1", options: { cursor: "abc", limit: 25 } },
    ]);
  });

  it("asks for the default page when no params are given", async () => {
    await GET(getRequest());
    expect(state.listCalls).toEqual([
      { userId: "user-1", options: { cursor: undefined, limit: undefined } },
    ]);
  });

  it("advertises the next page in X-Next-Cursor, keeping the body a bare array", async () => {
    state.listedProjects = [{ id: "p1" }];
    state.nextCursor = "2026-08-07T11:24:52.123456Z|abc";
    const res = await GET(getRequest());
    expect(res.headers.get("X-Next-Cursor")).toBe("2026-08-07T11:24:52.123456Z|abc");
    expect(Array.isArray(await res.json())).toBe(true);
  });

  it("omits X-Next-Cursor on the last page", async () => {
    state.listedProjects = [{ id: "p1" }];
    state.nextCursor = undefined;
    const res = await GET(getRequest());
    expect(res.headers.get("X-Next-Cursor")).toBeNull();
  });

  it("400s on a cursor it did not issue, rather than silently restarting at page one", async () => {
    state.listThrows = true;
    const res = await GET(getRequest("?cursor=garbage"));
    expect(res.status).toBe(400);
  });

  it("400s on a non-numeric limit", async () => {
    const res = await GET(getRequest("?limit=abc"));
    expect(res.status).toBe(400);
  });
});
