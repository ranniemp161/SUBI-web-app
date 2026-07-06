import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const HOUR_MS = 60 * 60 * 1000;

const state = vi.hoisted(() => ({
  pages: [] as { blobs: { url: string; uploadedAt: string }[]; cursor?: string; hasMore: boolean }[],
  listCalls: [] as { cursor?: string }[],
  deletedBatches: [] as string[][],
}));

vi.mock("@vercel/blob", () => ({
  list: vi.fn(async ({ cursor }: { cursor?: string }) => {
    state.listCalls.push({ cursor });
    return state.pages.shift() ?? { blobs: [], hasMore: false };
  }),
  del: vi.fn(async (urls: string[]) => {
    state.deletedBatches.push(urls);
  }),
}));

vi.mock("@/lib/observability", () => ({ reportError: vi.fn() }));

import { GET } from "./route";

function blobAgedHours(hours: number, url: string) {
  return { url, uploadedAt: new Date(Date.now() - hours * HOUR_MS).toISOString() };
}

function req(secret?: string) {
  return new Request("http://localhost/api/cron/blob-sweep", {
    headers: secret ? { authorization: `Bearer ${secret}` } : {},
  });
}

beforeEach(() => {
  state.pages = [];
  state.listCalls = [];
  state.deletedBatches = [];
  vi.clearAllMocks();
  process.env.CRON_SECRET = "sweep-secret";
});

afterEach(() => {
  delete process.env.CRON_SECRET;
});

describe("GET /api/cron/blob-sweep", () => {
  it("500 when CRON_SECRET isn't configured (sweep disabled, nothing listed)", async () => {
    delete process.env.CRON_SECRET;
    const res = await GET(req("sweep-secret"));
    expect(res.status).toBe(500);
    expect(state.listCalls).toHaveLength(0);
  });

  it("401 without the cron bearer secret", async () => {
    const res = await GET(req("wrong-secret"));
    expect(res.status).toBe(401);
    expect(state.listCalls).toHaveLength(0);
  });

  it("deletes only blobs older than the orphan threshold", async () => {
    const stale = blobAgedHours(7, "https://store/projects/a/audio-1");
    const fresh = blobAgedHours(1, "https://store/projects/b/audio-2");
    state.pages = [{ blobs: [stale, fresh], hasMore: false }];

    const res = await GET(req("sweep-secret"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(state.deletedBatches).toEqual([[stale.url]]);
    expect(body).toEqual({ scanned: 2, deleted: 1, failed: 0 });
  });

  it("follows pagination cursors across pages", async () => {
    const first = blobAgedHours(8, "https://store/projects/a/audio-1");
    const second = blobAgedHours(9, "https://store/projects/b/audio-2");
    state.pages = [
      { blobs: [first], cursor: "next-page", hasMore: true },
      { blobs: [second], hasMore: false },
    ];

    const res = await GET(req("sweep-secret"));
    const body = await res.json();

    expect(state.listCalls).toEqual([{ cursor: undefined }, { cursor: "next-page" }]);
    expect(state.deletedBatches).toEqual([[first.url], [second.url]]);
    expect(body).toEqual({ scanned: 2, deleted: 2, failed: 0 });
  });
});
