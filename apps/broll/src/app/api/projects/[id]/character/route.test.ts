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
}));

vi.mock("@/lib/rate-limit", () => ({
  characterSetRateLimit: vi.fn(async () => ({
    allowed: state.allowed,
    remaining: 4,
    limit: 5,
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

import { POST, runtime, maxDuration } from "./route";
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
  state.project = { id: PROJECT_ID, style: "anime" };
  state.allowed = true;
  state.reserve = [];
  state.reclaimed = false;
  state.chainError = null;
  state.calls = [];
  state.settles = [];
  state.reserveArgs = [];
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
    state.project = { id: PROJECT_ID, style: "watercolour" };
    expect((await post()).status).toBe(409);
    expect(state.calls).toEqual([]);
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
    expect(state.calls).toEqual(["reserve"]);
  });

  it("409s a second concurrent Generate rather than charging twice (AC-15)", async () => {
    // A live run's hold is left alone. Stealing it would debit a second time and
    // orphan the first hold with nothing to refund it.
    state.reserve = [{ status: "already_held" }];
    state.reclaimed = false;

    const response = await post();
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "ALREADY_RUNNING" });
    expect(state.calls).toEqual(["reserve", "reclaim"]);
  });

  it("retries once after reclaiming a hold that really was abandoned", async () => {
    state.reserve = [{ status: "already_held" }, { status: "reserved", balance: 5 }];
    state.reclaimed = true;

    const response = await post();
    expect(response.status).toBe(200);
    expect(state.calls.slice(0, 3)).toEqual(["reserve", "reclaim", "reserve"]);
  });

  it("streams one line per variant, then a terminal line carrying the cost", async () => {
    const parsed = await lines(await post());

    const variants = parsed.filter((line) => typeof line.png === "string");
    expect(variants).toHaveLength(6);
    // The pathname is minted server side and travels outward only (AC-70).
    for (const variant of variants) {
      expect(variant.pathname).toMatch(
        new RegExp(`^broll/${PROJECT_ID}/[a-z]+-1-[0-9a-f]{16}\\.png$`)
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
