import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@repo/server-shared/observability", () => ({ reportError: vi.fn() }));

const state = vi.hoisted(() => ({
  clerkId: "user_clerk" as string | null,
  dbUser: { id: "user-db" } as { id: string } | null,
  project: null as Record<string, unknown> | null,
  allowed: true,
  reserve: [] as { status: string; balance?: number }[],
  reclaimed: false,
  chainError: null as Error | null,
  calls: [] as string[],
  settles: [] as unknown[][],
  reserveArgs: [] as unknown[][],
  characterCreate: { status: "created", id: "" } as
    | { status: "created"; id: string }
    | { status: "cap_reached" },
  characterCreateArgs: [] as unknown[][],
  // The attach path (PATCH), which shares this route file.
  writeAllowed: true,
  projectRef: null as { characterId: string | null } | null,
  resolution: { status: "not_found" } as
    | { status: "ok"; character: { id: string; name: string; style: string } }
    | { status: "not_found" }
    | { status: "incomplete" },
  attached: true,
  attachArgs: [] as unknown[][],
  detached: true,
  detachArgs: [] as unknown[][],
  // The character this project currently draws with (GET, and the AC-149
  // refusal). Null is a project that has none yet.
  projectCharacter: null as Record<string, unknown> | null,
  usedBy: [] as { id: string; name: string }[],
  regensUsed: 0,
}));

vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn(async () => ({ userId: state.clerkId })),
}));

vi.mock("@repo/server-shared/authz", () => ({
  getAuthorizedDbUser: vi.fn(async () => state.dbUser),
}));

vi.mock("@repo/billing", () => ({
  reserveBrollHold: vi.fn(async (...args: unknown[]) => {
    state.calls.push("reserve");
    state.reserveArgs.push(args);
    return state.reserve.shift() ?? { status: "reserved", balance: 100 };
  }),
  reclaimStaleBrollHold: vi.fn(async () => {
    state.calls.push("reclaim");
    return state.reclaimed;
  }),
  settleBrollHoldQuietly: vi.fn(async (...args: unknown[]) => {
    state.calls.push("settle");
    state.settles.push(args);
  }),
}));

vi.mock("@/lib/projects", () => ({
  getBrollProject: vi.fn(async () => state.project),
  getProjectCharacterRef: vi.fn(async () => state.projectRef),
}));

// Partially mocked on purpose: every query is replaced, and the pure claim
// liveness rule (AC-149) is the real one, because a stub of it would prove the
// route calls something rather than that a live claim actually refuses.
vi.mock("@/lib/characters", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/characters")>("@/lib/characters");
  return {
    ...actual,
    createBrollCharacter: vi.fn(async (...args: unknown[]) => {
      state.calls.push("character");
      state.characterCreateArgs.push(args);
      return state.characterCreate;
    }),
    resolveCompleteCharacter: vi.fn(async () => state.resolution),
    attachCharacterIfUnattached: vi.fn(async (...args: unknown[]) => {
      state.calls.push("attach");
      state.attachArgs.push(args);
      return state.attached;
    }),
    detachCharacterFromProject: vi.fn(async (...args: unknown[]) => {
      state.calls.push("detach");
      state.detachArgs.push(args);
      return state.detached;
    }),
    getProjectCharacter: vi.fn(async () => state.projectCharacter),
    listProjectsUsingCharacter: vi.fn(async () => state.usedBy),
  };
});

vi.mock("@/lib/assets", () => ({
  regenerationsUsed: vi.fn(async () => state.regensUsed),
}));

vi.mock("@/lib/rate-limit", () => ({
  characterSetRateLimit: vi.fn(async () => ({
    allowed: state.allowed,
    remaining: 4,
    limit: 5,
  })),
  writeRateLimit: vi.fn(async () => ({
    allowed: state.writeAllowed,
    remaining: 119,
    limit: 120,
  })),
}));

vi.mock("@/lib/storage", () => ({ isStorageConfigured: vi.fn(() => true) }));

vi.mock("@/lib/character", async () => {
  const actual = await vi.importActual<typeof import("@/lib/character")>("@/lib/character");
  return {
    ...actual,
    isCharacterConfigured: vi.fn(() => true),
    runCharacterChain: vi.fn(
      async (input: { onTurn: (turn: unknown) => Promise<void> | void }) => {
        state.calls.push("gemini");
        if (state.chainError) throw state.chainError;
        for (const emotion of ["neutral", "happy", "surprised", "thoughtful", "skeptical", "excited"]) {
          await input.onTurn({ emotion, png: "aW1n", images: 1 });
        }
        return { images: 6 };
      }
    ),
  };
});

