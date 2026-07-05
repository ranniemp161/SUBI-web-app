import { describe, it, expect, vi, beforeEach } from "vitest";

// Shared, mutable mock state (hoisted so the vi.mock factory below can close
// over it — vi.mock is hoisted above imports).
const state = vi.hoisted(() => ({
  selectRows: [] as Record<string, unknown>[],
  updates: [] as Record<string, unknown>[],
  deletedUrls: [] as string[],
  settled: [] as Array<{ projectId: string; actual: number | null }>,
  settleError: false,
  rateAllowed: true,
  aiResult: null as Record<string, unknown> | null,
  aiError: false,
}));

vi.mock("@vercel/blob", () => ({
  del: vi.fn(async (url: string) => {
    state.deletedUrls.push(url);
  }),
}));

// Minimal chainable + thenable Drizzle stand-in: every builder method returns
// the same proxy, and awaiting it resolves to the configured result. `.set()`
// captures the update payload so tests can assert what was written.
vi.mock("@/db", () => {
  function chain(getResult: () => unknown, onSet?: (v: Record<string, unknown>) => void) {
    const proxy: unknown = new Proxy(function () {}, {
      get(_t, prop) {
        if (prop === "then") {
          return (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
            Promise.resolve(getResult()).then(res, rej);
        }
        if (prop === "set") {
          return (v: Record<string, unknown>) => {
            onSet?.(v);
            return proxy;
          };
        }
        return () => proxy;
      },
    });
    return proxy;
  }
  return {
    db: {
      select: () => chain(() => state.selectRows),
      update: () => chain(() => [], (v) => state.updates.push(v)),
    },
  };
});

// Route's own rate limit — mocked at the same layer as every other route
// test (@/lib/rate-limit), so the real getClientIp()/ipRateLimit() key
// construction still runs and can be asserted against.
vi.mock("@/lib/rate-limit", () => ({
  rateLimit: vi.fn(async () => ({
    allowed: state.rateAllowed,
    remaining: state.rateAllowed ? 59 : 0,
    limit: 60,
  })),
}));

vi.mock("@/lib/deepgram", () => ({
  normalizeDeepgram: vi.fn(() => ({ words: [], text: "hello", duration: 1 })),
}));

vi.mock("@/lib/credits", () => ({
  secondsFromDeepgramDuration: vi.fn((d: number | null | undefined) =>
    d && d > 0 ? Math.max(1, Math.ceil(d)) : null
  ),
  settleHold: vi.fn(async (projectId: string, actual: number | null) => {
    if (state.settleError) throw new Error("db down");
    state.settled.push({ projectId, actual });
  }),
}));

vi.mock("@/lib/observability", () => ({ reportError: vi.fn() }));

vi.mock("@/lib/ai-rough-cut", () => ({
  runAiRoughCut: vi.fn(async () => {
    if (state.aiError) throw new Error("gemini down");
    return state.aiResult;
  }),
}));

import { POST } from "./route";
import { rateLimit } from "@/lib/rate-limit";
import { normalizeDeepgram } from "@/lib/deepgram";
import { runAiRoughCut } from "@/lib/ai-rough-cut";

const VALID_ID = "12345678-1234-1234-1234-123456789abc";
const TOKEN = "a".repeat(64);

function callbackRequest(query: string, body: unknown = { results: {} }, ip = "203.0.113.1") {
  return new Request(`http://localhost/api/transcribe/callback${query}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": ip },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  state.selectRows = [];
  state.updates = [];
  state.deletedUrls = [];
  state.settled = [];
  state.settleError = false;
  state.rateAllowed = true;
  state.aiResult = null;
  state.aiError = false;
  vi.clearAllMocks();
});

describe("POST /api/transcribe/callback — request shape guards", () => {
  it("rejects a non-UUID projectId with 400 (never touches the rate limiter or DB)", async () => {
    const res = await POST(callbackRequest(`?projectId=not-a-uuid&token=${TOKEN}`));
    expect(res.status).toBe(400);
    expect(rateLimit).not.toHaveBeenCalled();
    expect(state.updates).toHaveLength(0);
  });

  it("rejects a missing token with 400 (never touches the rate limiter)", async () => {
    const res = await POST(callbackRequest(`?projectId=${VALID_ID}`));
    expect(res.status).toBe(400);
    expect(rateLimit).not.toHaveBeenCalled();
  });

  it("rejects a token that isn't 64 hex chars with 400 (never touches the rate limiter or DB)", async () => {
    const res = await POST(callbackRequest(`?projectId=${VALID_ID}&token=not-hex-shaped`));
    expect(res.status).toBe(400);
    expect(rateLimit).not.toHaveBeenCalled();
    expect(state.updates).toHaveLength(0);
  });
});

describe("POST /api/transcribe/callback — IP rate limit", () => {
  it("429s once the per-IP limit is exceeded, before the project lookup", async () => {
    state.rateAllowed = false;
    const res = await POST(callbackRequest(`?projectId=${VALID_ID}&token=${TOKEN}`, undefined, "198.51.100.9"));
    expect(res.status).toBe(429);
    expect(rateLimit).toHaveBeenCalledWith("transcribe-callback:198.51.100.9", 60, 600);
    // selectRows defaults to [] anyway, but this proves the lookup never ran.
    expect(state.updates).toHaveLength(0);
  });

  it("allows the request through and reaches the project lookup when under the limit", async () => {
    state.selectRows = [{ id: VALID_ID, transcriptCallbackToken: TOKEN }];
    const res = await POST(callbackRequest(`?projectId=${VALID_ID}&token=${TOKEN}`));
    expect(res.status).toBe(200);
    expect(rateLimit).toHaveBeenCalledWith("transcribe-callback:203.0.113.1", 60, 600);
  });
});

describe("POST /api/transcribe/callback — token auth", () => {
  it("returns 401 when the project has no stored callback token", async () => {
    state.selectRows = [{ id: VALID_ID, transcriptCallbackToken: null }];
    const res = await POST(callbackRequest(`?projectId=${VALID_ID}&token=${TOKEN}`));
    expect(res.status).toBe(401);
    expect(state.updates).toHaveLength(0);
  });

  it("returns 401 on a token mismatch", async () => {
    state.selectRows = [{ id: VALID_ID, transcriptCallbackToken: TOKEN }];
    const res = await POST(callbackRequest(`?projectId=${VALID_ID}&token=${"b".repeat(64)}`));
    expect(res.status).toBe(401);
    expect(state.updates).toHaveLength(0);
  });

  it("accepts a matching token, stores the transcript, and clears the token", async () => {
    state.selectRows = [{ id: VALID_ID, transcriptCallbackToken: TOKEN }];
    const res = await POST(callbackRequest(`?projectId=${VALID_ID}&token=${TOKEN}`));
    expect(res.status).toBe(200);
    expect(state.updates).toHaveLength(1);
    const update = state.updates[0];
    expect(update.transcriptStatus).toBe("ready");
    expect(update.transcriptCallbackToken).toBeNull(); // one-time use, replay-proofed
    expect(update.transcript).toBeDefined();
  });

  it("marks the project failed (no transcript) when Deepgram reports an error", async () => {
    state.selectRows = [{ id: VALID_ID, transcriptCallbackToken: TOKEN }];
    const res = await POST(
      callbackRequest(`?projectId=${VALID_ID}&token=${TOKEN}`, { err_code: "SOME_ERROR" })
    );
    expect(res.status).toBe(200);
    const update = state.updates[0];
    expect(update.transcriptStatus).toBe("failed");
    expect(update.transcript).toBeUndefined();
    expect(update.transcriptCallbackToken).toBeNull();
  });
});

describe("POST /api/transcribe/callback — blob cleanup", () => {
  const BLOB_URL = "https://abc123.public.blob.vercel-storage.com/projects/x/audio.m4a";

  it("deletes the blob after a successful transcript is stored", async () => {
    state.selectRows = [{ id: VALID_ID, transcriptCallbackToken: TOKEN }];
    const res = await POST(
      callbackRequest(`?projectId=${VALID_ID}&token=${TOKEN}&blobUrl=${encodeURIComponent(BLOB_URL)}`)
    );
    expect(res.status).toBe(200);
    expect(state.deletedUrls).toEqual([BLOB_URL]);
  });

  it("still deletes the blob when Deepgram reports an error", async () => {
    state.selectRows = [{ id: VALID_ID, transcriptCallbackToken: TOKEN }];
    const res = await POST(
      callbackRequest(
        `?projectId=${VALID_ID}&token=${TOKEN}&blobUrl=${encodeURIComponent(BLOB_URL)}`,
        { err_code: "SOME_ERROR" }
      )
    );
    expect(res.status).toBe(200);
    expect(state.deletedUrls).toEqual([BLOB_URL]);
  });

  it("doesn't attempt a delete when no blobUrl was provided", async () => {
    state.selectRows = [{ id: VALID_ID, transcriptCallbackToken: TOKEN }];
    const res = await POST(callbackRequest(`?projectId=${VALID_ID}&token=${TOKEN}`));
    expect(res.status).toBe(200);
    expect(state.deletedUrls).toEqual([]);
  });
});

describe("POST /api/transcribe/callback — credit settlement", () => {
  it("settles on Deepgram's measured duration after a successful transcript", async () => {
    state.selectRows = [{ id: VALID_ID, transcriptCallbackToken: TOKEN }];
    const res = await POST(
      callbackRequest(`?projectId=${VALID_ID}&token=${TOKEN}`, {
        metadata: { duration: 93.2 },
        results: {},
      })
    );
    expect(res.status).toBe(200);
    expect(state.settled).toEqual([{ projectId: VALID_ID, actual: 94 }]);
  });

  it("keeps the hold as the final charge when the payload has no duration", async () => {
    state.selectRows = [{ id: VALID_ID, transcriptCallbackToken: TOKEN }];
    const res = await POST(callbackRequest(`?projectId=${VALID_ID}&token=${TOKEN}`));
    expect(res.status).toBe(200);
    expect(state.settled).toEqual([{ projectId: VALID_ID, actual: null }]);
  });

  it("fully refunds the hold when Deepgram reports an error", async () => {
    state.selectRows = [{ id: VALID_ID, transcriptCallbackToken: TOKEN }];
    const res = await POST(
      callbackRequest(`?projectId=${VALID_ID}&token=${TOKEN}`, { err_code: "SOME_ERROR" })
    );
    expect(res.status).toBe(200);
    expect(state.settled).toEqual([{ projectId: VALID_ID, actual: 0 }]);
  });

  it("refunds the hold on the catch path (malformed payload)", async () => {
    state.selectRows = [{ id: VALID_ID, transcriptCallbackToken: TOKEN }];
    const res = await POST(
      new Request(`http://localhost/api/transcribe/callback?projectId=${VALID_ID}&token=${TOKEN}`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.1" },
        body: "{not json",
      })
    );
    expect(res.status).toBe(500);
    expect(state.settled).toEqual([{ projectId: VALID_ID, actual: 0 }]);
    expect(state.updates[0].transcriptStatus).toBe("failed");
  });

  it("a settle failure never changes the response Deepgram sees", async () => {
    state.selectRows = [{ id: VALID_ID, transcriptCallbackToken: TOKEN }];
    state.settleError = true;
    const res = await POST(callbackRequest(`?projectId=${VALID_ID}&token=${TOKEN}`));
    expect(res.status).toBe(200);
    expect(state.updates[0].transcriptStatus).toBe("ready");
  });
});

