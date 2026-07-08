import { describe, it, expect, vi, beforeEach } from "vitest";

const state = vi.hoisted(() => ({
  clerkId: null as string | null,
  accessOk: false,
  rateAllowed: true,
  ownedProject: null as { id: string; durationMs: number } | null,
  balanceMicros: 0,
  mockPayloadProjectId: "proj-1" as string | undefined,
  mockPathname: "projects/proj-1/audio" as string,
  onBeforeGenerateTokenResult: null as { maximumSizeInBytes?: number; access?: string; addRandomSuffix?: boolean; allowedContentTypes?: string[]; tokenPayload?: string } | null,
}));

vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn(async () => ({ userId: state.clerkId })),
}));

vi.mock("@/lib/authz", () => ({
  getAuthorizedDbUser: vi.fn(async () =>
    state.accessOk ? { id: "db-user-1", balanceMicros: state.balanceMicros } : null
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

vi.mock("@/lib/credits", () => ({
  costSecondsForDurationMs: vi.fn((ms: number) => ms ? Math.ceil(ms / 1000) : 0),
  RETAIL_MICROS_PER_MINUTE: 316_667,
  chargeMicrosForSeconds: vi.fn((seconds: number) =>
    Math.round((seconds * 316_667) / 60)
  ),
}));

vi.mock("@/lib/blob", () => ({
  uploadPathnameForProject: vi.fn((id: string) => `projects/${id}/audio`),
}));

vi.mock("@/lib/observability", () => ({ reportError: vi.fn() }));

vi.mock("@vercel/blob/client", () => ({
  handleUpload: vi.fn(async ({ onBeforeGenerateToken }) => {
    if (onBeforeGenerateToken) {
      const payload = state.mockPayloadProjectId
        ? JSON.stringify({ projectId: state.mockPayloadProjectId })
        : undefined;
      state.onBeforeGenerateTokenResult = await onBeforeGenerateToken(
        state.mockPathname,
        payload
      );
    }
    return { type: "mock" };
  }),
}));

import { POST } from "./route";
import { DEEPGRAM_MAX_UPLOAD_BYTES } from "@/lib/deepgram";

function req(body?: unknown) {
  return new Request("http://localhost/api/transcribe/blob-token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? JSON.stringify({}) : JSON.stringify(body),
  });
}

beforeEach(() => {
  state.clerkId = "clerk_1";
  state.accessOk = true;
  state.rateAllowed = true;
  state.balanceMicros = 100_000_000; // $100, plenty for the default 120s job
  state.ownedProject = { id: "proj-1", durationMs: 120_000 };
  state.mockPayloadProjectId = "proj-1";
  state.mockPathname = "projects/proj-1/audio";
  state.onBeforeGenerateTokenResult = null;
  vi.clearAllMocks();
});

describe("POST /api/transcribe/blob-token", () => {
  it("returns 400 if unauthenticated", async () => {
    state.clerkId = null;
    const res = await POST(req());
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBe("Not authenticated.");
  });

  it("returns 400 if not authorized", async () => {
    state.accessOk = false;
    const res = await POST(req());
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBe("Not authorized.");
  });

  it("returns 400 if rate limit exceeded", async () => {
    state.rateAllowed = false;
    const res = await POST(req());
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBe("You're uploading too frequently. Please wait a bit and try again.");
  });

  it("returns 400 if missing projectId in client payload", async () => {
    state.mockPayloadProjectId = undefined;
    const res = await POST(req());
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBe("Missing projectId.");
  });

  it("returns 400 if project not found or not owned", async () => {
    state.ownedProject = null;
    const res = await POST(req());
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBe("Project not found.");
  });

  it("returns 400 if not enough credits", async () => {
    state.balanceMicros = 100_000; // ~$0.10, well below the 120s job cost (~$0.63)
    const res = await POST(req());
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBe("Not enough credits to transcribe this video.");
  });

  it("returns 400 if upload pathname doesn't match expected for project", async () => {
    state.mockPathname = "projects/someone-elses-project/audio";
    const res = await POST(req());
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBe("Unexpected upload pathname.");
  });

  it("succeeds and dynamically caps upload size based on affordable seconds", async () => {
    state.balanceMicros = 52_778; // ~10 affordable seconds -> 10 * 200_000 = 2,000,000 bytes
    state.ownedProject = { id: "proj-1", durationMs: 10_000 };
    const res = await POST(req());
    expect(res.status).toBe(200);
    expect(state.onBeforeGenerateTokenResult).toEqual({
      access: "public",
      addRandomSuffix: true,
      allowedContentTypes: ["audio/*"],
      maximumSizeInBytes: 2_000_000,
      tokenPayload: JSON.stringify({ projectId: "proj-1" }),
    });
  });

  it("provides a 1MB floor for small balances", async () => {
    state.balanceMicros = 10_556; // ~2 affordable seconds -> 400_000 < 1_000_000
    state.ownedProject = { id: "proj-1", durationMs: 2_000 };
    const res = await POST(req());
    expect(res.status).toBe(200);
    expect(state.onBeforeGenerateTokenResult?.maximumSizeInBytes).toBe(1_000_000);
  });

  it("respects DEEPGRAM_MAX_UPLOAD_BYTES as ceiling", async () => {
    state.balanceMicros = 999_999_999_999;
    const res = await POST(req());
    expect(res.status).toBe(200);
    expect(state.onBeforeGenerateTokenResult?.maximumSizeInBytes).toBe(DEEPGRAM_MAX_UPLOAD_BYTES);
  });
});
