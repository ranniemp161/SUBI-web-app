import { describe, it, expect, vi, beforeEach } from "vitest";

const state = vi.hoisted(() => ({
  clerkId: null as string | null,
  dbUser: null as { id: string; balanceMicros: number } | null,
  rateAllowed: true,
  ownedProject: null as
    | { id: string; durationMs?: number | null; transcriptStatus?: string }
    | null,
  reserveResults: [] as Array<
    | { status: "reserved"; balance: number }
    | { status: "insufficient" }
    | { status: "already_held" }
  >,
  reserveCalls: [] as Array<{ userId: string; projectId: string; cost: number }>,
  settled: [] as Array<{ projectId: string; actual: number | null }>,
  reclaimResults: [] as boolean[],
  reclaimCalls: [] as Array<{ projectId: string; staleAfterMs: number }>,
  updates: [] as Record<string, unknown>[],
  deletedUrls: [] as string[],
}));

vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn(async () => ({ userId: state.clerkId })),
  currentUser: vi.fn(async () => ({ unsafeMetadata: {} })),
}));

vi.mock("@/lib/authz", () => ({
  getAuthorizedDbUser: vi.fn(async () => state.dbUser),
}));

vi.mock("@/lib/credits", () => ({
  costSecondsForDurationMs: vi.fn((ms: number | null | undefined) =>
    ms && ms > 0 ? Math.max(1, Math.ceil(ms / 1000)) : 60
  ),
  secondsFromDeepgramDuration: vi.fn((d: number | null | undefined) =>
    d && d > 0 ? Math.max(1, Math.ceil(d)) : null
  ),
  memberGrantMicros: vi.fn(() => 19_000_000),
  ensureMonthlyGrant: vi.fn(async () => {}),
  reserveCredits: vi.fn(async (userId: string, projectId: string, cost: number) => {
    state.reserveCalls.push({ userId, projectId, cost });
    return state.reserveResults.shift() ?? { status: "reserved", balance: 1000 };
  }),
  settleHold: vi.fn(async (projectId: string, actual: number | null) => {
    state.settled.push({ projectId, actual });
  }),
  reclaimStaleHold: vi.fn(async (projectId: string, staleAfterMs: number) => {
    state.reclaimCalls.push({ projectId, staleAfterMs });
    return state.reclaimResults.shift() ?? false;
  }),
  STALE_HOLD_MS: 10_000,
}));

vi.mock("@/lib/rate-limit", () => ({
  rateLimit: vi.fn(async () => ({
    allowed: state.rateAllowed,
    remaining: state.rateAllowed ? 29 : 0,
    limit: 30,
  })),
}));

vi.mock("@/lib/projects", () => ({
  getOwnedProject: vi.fn(async () => state.ownedProject),
}));

vi.mock("@vercel/blob", () => ({
  del: vi.fn(async (url: string) => {
    state.deletedUrls.push(url);
  }),
}));

vi.mock("@/lib/observability", () => ({ reportError: vi.fn() }));

vi.mock("@repo/db", () => ({
  db: {
    update: () => ({
      set: (v: Record<string, unknown>) => {
        state.updates.push(v);
        return { where: () => Promise.resolve() };
      },
    }),
  },
}));

import { POST } from "./route";
import { rateLimit } from "@/lib/rate-limit";
import { reserveCredits, settleHold, ensureMonthlyGrant } from "@/lib/credits";
import { del } from "@vercel/blob";

const OWN_BLOB_URL = "https://abc123.public.blob.vercel-storage.com/projects/x/audio.m4a";