import { GET, PATCH, POST, runtime, maxDuration } from "./route";
import { CharacterError, isCharacterConfigured } from "@/lib/character";
import { isStorageConfigured } from "@/lib/storage";

/**
 * The generation route (spec `broll/0004`).
 *
 * The thing worth testing here is **order**, not output: the rate limit and the
 * reserve both have to land before a single paid Gemini call, and a run that
 * fails has to give the whole hold back. Those are the criteria that cost real
 * money when they regress, and none of them is visible from the response body.
 */

const PROJECT_ID = "11111111-1111-1111-1111-111111111111";
const CHARACTER_ID = "22222222-2222-2222-2222-222222222222";

function photo(bytes = 1000, type = "image/png") {
  return new File([new Uint8Array(bytes)], "me.png", { type });
}

function post(file: File | null = photo()) {
  const form = new FormData();
  if (file) form.append("photo", file);
  return POST(
    new Request("http://localhost:3003/api/projects/x/character", {
      method: "POST",
      body: form,
    }),
    { params: Promise.resolve({ id: PROJECT_ID }) }
  );
}

/** Drain the NDJSON stream into its parsed lines. */
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
  state.project = { id: PROJECT_ID, name: "Fuel imports", style: "anime" };
  state.allowed = true;
  state.reserve = [];
  state.reclaimed = false;
  state.chainError = null;
  state.calls = [];
  state.settles = [];
  state.reserveArgs = [];
  state.characterCreate = { status: "created", id: CHARACTER_ID };
  state.characterCreateArgs = [];
  state.writeAllowed = true;
  state.projectRef = { characterId: null };
  state.resolution = {
    status: "ok",
    character: { id: CHARACTER_ID, name: "Fuel imports", style: "3d-render" },
  };
  state.attached = true;
  state.detached = true;
  state.detachArgs = [];
  state.attachArgs = [];
  state.projectCharacter = null;
  state.usedBy = [];
  state.regensUsed = 0;
  vi.clearAllMocks();
});

describe("transport", () => {
  it("runs on the edge with the 300 second ceiling, like the planner", () => {
    // Streaming defeats the proxy's idle timeout; it does nothing about the
    // function duration ceiling, which is a separate limit. Both are needed.
    expect(runtime).toBe("edge");
    expect(maxDuration).toBe(300);
  });
});

describe("the gates before any money", () => {
  it("401s without a session, and never reaches the limiter", async () => {
    state.clerkId = null;
    expect((await post()).status).toBe(401);
    expect(state.calls).toEqual([]);
  });

  it("429s over the rate limit before anything is reserved (AC-68)", async () => {
    state.allowed = false;
    expect((await post()).status).toBe(429);
    expect(state.calls).toEqual([]);
  });

  it("404s someone else's project rather than 403", async () => {
    state.project = null;
    expect((await post()).status).toBe(404);
    expect(state.calls).toEqual([]);
  });

  // Two credentials, two messages. These were one combined check whose message
  // always blamed the Gemini key, so a server with the key set and the blob
  // token missing sent whoever read it to the wrong variable.
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

  it("413s a photo over the cap, before reserving", async () => {
    const response = await post(photo(11 * 1024 * 1024));
    expect(response.status).toBe(413);
    expect(state.calls).toEqual([]);
  });

  it("415s a format Gemini does not take", async () => {
    expect((await post(photo(1000, "image/gif"))).status).toBe(415);
    expect(state.calls).toEqual([]);
  });

  it("accepts heic, which is what an iPhone actually shoots", async () => {
    // Most non Safari browsers cannot render a local preview of heic. Rejecting
    // the format the likeliest camera produces would be the worse failure.
    expect((await post(photo(1000, "image/heic"))).status).toBe(200);
  });

  it("400s with no photo at all", async () => {
    expect((await post(null)).status).toBe(400);
    expect(state.calls).toEqual([]);
  });

  it("409s a project whose style is no longer offered", async () => {
    state.project = { id: PROJECT_ID, name: "Fuel imports", style: "watercolour" };
    expect((await post()).status).toBe(409);
    expect(state.calls).toEqual([]);
  });

  it("409s at the character cap, before any charge and any Gemini call (AC-139)", async () => {
    // The cap is counted inside the insert, so this branch is the loser of that
    // statement rather than a check that raced it. Hitting it must cost nothing.
    state.characterCreate = { status: "cap_reached" };

    const response = await post();
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "CHARACTER_CAP" });
    expect(state.calls).toEqual(["character"]);
  });
});

