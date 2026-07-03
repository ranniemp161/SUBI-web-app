import { describe, it, expect, vi, beforeEach } from "vitest";

// Shared, mutable mock state (hoisted so the vi.mock factory below can close
// over it — vi.mock is hoisted above imports).
const state = vi.hoisted(() => ({
  selectRows: [] as Record<string, unknown>[],
  updates: [] as Record<string, unknown>[],
  deletedUrls: [] as string[],
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

vi.mock("@/lib/deepgram", () => ({
  normalizeDeepgram: vi.fn(() => ({ words: [], text: "hello", duration: 1 })),
}));

import { POST } from "./route";

const VALID_ID = "12345678-1234-1234-1234-123456789abc";
const TOKEN = "a".repeat(64);

function callbackRequest(query: string, body: unknown = { results: {} }) {
  return new Request(`http://localhost/api/transcribe/callback${query}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  state.selectRows = [];
  state.updates = [];
  state.deletedUrls = [];
});

describe("POST /api/transcribe/callback — token auth", () => {
  it("rejects a non-UUID projectId with 400", async () => {
    const res = await POST(callbackRequest(`?projectId=not-a-uuid&token=${TOKEN}`));
    expect(res.status).toBe(400);
    expect(state.updates).toHaveLength(0);
  });

  it("rejects a missing token with 400", async () => {
    const res = await POST(callbackRequest(`?projectId=${VALID_ID}`));
    expect(res.status).toBe(400);
  });

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

  it("returns 401 when the provided token differs in length (no timing-safe crash)", async () => {
    state.selectRows = [{ id: VALID_ID, transcriptCallbackToken: TOKEN }];
    const res = await POST(callbackRequest(`?projectId=${VALID_ID}&token=short`));
    expect(res.status).toBe(401);
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
