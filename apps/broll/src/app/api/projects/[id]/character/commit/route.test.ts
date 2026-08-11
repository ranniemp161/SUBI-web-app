import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@repo/server-shared/observability", () => ({ reportError: vi.fn() }));

const state = vi.hoisted(() => ({
  clerkId: "user_clerk" as string | null,
  dbUser: { id: "user-db" } as { id: string } | null,
  project: null as Record<string, unknown> | null,
  holdMicros: 2_000_000 as number | null,
  stored: [] as Record<string, unknown>[],
  superseded: [] as string[],
  sizes: new Map<string, number | null>(),
  settles: [] as unknown[][],
  releases: [] as unknown[][],
  writes: [] as unknown[][],
  deleted: [] as string[],
  swept: [] as unknown[][],
}));

vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn(async () => ({ userId: state.clerkId })),
}));

vi.mock("@repo/server-shared/authz", () => ({
  getAuthorizedDbUser: vi.fn(async () => state.dbUser),
}));

vi.mock("@repo/billing", () => ({
  settleBrollHold: vi.fn(async (...args: unknown[]) => {
    state.settles.push(args);
  }),
  releaseBrollClaimQuietly: vi.fn(async (...args: unknown[]) => {
    state.releases.push(args);
  }),
}));

vi.mock("@/lib/projects", () => ({
  getBrollProject: vi.fn(async () => state.project),
  getBrollGenerationState: vi.fn(async () =>
    state.project ? { holdMicros: state.holdMicros, genClaimAt: null } : null
  ),
}));

vi.mock("@/lib/assets", () => ({
  listCharacterAssets: vi.fn(async () => state.stored),
  storeCharacterAssets: vi.fn(async (...args: unknown[]) => {
    state.writes.push(args);
    return { stored: (args[1] as unknown[]).length, superseded: state.superseded };
  }),
}));

vi.mock("@/lib/storage", () => ({
  assetByteSize: vi.fn(async (pathname: string) =>
    state.sizes.has(pathname) ? state.sizes.get(pathname) : 100_000
  ),
  deleteAssetQuietly: vi.fn(async (pathname: string) => {
    state.deleted.push(pathname);
  }),
  sweepOrphanedAssets: vi.fn(async (...args: unknown[]) => {
    state.swept.push(args);
    return 0;
  }),
}));

import { POST } from "./route";
import { CHARACTER_EMOTIONS } from "@/lib/emotions";

/**
 * The commit route (spec `broll/0004`).
 *
 * This is the route where a client supplied string would otherwise become a
 * stored `r2_key`, and the route that settles the hold. So the cases that matter
 * here are the pathname rejections (AC-70), the idempotent repeat that stops a
 * dropped response looking like a failed purchase (AC-71), and the money
 * boundary: what settles, what does not, and what a run whose claim already
 * expired is allowed to store (AC-63, AC-65).
 */

const PROJECT_ID = "11111111-1111-1111-1111-111111111111";
const OTHER_PROJECT_ID = "22222222-2222-2222-2222-222222222222";

function pathFor(emotion: string, attempt = 1) {
  return `broll/${PROJECT_ID}/${emotion}-${attempt}-0123456789abcdef.png`;
}

function fullSet(attempt = 1) {
  return CHARACTER_EMOTIONS.map((emotion) => ({
    emotion,
    pathname: pathFor(emotion, attempt),
    width: 700,
    height: 900,
  }));
}

function post(body: unknown, id = PROJECT_ID) {
  return POST(
    new Request("http://localhost:3003/api/projects/x/character/commit", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id }) }
  );
}

beforeEach(() => {
  state.clerkId = "user_clerk";
  state.dbUser = { id: "user-db" };
  state.project = { id: PROJECT_ID, style: "anime" };
  state.holdMicros = 2_000_000;
  state.stored = [];
  state.superseded = [];
  state.sizes = new Map();
  state.settles = [];
  state.releases = [];
  state.writes = [];
  state.deleted = [];
  state.swept = [];
  vi.clearAllMocks();
});