describe("a paid re-run against a busy character (AC-149)", () => {
  function character(genClaimAt: Date | null) {
    return {
      id: "44444444-4444-4444-4444-444444444444",
      name: "Fuel imports",
      style: "anime",
      genClaimAt,
      createdAt: new Date(),
    };
  }

  it("409s while the project's current character is being redrawn", async () => {
    state.projectCharacter = character(new Date());

    const response = await post();
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "CHARACTER_BUSY" });
    // Nothing is corrupted without this gate — the redraw writes the old
    // character and the re-run fills a new one. What it protects is the redraw
    // the creator is watching, on a character this request would detach them
    // from seconds later. So it must cost nothing: no character row, no hold.
    expect(state.calls).toEqual([]);
  });

  it("allows it once the claim has aged past the stale window", async () => {
    // Ten minutes and a second: the browser that took this claim is gone, and
    // there is nothing to refund, so the row is free.
    state.projectCharacter = character(new Date(Date.now() - 601_000));
    expect((await post()).status).toBe(200);
  });

  it("allows it on a project whose character has no claim at all", async () => {
    state.projectCharacter = character(null);
    expect((await post()).status).toBe(200);
  });

  it("allows it on a project with no character yet", async () => {
    state.projectCharacter = null;
    expect((await post()).status).toBe(200);
  });
});

describe("the character the run writes (spec `broll/0007`)", () => {
  it("creates it before the money is reserved, so the cap costs nothing", async () => {
    await lines(await post());
    expect(state.calls.indexOf("character")).toBeLessThan(
      state.calls.indexOf("reserve")
    );
  });

  it("names it from the project and takes the project's style", async () => {
    // Snapshotted as text. The character carries no reference back, so this is
    // the only moment the project's name reaches it.
    await lines(await post());
    expect(state.characterCreateArgs[0][0]).toEqual({
      userId: "user-db",
      name: "Fuel imports",
      style: "anime",
    });
  });

  it("streams the character id as the opening line, before any turn", async () => {
    // The browser hands this back to `commit`. Without it first, a run that
    // died partway would leave the browser unable to name what it had bought.
    const parsed = await lines(await post());
    expect(parsed[0]).toEqual({ characterId: CHARACTER_ID });
  });
});