function req(body?: unknown, projectId = "x") {
  return new Request(`http://localhost/api/transcribe/deepgram?projectId=${projectId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

beforeEach(() => {
  state.clerkId = null;
  state.dbUser = null;
  state.rateAllowed = true;
  state.ownedProject = null;
  state.reserveResults = [];
  state.reserveCalls = [];
  state.settled = [];
  state.reclaimResults = [];
  state.reclaimCalls = [];
  state.updates = [];
  state.deletedUrls = [];
  vi.clearAllMocks();
  delete process.env.DEEPGRAM_API_KEY;
  delete process.env.PUBLIC_APP_URL;
});

function authorize() {
  state.clerkId = "clerk_1";
  state.dbUser = { id: "user-1", balanceMicros: 19_000_000 };
}

describe("POST /api/transcribe/deepgram — request guards", () => {
  it("401 when unauthenticated (and never checks the rate limit)", async () => {
    const res = await POST(req());
    expect(res.status).toBe(401);
    expect(rateLimit).not.toHaveBeenCalled();
  });

  it("403 without an authorized users row", async () => {
    state.clerkId = "clerk_1";
    state.dbUser = null;
    const res = await POST(req());
    expect(res.status).toBe(403);
    expect(rateLimit).not.toHaveBeenCalled();
  });

  it("429 when the transcription rate limit is exceeded", async () => {
    authorize();
    state.rateAllowed = false;
    const res = await POST(req());
    expect(res.status).toBe(429);
    expect(rateLimit).toHaveBeenCalledWith("transcribe:clerk_1", 30, 3600);
  });

  it("404 when the project isn't found or owned", async () => {
    authorize();
    state.ownedProject = null;
    process.env.DEEPGRAM_API_KEY = "key";
    const res = await POST(req({ blobUrl: OWN_BLOB_URL }));
    expect(res.status).toBe(404);
  });

  it("400 when blobUrl is missing (and reserves nothing)", async () => {
    authorize();
    state.ownedProject = { id: "x" };
    process.env.DEEPGRAM_API_KEY = "key";
    const res = await POST(req({}));
    expect(res.status).toBe(400);
    expect(reserveCredits).not.toHaveBeenCalled();
  });

  it("400 when blobUrl doesn't belong to a Vercel Blob store (SSRF guard)", async () => {
    authorize();
    state.ownedProject = { id: "x" };
    process.env.DEEPGRAM_API_KEY = "key";
    const res = await POST(req({ blobUrl: "https://evil.example.com/steal-our-quota" }));
    expect(res.status).toBe(400);
    expect(reserveCredits).not.toHaveBeenCalled();
  });
});

describe("POST /api/transcribe/deepgram — credit gating", () => {
  beforeEach(() => {
    authorize();
    state.ownedProject = { id: "x", durationMs: 120_000, transcriptStatus: "idle" };
    process.env.DEEPGRAM_API_KEY = "key";
  });

  it("402 with INSUFFICIENT_CREDITS when the reserve fails on balance", async () => {
    state.reserveResults = [{ status: "insufficient" }];
    const res = await POST(req({ blobUrl: OWN_BLOB_URL }));
    expect(res.status).toBe(402);
    const body = await res.json();
    expect(body.code).toBe("INSUFFICIENT_CREDITS");
    expect(body.requiredSeconds).toBe(120);
    expect(ensureMonthlyGrant).toHaveBeenCalledWith("user-1", 19_000_000);
  });

  it("reserves the ceil of the client-reported duration", async () => {
    state.reserveResults = [{ status: "insufficient" }];
    await POST(req({ blobUrl: OWN_BLOB_URL }));
    expect(state.reserveCalls).toEqual([
      { userId: "user-1", projectId: "x", cost: 120 },
    ]);
  });

  it("409 when a live job already holds the project and the hold isn't stale", async () => {
    state.ownedProject = { id: "x", durationMs: 120_000, transcriptStatus: "processing" };
    state.reserveResults = [{ status: "already_held" }];
    state.reclaimResults = [false];
    const res = await POST(req({ blobUrl: OWN_BLOB_URL }));
    expect(res.status).toBe(409);
    expect(state.reclaimCalls).toEqual([{ projectId: "x", staleAfterMs: 10_000 }]);
    // A live job's hold must not be refunded — reclaimStaleHold correctly
    // said no, so there's no second reserve attempt.
    expect(state.reserveCalls).toHaveLength(1);
  });

  it("409 — regression: a fresh concurrent hold is never mistaken for abandoned", async () => {
    // This is the exact race that used to be decided by a stale in-memory
    // transcriptStatus snapshot (captured before the reserve attempt, so it
    // could never distinguish "crashed" from "a concurrent request just
    // reserved and hasn't flipped to processing yet"). Both look identical
    // to that snapshot — "not processing" — yet the hold is live. The real
    // gate now lives entirely inside reclaimStaleHold (verified against the
    // real DB in lib/credits.ts), so here we only need to prove the route
    // defers to it and never second-guesses a `false` result.
    state.ownedProject = { id: "x", durationMs: 120_000, transcriptStatus: "idle" };
    state.reserveResults = [{ status: "already_held" }];
    state.reclaimResults = [false];
    const res = await POST(req({ blobUrl: OWN_BLOB_URL }));
    expect(res.status).toBe(409);
    expect(state.reserveCalls).toHaveLength(1);
    expect(settleHold).not.toHaveBeenCalled();
  });

  it("self-heals a genuinely stale hold (crashed job) with a reclaim and one retry", async () => {
    state.ownedProject = { id: "x", durationMs: 120_000, transcriptStatus: "failed" };
    state.reserveResults = [{ status: "already_held" }, { status: "insufficient" }];
    state.reclaimResults = [true];
    const res = await POST(req({ blobUrl: OWN_BLOB_URL }));
    expect(state.reclaimCalls).toEqual([{ projectId: "x", staleAfterMs: 10_000 }]);
    expect(state.reserveCalls).toHaveLength(2);
    expect(res.status).toBe(402);
  });
});

describe("POST /api/transcribe/deepgram — sync mode (localhost)", () => {
  beforeEach(() => {
    authorize();
    state.ownedProject = { id: "x", durationMs: 120_000, transcriptStatus: "idle" };
    process.env.DEEPGRAM_API_KEY = "key";
  });

  it("stores the transcript, settles on Deepgram's duration, and deletes the blob", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          metadata: { duration: 93.2 },
          results: { channels: [{ alternatives: [{ transcript: "hi", words: [] }] }] },
        }),
      }))
    );

    const res = await POST(req({ blobUrl: OWN_BLOB_URL }));

    expect(res.status).toBe(200);
    expect(del).toHaveBeenCalledWith(OWN_BLOB_URL);
    const finalUpdate = state.updates.at(-1);
    expect(finalUpdate?.transcriptStatus).toBe("ready");
    // Reconciled against the authoritative duration, not the client's.
    expect(state.settled).toEqual([{ projectId: "x", actual: 94 }]);

    vi.unstubAllGlobals();
  });

  it("marks failed, refunds the hold, and deletes the blob when Deepgram rejects", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 400,
        text: async () => JSON.stringify({ err_msg: "corrupt audio" }),
      }))
    );

    const res = await POST(req({ blobUrl: OWN_BLOB_URL }));

    expect(res.status).toBe(502);
    expect(del).toHaveBeenCalledWith(OWN_BLOB_URL);
    const finalUpdate = state.updates.at(-1);
    expect(finalUpdate?.transcriptStatus).toBe("failed");
    expect(state.settled).toEqual([{ projectId: "x", actual: 0 }]);

    vi.unstubAllGlobals();
  });

  it("refunds the hold when the route throws mid-flight", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      })
    );

    const res = await POST(req({ blobUrl: OWN_BLOB_URL }));

    expect(res.status).toBe(500);
    expect(state.settled).toEqual([{ projectId: "x", actual: 0 }]);

    vi.unstubAllGlobals();
  });
});

describe("POST /api/transcribe/deepgram — callback mode (public host)", () => {
  it("keeps the hold — the callback route settles it later", async () => {
    authorize();
    state.ownedProject = { id: "x", durationMs: 120_000, transcriptStatus: "idle" };
    process.env.DEEPGRAM_API_KEY = "key";
    process.env.PUBLIC_APP_URL = "https://ruffcut.example.com";

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, json: async () => ({}) }))
    );

    const res = await POST(req({ blobUrl: OWN_BLOB_URL }));

    expect(res.status).toBe(200);
    expect(settleHold).not.toHaveBeenCalled();
    expect(del).not.toHaveBeenCalled();

    vi.unstubAllGlobals();
  });
});
