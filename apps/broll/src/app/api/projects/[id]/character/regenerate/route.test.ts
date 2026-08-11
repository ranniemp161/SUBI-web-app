import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@repo/server-shared/observability", () => ({ reportError: vi.fn() }));

const state = vi.hoisted(() => ({
  clerkId: "user_clerk" as string | null,
  dbUser: { id: "user-db" } as { id: string } | null,
  project: null as Record<string, unknown> | null,
  allowed: true,
  used: 0,
  assets: [] as Record<string, unknown>[],
  claim: "claimed" as string,
  regenError: null as Error | null,
  calls: [] as string[],
  releases: [] as unknown[][],
  anchorRead: [] as string[],
}));

vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn(async () => ({ userId: state.clerkId })),
}));

vi.mock("@repo/server-shared/authz", () => ({
  getAuthorizedDbUser: vi.fn(async () => state.dbUser),
}));

vi.mock("@repo/billing", () => ({
  claimBrollGeneration: vi.fn(async () => {
    state.calls.push("claim");
    return state.claim;
  }),
  releaseBrollClaimQuietly: vi.fn(async (...args: unknown[]) => {
    state.calls.push("release");
    state.releases.push(args);
  }),
}));

vi.mock("@/lib/projects", () => ({
  getBrollProject: vi.fn(async () => state.project),
}));

vi.mock("@/lib/assets", () => ({
  listCharacterAssets: vi.fn(async () => state.assets),
  regenerationsUsed: vi.fn(async () => state.used),
}));

vi.mock("@/lib/storage", () => ({
  isStorageConfigured: vi.fn(() => true),
  fetchAssetBytes: vi.fn(async (pathname: string) => {
    state.anchorRead.push(pathname);
    return new Uint8Array([1, 2, 3]).buffer;
  }),
}));

vi.mock("@/lib/character", async () => {
  const actual = await vi.importActual<typeof import("@/lib/character")>("@/lib/character");
  return {
    ...actual,
    isCharacterConfigured: vi.fn(() => true),
    regenerateVariant: vi.fn(async (input: { emotion: string }) => {
      state.calls.push("gemini");
      if (state.regenError) throw state.regenError;
      return { emotion: input.emotion, png: "aW1n", images: 1 };
    }),
  };
});

import { POST } from "./route";
import { CharacterError, isCharacterConfigured } from "@/lib/character";
import { isStorageConfigured } from "@/lib/storage";

/**
 * The regeneration route (spec `broll/0004`).
 *
 * Three things here are load bearing and invisible from the response body: the
 * cap is enforced **before** the Gemini call so hitting it costs nothing
 * (AC-64), the claim is taken so a set run cannot race it for the same row
 * (AC-72), and the anchor is read before the replacement lands, which is what
 * makes regenerating `neutral` work at all.
 */

const PROJECT_ID = "11111111-1111-1111-1111-111111111111";

function pathFor(emotion: string, attempt = 1) {
  return `broll/${PROJECT_ID}/${emotion}-${attempt}-0123456789abcdef.png`;
}

function asset(emotion: string, attempt = 1) {
  return {
    emotion,
    pathname: pathFor(emotion, attempt),
    width: 700,
    height: 900,
    byteSize: 1000,
    attempt,
  };
}

function post(emotion: unknown = "happy") {
  return POST(
    new Request("http://localhost:3003/api/projects/x/character/regenerate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ emotion }),
    }),
    { params: Promise.resolve({ id: PROJECT_ID }) }
  );
}