describe("POST /api/transcribe/callback — AI rough-cut pass", () => {
  const WORDS = [{ word: "hello", start: 0, end: 0.5, confidence: 1 }];
  const withWords = () =>
    vi.mocked(normalizeDeepgram).mockReturnValueOnce({
      words: WORDS,
      text: "hello",
      duration: 1,
    });

  it("stores AI cuts as a second update once the transcript is safely saved", async () => {
    state.selectRows = [{ id: VALID_ID, transcriptCallbackToken: TOKEN }];
    state.aiResult = { ranges: [], model: "gemini-2.5-flash", createdAt: "now" };
    withWords();
    const res = await POST(callbackRequest(`?projectId=${VALID_ID}&token=${TOKEN}`));
    expect(res.status).toBe(200);
    expect(runAiRoughCut).toHaveBeenCalledWith(WORDS);
    expect(state.updates).toHaveLength(2);
    expect(state.updates[0].transcriptStatus).toBe("ready");
    expect(state.updates[1].aiCuts).toBe(state.aiResult);
  });

  it("skips the AI pass entirely when the transcript has no words", async () => {
    state.selectRows = [{ id: VALID_ID, transcriptCallbackToken: TOKEN }];
    const res = await POST(callbackRequest(`?projectId=${VALID_ID}&token=${TOKEN}`));
    expect(res.status).toBe(200);
    expect(runAiRoughCut).not.toHaveBeenCalled();
    expect(state.updates).toHaveLength(1);
  });

  it("soft-fails: an AI error still returns 200 with the transcript stored and ready", async () => {
    state.selectRows = [{ id: VALID_ID, transcriptCallbackToken: TOKEN }];
    state.aiError = true;
    withWords();
    const res = await POST(callbackRequest(`?projectId=${VALID_ID}&token=${TOKEN}`));
    expect(res.status).toBe(200);
    expect(state.updates).toHaveLength(1);
    expect(state.updates[0].transcriptStatus).toBe("ready");
  });

  it("writes nothing extra when the AI pass is unconfigured (runAiRoughCut → null)", async () => {
    state.selectRows = [{ id: VALID_ID, transcriptCallbackToken: TOKEN }];
    state.aiResult = null;
    withWords();
    const res = await POST(callbackRequest(`?projectId=${VALID_ID}&token=${TOKEN}`));
    expect(res.status).toBe(200);
    expect(runAiRoughCut).toHaveBeenCalled();
    expect(state.updates).toHaveLength(1);
  });
});
