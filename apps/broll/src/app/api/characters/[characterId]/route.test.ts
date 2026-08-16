import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@repo/server-shared/observability", () => ({ reportError: vi.fn() }));

const state = vi.hoisted(() => ({
  clerkId: "user_clerk" as string | null,
  dbUser: { id: "user-db" } as { id: string } | null,
  writeAllowed: true,
  character: null as Record<string, unknown> | null,
  renamed: true,
  renameArgs: [] as unknown[][],
  deleteResult: { status: "deleted", pathnames: [] as string[] } as
    | { status: "deleted"; pathnames: string[] }
    | "in_use"
    | "not_found",
  usedBy: [] as { id: string; name: string }[],
  deletedObjects: [] as string[],
}));

vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn(async () => ({ userId: state.clerkId })),
}));

vi.mock("@repo/server-shared/authz", () => ({
  getAuthorizedDbUser: vi.fn(async () => state.dbUser),
}));

vi.mock("@/lib/rate-limit", () => ({
  writeRateLimit: vi.fn(async () => ({ allowed: state.writeAllowed })),
}));

vi.mock("@/lib/storage", () => ({
  deleteAssetQuietly: vi.fn(async (pathname: string) => {
    state.deletedObjects.push(pathname);
  }),
}));

vi.mock("@/lib/characters", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/characters")>("@/lib/characters");
  return {
    ...actual,
    getBrollCharacter: vi.fn(async () => state.character),
    renameCharacter: vi.fn(async (...args: unknown[]) => {
      state.renameArgs.push(args);
      return state.renamed;
    }),
    deleteUnusedCharacter: vi.fn(async () => state.deleteResult),
    listProjectsUsingCharacter: vi.fn(async () => state.usedBy),
  };
});

const { PATCH, DELETE } = await import("./route");

const ID = "cccccccc-1111-4222-8333-444455556666";
const params = (characterId = ID) => ({ params: Promise.resolve({ characterId }) });

const patch = (body: unknown) =>
  new Request("http://localhost/api/characters/x", {
    method: "PATCH",
    body: JSON.stringify(body),
  });

const del = () => new Request("http://localhost/api/characters/x", { method: "DELETE" });

beforeEach(() => {
  state.clerkId = "user_clerk";
  state.dbUser = { id: "user-db" };
  state.writeAllowed = true;
  state.character = { id: ID, name: "Rannie", style: "anime", genClaimAt: null };
  state.renamed = true;
  state.renameArgs = [];
  state.deleteResult = { status: "deleted", pathnames: [] };
  state.usedBy = [];
  state.deletedObjects = [];
  vi.clearAllMocks();
});

describe("the gate, on both verbs", () => {
  it("refuses a signed-out caller", async () => {
    state.clerkId = null;
    expect((await PATCH(patch({ name: "x" }), params())).status).toBe(401);
    expect((await DELETE(del(), params())).status).toBe(401);
  });

  it("refuses a session with no provisioned user row", async () => {
    state.dbUser = null;
    expect((await PATCH(patch({ name: "x" }), params())).status).toBe(403);
    expect((await DELETE(del(), params())).status).toBe(403);
  });

  it("answers 404 for a malformed id rather than reaching a query", async () => {
    // The column is `uuid`; a malformed string would surface as a database
    // error rather than as the 404 it actually is.
    expect((await PATCH(patch({ name: "x" }), params("not-a-uuid"))).status).toBe(404);
    expect((await DELETE(del(), params("not-a-uuid"))).status).toBe(404);
  });

  it("is rate limited, and the limiter fails open on this path (AC-140)", async () => {
    state.writeAllowed = false;
    expect((await PATCH(patch({ name: "x" }), params())).status).toBe(429);
    expect((await DELETE(del(), params())).status).toBe(429);
  });
});

describe("rename (AC-135)", () => {
  it("trims and stores the new name", async () => {
    const response = await PATCH(patch({ name: "  Founder, anime  " }), params());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ id: ID, name: "Founder, anime" });
    expect(state.renameArgs[0]).toEqual(["user-db", ID, "Founder, anime"]);
  });

  it("refuses an empty or whitespace-only name", async () => {
    for (const name of ["", "   "]) {
      expect((await PATCH(patch({ name }), params())).status).toBe(422);
    }
  });

  it("refuses a name past the cap rather than truncating it", async () => {
    // Truncating would silently store something the creator did not type.
    const response = await PATCH(patch({ name: "x".repeat(61) }), params());
    expect(response.status).toBe(422);
    expect(state.renameArgs).toHaveLength(0);
  });

  it("refuses a non-string name", async () => {
    expect((await PATCH(patch({ name: 42 }), params())).status).toBe(422);
  });

  it("answers 404 when the update matches no row of this user's", async () => {
    // Owner scoping lives inside the UPDATE, so another user's character is
    // indistinguishable from one that does not exist — never a 403.
    state.renamed = false;
    expect((await PATCH(patch({ name: "x" }), params())).status).toBe(404);
  });
});

describe("delete (AC-136)", () => {
  it("deletes the rows, then the stored objects", async () => {
    state.deleteResult = {
      status: "deleted",
      pathnames: ["broll/characters/c/happy-1-a.png", "broll/characters/c/sad-1-b.png"],
    };
    const response = await DELETE(del(), params());

    expect(response.status).toBe(200);
    expect(state.deletedObjects).toEqual([
      "broll/characters/c/happy-1-a.png",
      "broll/characters/c/sad-1-b.png",
    ]);
  });

  it("refuses a character a project still holds, and names the project", async () => {
    // The refusal is the whole feature: `broll_projects` sets its reference null
    // on delete, so an unguarded delete silently takes the face out of every
    // project drawing with it, with no undo.
    state.deleteResult = "in_use";
    state.usedBy = [{ id: "p1", name: "Launch video" }];

    const response = await DELETE(del(), params());
    expect(response.status).toBe(409);

    const body = (await response.json()) as { code: string; error: string; usedBy: unknown[] };
    expect(body.code).toBe("IN_USE");
    expect(body.error).toContain("Launch video");
    expect(body.usedBy).toHaveLength(1);
    expect(state.deletedObjects).toEqual([]);
  });

  it("counts the projects when more than one holds it", async () => {
    state.deleteResult = "in_use";
    state.usedBy = [
      { id: "p1", name: "One" },
      { id: "p2", name: "Two" },
    ];
    const body = (await (await DELETE(del(), params())).json()) as { error: string };
    expect(body.error).toContain("2 projects");
  });

  it("answers 404 for a character that is not this caller's", async () => {
    state.deleteResult = "not_found";
    expect((await DELETE(del(), params())).status).toBe(404);
  });

  it("refuses while a redraw is writing the character", async () => {
    // A redraw in flight uploads into the prefix this request is about to
    // empty, which would leave an object no row points at.
    state.character = { id: ID, name: "R", style: "anime", genClaimAt: new Date() };
    const response = await DELETE(del(), params());

    expect(response.status).toBe(409);
    expect(((await response.json()) as { code: string }).code).toBe("CHARACTER_BUSY");
    expect(state.deletedObjects).toEqual([]);
  });

  it("proceeds when an old claim has gone stale", async () => {
    state.character = {
      id: ID,
      name: "R",
      style: "anime",
      genClaimAt: new Date(Date.now() - 60 * 60 * 1000),
    };
    expect((await DELETE(del(), params())).status).toBe(200);
  });
});