describe("authorization", () => {
  it("401s without a session", async () => {
    state.clerkId = null;
    expect((await post({ mode: "set", assets: fullSet() })).status).toBe(401);
  });

  it("404s a project this user does not own, rather than 403", async () => {
    // Owner scoped in the query, so someone else's project is indistinguishable
    // from a missing one and an id is never confirmed to a stranger (AC-38).
    state.project = null;
    expect((await post({ mode: "set", assets: fullSet() })).status).toBe(404);
  });
});

describe("pathname validation (AC-70)", () => {
  it("rejects a well formed pathname belonging to another project", async () => {
    // The case that actually matters: not a malformed string, but a real path
    // that is simply not this project's.
    const assets = fullSet();
    assets[2].pathname = `broll/${OTHER_PROJECT_ID}/surprised-1-0123456789abcdef.png`;

    const response = await post({ mode: "set", assets });
    expect(response.status).toBe(403);
    expect(state.writes).toHaveLength(0);
  });

  it.each([
    `broll/${PROJECT_ID}/../${OTHER_PROJECT_ID}/neutral-1-0123456789abcdef.png`,
    `broll/${PROJECT_ID}/nested/neutral-1-0123456789abcdef.png`,
    `broll/${PROJECT_ID}/neutral-1-0123456789abcdef.jpg`,
    `projects/${PROJECT_ID}/neutral-1-0123456789abcdef.png`,
  ])("rejects %s and stores nothing", async (pathname) => {
    const assets = fullSet();
    assets[0].pathname = pathname;

    expect((await post({ mode: "set", assets })).status).toBe(403);
    expect(state.writes).toHaveLength(0);
  });
});

describe("shape", () => {
  it("422s a mode it does not know", async () => {
    expect((await post({ mode: "everything", assets: fullSet() })).status).toBe(422);
  });

  it("422s a set that is not all six emotions", async () => {
    // A scene naming a variant that was never generated cannot be composited, so
    // a five of six commit is refused rather than stored (invariant 3).
    expect((await post({ mode: "set", assets: fullSet().slice(0, 5) })).status).toBe(422);
    expect(state.writes).toHaveLength(0);
  });

  it("422s a set with the same emotion twice", async () => {
    const assets = fullSet();
    assets[1].emotion = assets[0].emotion;
    expect((await post({ mode: "set", assets })).status).toBe(422);
  });

  it("422s a variant carrying more than one asset", async () => {
    expect((await post({ mode: "variant", assets: fullSet().slice(0, 2) })).status).toBe(422);
  });

  it("422s an unknown emotion", async () => {
    const assets = fullSet();
    assets[0].emotion = "smug" as never;
    assets[0].pathname = pathFor("smug");
    expect((await post({ mode: "set", assets })).status).toBe(422);
  });

  it("422s when an image never actually finished uploading", async () => {
    // The byte size is checkable, so it is checked rather than believed. This is
    // the difference between "uploaded" and "claimed to have uploaded".
    state.sizes.set(pathFor("thoughtful"), null);

    const response = await post({ mode: "set", assets: fullSet() });
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ error: expect.stringContaining("thoughtful") });
    expect(state.writes).toHaveLength(0);
    expect(state.settles).toHaveLength(0);
  });
});

