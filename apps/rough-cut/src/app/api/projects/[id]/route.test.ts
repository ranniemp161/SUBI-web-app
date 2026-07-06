import { describe, it, expect, vi, beforeEach } from "vitest";

const state = vi.hoisted(() => ({
  clerkId: null as string | null,
  ownedProject: null as Record<string, unknown> | null,
  deleted: 0,
}));

vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn(async () => ({ userId: state.clerkId })),
}));

// getOwnedProject is the ownership gate — return null to simulate "not owned".
vi.mock("@/lib/projects", () => ({
  getOwnedProject: vi.fn(async () => state.ownedProject),
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
      update: () => chain(() => [{}]),
    },
  };
});

import { GET, DELETE } from "./route";

const VALID_ID = "12345678-1234-1234-1234-123456789abc";
const params = Promise.resolve({ id: VALID_ID });

beforeEach(() => {
  state.clerkId = null;
  state.ownedProject = null;
  state.deleted = 0;
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
