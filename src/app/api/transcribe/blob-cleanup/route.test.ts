import { describe, it, expect, vi, beforeEach } from "vitest";

const state = vi.hoisted(() => ({
  clerkId: null as string | null,
  accessOk: false,
  rateAllowed: true,
  ownedProject: null as { id: string } | null,
  deletedUrls: [] as string[],
}));

vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn(async () => ({ userId: state.clerkId })),
  currentUser: vi.fn(async () => ({ unsafeMetadata: {} })),
}));

vi.mock("@/lib/authz", () => ({
  getAuthorizedDbUser: vi.fn(async () =>
    state.accessOk ? { id: "db-user-1", creditSeconds: 3600 } : null
  ),
}));

vi.mock("@/lib/rate-limit", () => ({
  rateLimit: vi.fn(async () => ({
    allowed: state.rateAllowed,
    remaining: state.rateAllowed ? 59 : 0,
    limit: 60,
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

import { POST } from "./route";
import { getOwnedProject } from "@/lib/projects";
import { del } from "@vercel/blob";

const OWN_BLOB_URL =
  "https://abc123.public.blob.vercel-storage.com/projects/proj-1/audio-xYz9";

function req(body?: unknown) {
  return new Request("http://localhost/api/transcribe/blob-cleanup", {
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
  state.deletedUrls = [];
  vi.clearAllMocks();
});

describe("POST /api/transcribe/blob-cleanup", () => {
  it("401 when unauthenticated", async () => {
    const res = await POST(req({ blobUrl: OWN_BLOB_URL }));
    expect(res.status).toBe(401);
    expect(del).not.toHaveBeenCalled();
  });

  it("403 without a valid access code", async () => {
    state.clerkId = "clerk_1";
    const res = await POST(req({ blobUrl: OWN_BLOB_URL }));
    expect(res.status).toBe(403);
  });

  it("429 when the cleanup rate limit is exceeded", async () => {
    state.clerkId = "clerk_1";
    state.accessOk = true;
    state.rateAllowed = false;
    const res = await POST(req({ blobUrl: OWN_BLOB_URL }));
    expect(res.status).toBe(429);
  });

  it("400 when the blobUrl isn't one of ours (SSRF guard)", async () => {
    state.clerkId = "clerk_1";
    state.accessOk = true;
    const res = await POST(req({ blobUrl: "https://evil.example.com/x" }));
    expect(res.status).toBe(400);
    expect(del).not.toHaveBeenCalled();
  });

  it("404 when the pathname's project isn't owned by the caller", async () => {
    state.clerkId = "clerk_1";
    state.accessOk = true;
    state.ownedProject = null;
    const res = await POST(req({ blobUrl: OWN_BLOB_URL }));
    expect(res.status).toBe(404);
    expect(getOwnedProject).toHaveBeenCalledWith("proj-1", "clerk_1");
    expect(del).not.toHaveBeenCalled();
  });

  it("404 when the blob URL doesn't follow the projects/<id>/ convention", async () => {
    state.clerkId = "clerk_1";
    state.accessOk = true;
    state.ownedProject = { id: "proj-1" };
    const res = await POST(
      req({ blobUrl: "https://abc123.public.blob.vercel-storage.com/elsewhere/file" })
    );
    expect(res.status).toBe(404);
    expect(getOwnedProject).not.toHaveBeenCalled();
  });

  it("deletes the blob for its owner", async () => {
    state.clerkId = "clerk_1";
    state.accessOk = true;
    state.ownedProject = { id: "proj-1" };
    const res = await POST(req({ blobUrl: OWN_BLOB_URL }));
    expect(res.status).toBe(200);
    expect(state.deletedUrls).toEqual([OWN_BLOB_URL]);
  });
});