describe("the money boundary", () => {
  it("stores a set, settles the hold, and sizes it server side", async () => {
    const response = await post({ mode: "set", assets: fullSet(), costMicros: 804_000 });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ settled: true });

    const [, rows, mode] = state.writes[0] as [string, { byteSize: number }[], string];
    expect(mode).toBe("set");
    // 100_000 is what `assetByteSize` reported, not anything the body claimed.
    expect(rows.every((row) => row.byteSize === 100_000)).toBe(true);

    expect(state.settles[0]).toEqual([
      PROJECT_ID,
      { status: "generated", costMicros: 804_000 },
    ]);
  });

  it("clamps an implausible cost figure and ignores a missing one", async () => {
    // The figure crosses a request boundary through the client, so it is bounded
    // here. It is margin reporting with no balance effect, which is what makes
    // that acceptable at all (AC-16).
    await post({ mode: "set", assets: fullSet(), costMicros: 99_000_000_000 });
    expect((state.settles[0][1] as { costMicros: number }).costMicros).toBe(4 * 840_000);

    state.settles = [];
    await post({ mode: "set", assets: fullSet() });
    // Null, so the estimate written at reserve stands rather than a zero.
    expect((state.settles[0][1] as { costMicros: number | null }).costMicros).toBeNull();

    state.settles = [];
    await post({ mode: "set", assets: fullSet(), costMicros: -5 });
    expect((state.settles[0][1] as { costMicros: number | null }).costMicros).toBeNull();
  });

  it("409s a set whose hold was already reclaimed, and stores nothing", async () => {
    // The run aged past ten minutes and refunded itself (AC-63). Storing the
    // images now would hand over a set the user has had their money back for.
    state.holdMicros = null;

    const response = await post({ mode: "set", assets: fullSet() });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "NO_HOLD" });
    expect(state.writes).toHaveLength(0);
  });

  it("moves no money on a variant, and lets the claim go", async () => {
    state.stored = [{ emotion: "neutral", pathname: pathFor("neutral"), width: 1, height: 1, byteSize: 1, attempt: 1 }];

    const response = await post({
      mode: "variant",
      assets: [{ emotion: "happy", pathname: pathFor("happy", 2), width: 700, height: 900 }],
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ settled: false });
    // Free (AC-64) — and the claim it took so no set run could race it is
    // released here (AC-72).
    expect(state.settles).toHaveLength(0);
    expect(state.releases).toEqual([[PROJECT_ID]]);
    expect((state.writes[0] as unknown[])[2]).toBe("variant");
  });
});

describe("idempotency (AC-71)", () => {
  it("answers 200 with the stored assets when the same body is posted twice", async () => {
    state.stored = CHARACTER_EMOTIONS.map((emotion) => ({
      emotion,
      pathname: pathFor(emotion),
      width: 700,
      height: 900,
      byteSize: 100_000,
      attempt: 1,
    }));
    // The first call already released it; a 409 here is what would make a
    // completed purchase look like a failed one.
    state.holdMicros = null;

    const response = await post({ mode: "set", assets: fullSet() });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ repeat: true, settled: false });
    expect(state.writes).toHaveLength(0);
    expect(state.settles).toHaveLength(0);
  });

  it("does not mistake a regenerated pathname for a repeat", async () => {
    // Same emotion, different object. This must store, not short circuit.
    state.stored = [
      { emotion: "happy", pathname: pathFor("happy", 1), width: 1, height: 1, byteSize: 1, attempt: 1 },
    ];

    const response = await post({
      mode: "variant",
      assets: [{ emotion: "happy", pathname: pathFor("happy", 2), width: 700, height: 900 }],
    });

    expect(response.status).toBe(200);
    expect(state.writes).toHaveLength(1);
  });
});

describe("replacement and orphans", () => {
  it("deletes the superseded object only after the row is written (AC-69)", async () => {
    const old = pathFor("happy", 1);
    state.superseded = [old];
    state.stored = [
      { emotion: "happy", pathname: old, width: 1, height: 1, byteSize: 1, attempt: 1 },
    ];

    await post({
      mode: "variant",
      assets: [{ emotion: "happy", pathname: pathFor("happy", 2), width: 700, height: 900 }],
    });

    expect(state.deleted).toEqual([old]);
    // The write happened first. The other order leaves an emotion with no image
    // at all if the write fails (invariant 6).
    expect(state.writes).toHaveLength(1);
  });

  it("sweeps unreferenced objects under the project prefix (AC-73)", async () => {
    state.stored = CHARACTER_EMOTIONS.map((emotion) => ({
      emotion,
      pathname: pathFor(emotion, 9),
      width: 1,
      height: 1,
      byteSize: 1,
      attempt: 1,
    }));

    await post({ mode: "set", assets: fullSet() });

    const [projectId, referenced] = state.swept[0] as [string, string[]];
    expect(projectId).toBe(PROJECT_ID);
    expect(referenced).toHaveLength(CHARACTER_EMOTIONS.length);
  });
});