describe("reserve, generate, settle (AC-14)", () => {
  it("reserves before the first Gemini call, never after", async () => {
    await lines(await post());
    // The whole point: an overdraft is rejected by the CHECK before we have
    // spent anything at the vendor.
    expect(state.calls.indexOf("reserve")).toBeLessThan(state.calls.indexOf("gemini"));
  });

  it("402s an overdraft and makes no Gemini call", async () => {
    state.reserve = [{ status: "insufficient" }];
    const response = await post();
    expect(response.status).toBe(402);
    expect(await response.json()).toMatchObject({ code: "INSUFFICIENT_CREDITS" });
    expect(state.calls).toEqual(["character", "reserve"]);
  });

  it("409s a second concurrent Generate rather than charging twice (AC-15)", async () => {
    // A live run's hold is left alone. Stealing it would debit a second time and
    // orphan the first hold with nothing to refund it.
    state.reserve = [{ status: "already_held" }];
    state.reclaimed = false;

    const response = await post();
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "ALREADY_RUNNING" });
    expect(state.calls).toEqual(["character", "reserve", "reclaim"]);
  });

  it("retries once after reclaiming a hold that really was abandoned", async () => {
    state.reserve = [{ status: "already_held" }, { status: "reserved", balance: 5 }];
    state.reclaimed = true;

    const response = await post();
    expect(response.status).toBe(200);
    expect(state.calls.slice(0, 4)).toEqual([
      "character",
      "reserve",
      "reclaim",
      "reserve",
    ]);
  });

  it("streams one line per variant, then a terminal line carrying the cost", async () => {
    const parsed = await lines(await post());

    const variants = parsed.filter((line) => typeof line.png === "string");
    expect(variants).toHaveLength(6);
    // The pathname is minted server side and travels outward only (AC-70), and
    // it names the character rather than the project (AC-141).
    for (const variant of variants) {
      expect(variant.pathname).toMatch(
        new RegExp(`^broll/characters/${CHARACTER_ID}/[a-z]+-1-[0-9a-f]{16}\\.png$`)
      );
    }

    const terminal = parsed[parsed.length - 1];
    // Six images at the Pro tier rate. The hold is settled by `commit`, not
    // here, so this figure is what the browser hands back (AC-16).
    expect(terminal).toMatchObject({ done: true, costMicros: 6 * 134_000 });
    expect(state.settles).toHaveLength(0);
  });

  it("refunds in full and stores nothing when the chain gives up (AC-62)", async () => {
    state.chainError = new CharacterError("failed", "The image service failed twice.");

    const parsed = await lines(await post());
    const terminal = parsed[parsed.length - 1];

    expect(terminal).toMatchObject({ refunded: true, code: "failed" });
    expect(state.settles).toEqual([[PROJECT_ID, { status: "failed" }]]);
    // A partial set is never left behind: no variant line was emitted.
    expect(parsed.filter((line) => typeof line.png === "string")).toHaveLength(0);
  });

  it("keeps a post-200 failure inside the terminal line, not as a status", async () => {
    state.chainError = new Error("boom");
    const response = await post();

    // The 200 is already committed by the time the chain runs, so `res.json()`
    // on this route would be a lie and a deadlock.
    expect(response.status).toBe(200);
    const terminal = (await lines(response)).pop();
    expect(terminal).toMatchObject({ refunded: true });
    expect(terminal?.error).toContain("not been charged");
  });
});

// ---------------------------------------------------------------------------
// GET — what this project draws with, and who else draws with it (AC-133).
// ---------------------------------------------------------------------------

function get() {
  return GET(new Request("http://localhost:3003/api/projects/x/character"), {
    params: Promise.resolve({ id: PROJECT_ID }),
  });
}

