import { describe, it, expect, vi, beforeEach } from "vitest";

const state = vi.hoisted(() => ({
  clerkId: null as string | null,
  accessOk: false,
  rateAllowed: true,
  ownedProject: null as { id: string } | null,
  updates: [] as Record<string, unknown>[],
  deletedUrls: [] as string[],
}));

vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn(async () => ({ userId: state.clerkId })),
  currentUser: vi.fn(async () => ({ unsafeMetadata: {} })),
}));

vi.mock("@/lib/access-code", () => ({
  hasValidAccessCode: vi.fn(() => state.accessOk),
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

vi.mock("@/db", () => ({
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
  state.accessOk = false;
  state.rateAllowed = true;
  state.ownedProject = null;
  state.updates = [];
  state.deletedUrls = [];
  vi.clearAllMocks();
  delete process.env.DEEPGRAM_API_KEY;
  delete process.env.PUBLIC_APP_URL;
});

describe("POST /api/transcribe/deepgram — request guards", () => {
  it("401 when unauthenticated (and never checks the rate limit)", async () => {
    const res = await POST(req());
    expect(res.status).toBe(401);
    expect(rateLimit).not.toHaveBeenCalled();
  });

  it("403 without a valid access code", async () => {
    state.clerkId = "clerk_1";
    state.accessOk = false;
    const res = await POST(req());
    expect(res.status).toBe(403);
    expect(rateLimit).not.toHaveBeenCalled();
  });

  it("429 when the transcription rate limit is exceeded", async () => {
    state.clerkId = "clerk_1";
    state.accessOk = true;
    state.rateAllowed = false;
    const res = await POST(req());
    expect(res.status).toBe(429);
    expect(rateLimit).toHaveBeenCalledWith("transcribe:clerk_1", 30, 3600);
  });

  it("404 when the project isn't found or owned", async () => {
    state.clerkId = "clerk_1";
    state.accessOk = true;
    state.ownedProject = null;
    process.env.DEEPGRAM_API_KEY = "key";
    const res = await POST(req({ blobUrl: OWN_BLOB_URL }));
    expect(res.status).toBe(404);
  });

  it("400 when blobUrl is missing", async () => {
    state.clerkId = "clerk_1";
    state.accessOk = true;
    state.ownedProject = { id: "x" };
    process.env.DEEPGRAM_API_KEY = "key";
    const res = await POST(req({}));
    expect(res.status).toBe(400);
  });

  it("400 when blobUrl doesn't belong to a Vercel Blob store (SSRF guard)", async () => {
    state.clerkId = "clerk_1";
    state.accessOk = true;
    state.ownedProject = { id: "x" };
    process.env.DEEPGRAM_API_KEY = "key";
    const res = await POST(req({ blobUrl: "https://evil.example.com/steal-our-quota" }));
    expect(res.status).toBe(400);
  });
});

describe("POST /api/transcribe/deepgram — sync mode (localhost)", () => {
  beforeEach(() => {
    state.clerkId = "clerk_1";
    state.accessOk = true;
    state.ownedProject = { id: "x" };
    process.env.DEEPGRAM_API_KEY = "key";
  });

  it("stores the transcript, marks ready, and deletes the blob on success", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          metadata: { duration: 5 },
          results: { channels: [{ alternatives: [{ transcript: "hi", words: [] }] }] },
        }),
      }))
    );

    const res = await POST(req({ blobUrl: OWN_BLOB_URL }));

    expect(res.status).toBe(200);
    expect(del).toHaveBeenCalledWith(OWN_BLOB_URL);
    const finalUpdate = state.updates.at(-1);
    expect(finalUpdate?.transcriptStatus).toBe("ready");

    vi.unstubAllGlobals();
  });

  it("marks failed and deletes the blob when Deepgram rejects the request", async () => {
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

    vi.unstubAllGlobals();
  });
});
