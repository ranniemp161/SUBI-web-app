import { describe, it, expect, vi, beforeEach } from "vitest";

const state = vi.hoisted(() => ({
  clerkId: null as string | null,
  ownedProject: null as Record<string, unknown> | null,
  aiCutRuns: [] as Record<string, unknown>[],
  deleted: 0,
  /** Rows the UPDATE returns — empty means the version guard matched nothing. */
  updateReturns: [{}] as Record<string, unknown>[],
  /** The `where` condition the route built, for inspecting the version guard. */
  lastWhere: null as unknown,
}));

vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn(async () => ({ userId: state.clerkId })),
}));

// getOwnedProject is the ownership gate — return null to simulate "not owned".
vi.mock("@/lib/projects", () => ({
  getOwnedProject: vi.fn(async () => state.ownedProject),
  listAiCutRuns: vi.fn(async () => state.aiCutRuns),
}));

vi.mock("@/lib/observability", () => ({ reportError: vi.fn() }));

vi.mock("@repo/db", () => {
  function chain(getResult: () => unknown) {
    const proxy: unknown = new Proxy(function () {}, {
      get(_t, prop) {
        if (prop === "then") {
          return (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
            Promise.resolve(getResult()).then(res, rej);
        }
        return () => proxy;
      },
    });
    return proxy;
  }
  return {
    db: {
      delete: () => {
        state.deleted++;
        return chain(() => []);
      },
      // Not the generic chain: the PATCH tests need the `where` condition the
      // route built (the optimistic-concurrency guard lives there).
      update: () => ({
        set: () => ({
          where: (condition: unknown) => {
            state.lastWhere = condition;
            return { returning: async () => state.updateReturns };
          },
        }),
      }),
    },
  };
});

import { GET, DELETE, PATCH } from "./route";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";

const VALID_ID = "12345678-1234-1234-1234-123456789abc";
const params = Promise.resolve({ id: VALID_ID });
const LOADED_AT = "2026-07-20T10:00:00.000Z";
const SAVED_AT = "2026-07-20T10:00:09.000Z";
const SERVER_EDL = {
  segments: [{ start: 0, end: 1, status: "keep", reason: null }],
};

/**
 * Compile the `where` condition the route built into real SQL. The db is
 * mocked (no connection), but the dialect and the schema are the real ones —
 * so this asserts the actual statement, not just the shape of an object.
 */
function compileWhere(): { sql: string; params: unknown[] } {
  return new PgDialect().sqlToQuery(state.lastWhere as SQL);
}

beforeEach(() => {
  state.clerkId = null;
  state.ownedProject = null;
  state.aiCutRuns = [];
  state.deleted = 0;
  state.updateReturns = [{ updatedAt: SAVED_AT }];
  state.lastWhere = null;
});

describe("GET /api/projects/:id — auth + ownership", () => {
  it("returns 401 when unauthenticated", async () => {
    const res = await GET(new Request("http://localhost"), { params });
    expect(res.status).toBe(401);
  });

  it("returns 404 when the project isn't owned by the caller", async () => {
    state.clerkId = "clerk_1";
    state.ownedProject = null;
    const res = await GET(new Request("http://localhost"), { params });
    expect(res.status).toBe(404);
  });

  it("returns the project when owned", async () => {
    state.clerkId = "clerk_1";
    state.ownedProject = { id: VALID_ID, fileName: "clip.mp4" };
    const res = await GET(new Request("http://localhost"), { params });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ id: VALID_ID, fileName: "clip.mp4" });
  });
});

describe("PATCH /api/projects/:id — optimistic concurrency", () => {
  const EDL_PATCH = [{ op: "replace", path: "/segments/0/end", value: 2 }];
  const patchRequest = (body: unknown) =>
    new Request("http://localhost", {
      method: "PATCH",
      body: JSON.stringify(body),
    });

  beforeEach(() => {
    state.clerkId = "clerk_1";
    state.ownedProject = { id: VALID_ID, userId: "user-1", edl: SERVER_EDL };
  });

  it("guards the write on the caller's base version", async () => {
    const res = await PATCH(
      patchRequest({ edlPatch: EDL_PATCH, baseUpdatedAt: LOADED_AT }),
      { params }
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, updatedAt: SAVED_AT });

    const where = compileWhere();
    // Truncated because the stored value can carry microseconds from
    // Postgres' now() default, while the client only ever round-trips
    // milliseconds through JSON.
    expect(where.sql).toContain(`date_trunc('milliseconds'`);
    expect(where.sql).toContain(`::timestamptz`);
    // Bound as a parameter, not interpolated into the statement.
    expect(where.params).toContain(LOADED_AT);
    expect(where.sql).not.toContain(LOADED_AT);
  });

  it("rejects a patch whose base version no longer matches, handing back current state", async () => {
    // The guarded UPDATE matches no rows — another writer moved the row on.
    state.updateReturns = [];
    state.ownedProject = {
      id: VALID_ID,
      userId: "user-1",
      edl: SERVER_EDL,
      updatedAt: SAVED_AT,
    };

    const res = await PATCH(
      patchRequest({ edlPatch: EDL_PATCH, baseUpdatedAt: LOADED_AT }),
      { params }
    );

    expect(res.status).toBe(409);
    const body = await res.json();
    // Everything the client needs to re-baseline without another round trip.
    expect(body.edl).toEqual(SERVER_EDL);
    expect(body.updatedAt).toBe(SAVED_AT);
  });

  it("writes unguarded when the caller sends no base version", async () => {
    const res = await PATCH(patchRequest({ edlPatch: EDL_PATCH }), { params });

    expect(res.status).toBe(200);
    const where = compileWhere();
    expect(where.sql).not.toContain("date_trunc");
    expect(where.params).not.toContain(LOADED_AT);
  });

  it("rejects a malformed base version rather than writing unguarded", async () => {
    const res = await PATCH(
      patchRequest({ edlPatch: EDL_PATCH, baseUpdatedAt: "yesterday" }),
      { params }
    );

    expect(res.status).toBe(400);
    expect(state.lastWhere).toBeNull(); // never reached the UPDATE
  });
});

describe("DELETE /api/projects/:id — ownership gate", () => {
  it("won't delete a project the caller doesn't own", async () => {
    state.clerkId = "clerk_1";
    state.ownedProject = null;
    const res = await DELETE(new Request("http://localhost"), { params });
    expect(res.status).toBe(404);
    expect(state.deleted).toBe(0); // never reached the delete
  });

  it("deletes an owned project", async () => {
    state.clerkId = "clerk_1";
    state.ownedProject = { id: VALID_ID };
    const res = await DELETE(new Request("http://localhost"), { params });
    expect(res.status).toBe(200);
    expect(state.deleted).toBe(1);
  });
});