describe("GET — the character and its blast radius (AC-133)", () => {
  const OTHER_PROJECT = "55555555-5555-5555-5555-555555555555";

  beforeEach(() => {
    state.projectCharacter = {
      id: CHARACTER_ID,
      name: "Fuel imports",
      style: "anime",
      genClaimAt: null,
      createdAt: new Date("2026-08-14T00:00:00Z"),
    };
  });

  it("names every project drawing with this character, this one included", async () => {
    // The control shows the *others*; the full list is what makes the count
    // sayable without a second request, and what the delete refusal will need.
    state.usedBy = [
      { id: PROJECT_ID, name: "Fuel imports" },
      { id: OTHER_PROJECT, name: "Q3 recap" },
    ];

    const response = await get();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      character: { id: CHARACTER_ID, name: "Fuel imports", busy: false },
      usedBy: [
        { id: PROJECT_ID, name: "Fuel imports" },
        { id: OTHER_PROJECT, name: "Q3 recap" },
      ],
    });
  });

  it("answers the allowance from the character, not from the project (AC-131)", async () => {
    // Reusing a face on a second project does not refill its redraws: this
    // number is derived from the character's own rows.
    state.regensUsed = 5;
    expect((await (await get()).json()).regenerations).toEqual({
      used: 5,
      left: 7,
      max: 12,
    });
  });

  it("reports a live claim as busy", async () => {
    state.projectCharacter = { ...state.projectCharacter, genClaimAt: new Date() };
    expect((await (await get()).json()).character.busy).toBe(true);
  });

  it("answers 200 with no character for a project that has none", async () => {
    // Not a 404: the project exists and is the caller's. Only a project that is
    // not theirs is indistinguishable from a missing one.
    state.projectCharacter = null;
    const response = await get();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      character: null,
      usedBy: [],
      regenerations: null,
    });
  });

  it("404s a project that is not the caller's", async () => {
    state.projectRef = null;
    expect((await get()).status).toBe(404);
  });

  it("401s without a session", async () => {
    state.clerkId = null;
    expect((await get()).status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// PATCH — attaching a character the creator already owns (spec `broll/0007`
// AC-122 to AC-124, AC-147, AC-148). It shares this file with the generate
// route because it is the same resource, one free and one paid.
// ---------------------------------------------------------------------------

function patch(body: unknown) {
  return PATCH(
    new Request("http://localhost:3003/api/projects/x/character", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: PROJECT_ID }) }
  );
}

describe("PATCH — attach", () => {
  it("attaches a complete character the caller owns, and charges nothing", async () => {
    const response = await patch({ characterId: CHARACTER_ID });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      character: { id: CHARACTER_ID, name: "Fuel imports", style: "3d-render" },
    });
    expect(state.attachArgs).toEqual([["user-db", PROJECT_ID, CHARACTER_ID]]);
    // The money calls are the same mocks the generate route uses, so an empty
    // list here is the whole of AC-124: no reserve, no settle, no ledger row.
    expect(state.calls).toEqual(["attach"]);
  });

  it("401s without a session", async () => {
    state.clerkId = null;
    expect((await patch({ characterId: CHARACTER_ID })).status).toBe(401);
    expect(state.calls).toEqual([]);
  });

  it("422s a body with no usable character id, before any query", async () => {
    // The column is `uuid`: an unchecked string is a database error rather than
    // the refusal it is.
    for (const body of [{}, { characterId: 42 }, { characterId: "../../else" }]) {
      const response = await patch(body);
      expect(response.status).toBe(422);
    }
    expect(state.calls).toEqual([]);
  });

  it("404s a project that is not the caller's", async () => {
    state.projectRef = null;
    expect((await patch({ characterId: CHARACTER_ID })).status).toBe(404);
    expect(state.calls).toEqual([]);
  });

  it("409s a project that already has a character — there is no swap (AC-123)", async () => {
    state.projectRef = { characterId: "99999999-9999-4999-8999-999999999999" };
    const response = await patch({ characterId: CHARACTER_ID });

    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe("ALREADY_ATTACHED");
    expect(state.calls).toEqual([]);
  });

  it("404s another user's character, exactly like a missing one (AC-143)", async () => {
    state.resolution = { status: "not_found" };
    expect((await patch({ characterId: CHARACTER_ID })).status).toBe(404);
    expect(state.calls).toEqual([]);
  });

  it("409s a five of six character rather than trusting the picker (AC-147)", async () => {
    state.resolution = { status: "incomplete" };
    const response = await patch({ characterId: CHARACTER_ID });

    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe("INCOMPLETE");
    expect(state.calls).toEqual([]);
  });

  it("409s when the atomic attach loses to a concurrent one", async () => {
    // The read above it says the project has no character; this says another
    // request attached one in between. The refusal is the same either way.
    state.attached = false;
    const response = await patch({ characterId: CHARACTER_ID });

    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe("ALREADY_ATTACHED");
  });

  it("429s over the write limiter, which fails open (AC-140)", async () => {
    state.writeAllowed = false;
    expect((await patch({ characterId: CHARACTER_ID })).status).toBe(429);
    expect(state.calls).toEqual([]);
  });
});

describe("PATCH — detach (AC-137)", () => {
  it("clears the project's character and answers with none", async () => {
    const response = await patch({ characterId: null });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ character: null });
    expect(state.detachArgs[0]).toEqual(["user-db", PROJECT_ID]);
  });

  it("moves no money and deletes nothing", async () => {
    // The whole criterion. A detach that touched the ledger would be charging
    // for undoing something that was free to do.
    await patch({ characterId: null });
    expect(state.calls).not.toContain("reserve");
    expect(state.calls).not.toContain("settle");
    expect(state.calls).not.toContain("reclaim");
  });

  it("never reaches the attach path", async () => {
    await patch({ characterId: null });
    expect(state.calls).not.toContain("attach");
  });

  it("answers 404 when there is nothing to detach", async () => {
    // Either the project has no character or it is not this caller's. Both
    // answer the same way, so a project id is never confirmed to a stranger.
    state.detached = false;
    expect((await patch({ characterId: null })).status).toBe(404);
  });

  it("tells an explicit null apart from a missing field", async () => {
    // `{}` is a malformed request; `{characterId: null}` is an intention. The
    // two must not collapse, or a broken client silently detaches.
    const response = await patch({});
    expect(response.status).toBe(422);
    expect(state.calls).not.toContain("detach");
  });
});
