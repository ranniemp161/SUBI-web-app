import { describe, it, expect, vi, beforeEach } from "vitest";

const state = vi.hoisted(() => ({
  clerkId: null as string | null,
  accessOk: false,
  rateAllowed: true,
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

vi.mock("@/lib/observability", () => ({ reportError: vi.fn() }));
vi.mock("@/db", () => ({ db: {} }));

import { POST } from "./route";
import { rateLimit } from "@/lib/rate-limit";

function req() {
  return new Request("http://localhost/api/transcribe/deepgram?projectId=x", {
    method: "POST",
    body: "data",
  });
}

beforeEach(() => {
  state.clerkId = null;
  state.accessOk = false;
  state.rateAllowed = true;
  vi.clearAllMocks();
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
});