async function lines(response: Response): Promise<Record<string, unknown>[]> {
  const text = await response.text();
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

beforeEach(() => {
  state.clerkId = "user_clerk";
  state.dbUser = { id: "user-db" };
  state.project = { id: PROJECT_ID, style: "anime" };
  state.allowed = true;
  state.used = 0;
  state.assets = [asset("neutral"), asset("happy")];
  state.claim = "claimed";
  state.regenError = null;
  state.calls = [];
  state.releases = [];
  state.anchorRead = [];
  vi.clearAllMocks();
});

describe("the gates", () => {
  it("401s without a session", async () => {
    state.clerkId = null;
    expect((await post()).status).toBe(401);
  });

  it("404s someone else's project", async () => {
    state.project = null;
    expect((await post()).status).toBe(404);
  });

  // Same split as the generate route: the combined message named the wrong
  // missing credential.
  it("503s naming the image key when GEMINI_API_KEY is the missing one", async () => {
    vi.mocked(isCharacterConfigured).mockReturnValueOnce(false);
    const response = await post();
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: "Character generation isn't configured on this server.",
    });
    expect(state.calls).toEqual([]);
  });

  it("503s naming storage when BLOB_READ_WRITE_TOKEN is the missing one", async () => {
    vi.mocked(isStorageConfigured).mockReturnValueOnce(false);
    const response = await post();
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: "Storage isn't configured on this server.",
    });
    expect(state.calls).toEqual([]);
  });

  it("422s an emotion outside the six", async () => {
    expect((await post("smug")).status).toBe(422);
    expect(state.calls).toEqual([]);
  });

  it("404s a project with no set to redraw from", async () => {
    // Every regeneration anchors on the stored `neutral`, and the original
    // photograph is deliberately gone, so with no set there is nothing to
    // anchor on.
    state.assets = [];
    expect((await post()).status).toBe(404);
    expect(state.calls).toEqual([]);
  });
});

describe("the cap (AC-64)", () => {
  it("refuses at twelve, before any Gemini call and before taking the claim", async () => {
    state.used = 12;

    const response = await post();
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "REGEN_CAP" });
    // The cap costs nothing to hit, which is the whole reason it is checked here
    // rather than after the image comes back.
    expect(state.calls).toEqual([]);
  });

  it("allows the twelfth", async () => {
    state.used = 11;
    expect((await post()).status).toBe(200);
  });
});

describe("the claim (AC-72)", () => {
  it("refuses while a set run holds it, and makes no Gemini call", async () => {
    state.claim = "already_held";

    const response = await post();
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "ALREADY_RUNNING" });
    // Two writers racing for the same emotion row is exactly what this stops;
    // the loser's work would vanish with no error.
    expect(state.calls).toEqual(["claim"]);
  });

  it("takes the claim before reading the anchor or calling Gemini", async () => {
    await lines(await post());
    expect(state.calls.indexOf("claim")).toBeLessThan(state.calls.indexOf("gemini"));
  });

  it("gives the claim back when the redraw fails, so the project is not stranded", async () => {
    state.regenError = new CharacterError("failed", "The image service failed twice.");

    const terminal = (await lines(await post())).pop();
    expect(terminal).toMatchObject({ error: expect.stringContaining("failed twice") });
    expect(state.releases).toEqual([[PROJECT_ID]]);
  });
});

describe("the anchor and the new pathname", () => {
  it("anchors on the stored neutral for any other emotion", async () => {
    await lines(await post("skeptical"));
    expect(state.anchorRead).toEqual([pathFor("neutral")]);
  });

  it("anchors neutral on the current neutral, read before it is replaced", async () => {
    // Circular by nature, which is why the drift copy exists on the control.
    await lines(await post("neutral"));
    expect(state.anchorRead).toEqual([pathFor("neutral")]);
  });

  it("mints a new pathname at the next attempt, never the old one", async () => {
    state.assets = [asset("neutral"), asset("happy", 3)];

    const variant = (await lines(await post("happy"))).find((line) => line.png);

    // A new path every attempt: Vercel's CDN caches blobs for up to a month, so
    // an overwrite would serve back the very cutout the user rejected (AC-69).
    expect(variant?.pathname).toMatch(
      new RegExp(`^broll/${PROJECT_ID}/happy-4-[0-9a-f]{16}\\.png$`)
    );
    expect(variant?.pathname).not.toBe(pathFor("happy", 3));
  });

  it("starts at attempt 1 for an emotion that has no row yet", async () => {
    state.assets = [asset("neutral")];
    const variant = (await lines(await post("excited"))).find((line) => line.png);
    expect(variant?.pathname).toMatch(
      new RegExp(`^broll/${PROJECT_ID}/excited-1-[0-9a-f]{16}\\.png$`)
    );
  });
});
