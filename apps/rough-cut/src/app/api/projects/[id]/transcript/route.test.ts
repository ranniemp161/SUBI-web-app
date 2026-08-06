import { describe, it, expect, vi, beforeEach } from "vitest";

const state = vi.hoisted(() => ({
  clerkId: null as string | null,
  ownedProject: null as Record<string, unknown> | null,
  rateAllowed: true,
  brollUrl: null as string | null,
}));

vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn(async () => ({ userId: state.clerkId })),
}));

vi.mock("@/lib/projects", () => ({
  getOwnedProject: vi.fn(async () => state.ownedProject),
}));

vi.mock("@/lib/rate-limit", () => ({
  readRateLimit: vi.fn(async () => ({
    allowed: state.rateAllowed,
    remaining: state.rateAllowed ? 9 : 0,
    limit: 600,
    reset: 0,
  })),
}));

vi.mock("@/lib/observability", () => ({ reportError: vi.fn() }));

vi.mock("@/lib/env", () => ({
  get BROLL_URL() {
    return state.brollUrl;
  },
}));

const { GET, OPTIONS } = await import("./route");

const NTSC_2997 = { num: 30000, den: 1001 };

/** A project row as the DB hands it back. */
function project(overrides: Record<string, unknown> = {}) {
  return {
    id: "project-1",
    sourceFpsNum: NTSC_2997.num,
    sourceFpsDen: NTSC_2997.den,
    wordsAligned: true,
    transcript: {
      words: [
        { word: "hello", start: 0, end: 0.5, confidence: 0.9 },
        { word: "world", start: 0.6, end: 1, confidence: 0.8 },
      ],
      text: "hello world",
      duration: 1,
    },
    edl: { segments: [{ start: 0, end: 2, status: "keep", reason: null }] },
    ...overrides,
  };
}

function request(origin?: string): Request {
  return new Request("http://localhost:3000/api/projects/project-1/transcript", {
    headers: origin ? { origin } : {},
  });
}

const params = Promise.resolve({ id: "project-1" });

/** `generatedAt` is a clock read, so it is the one field two builds may differ on. */
function withoutGeneratedAt(document: Record<string, unknown>): Record<string, unknown> {
  const copy = { ...document };
  delete copy.generatedAt;
  return copy;
}

beforeEach(() => {
  state.clerkId = "clerk-1";
  state.ownedProject = project();
  state.rateAllowed = true;
  state.brollUrl = null;
});

describe("GET /api/projects/:id/transcript — authorization (AC-9)", () => {
  it("rejects an unauthenticated caller", async () => {
    state.clerkId = null;
    const res = await GET(request(), { params });
    expect(res.status).toBe(401);
  });

  it("404s a signed-in user asking for a project they do not own", async () => {
    state.ownedProject = null;
    const res = await GET(request(), { params });
    expect(res.status).toBe(404);
  });

  it("rate limits on the shared read bucket", async () => {
    state.rateAllowed = false;
    const res = await GET(request(), { params });
    expect(res.status).toBe(429);
  });
});

describe("GET /api/projects/:id/transcript — refusals over guesses (AC-10)", () => {
  it("refuses with the reselect fix when no frame rate is stored", async () => {
    state.ownedProject = project({ sourceFpsNum: null, sourceFpsDen: null });
    const res = await GET(request(), { params });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/reselect your source video/i);
  });

  it("refuses when the project has no transcript", async () => {
    state.ownedProject = project({ transcript: null });
    expect((await GET(request(), { params })).status).toBe(409);
  });

  it("refuses when the project has no edit, rather than reporting a zero duration", async () => {
    state.ownedProject = project({ edl: null });
    expect((await GET(request(), { params })).status).toBe(409);
  });
});

describe("GET /api/projects/:id/transcript — the document", () => {
  it("serves a valid document built from the stored rate", async () => {
    const res = await GET(request(), { params });
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/json");
    expect(res.headers.get("Cache-Control")).toBe("no-store");

    const document = await res.json();
    expect(document.version).toBe(1);
    expect(document.fps).toEqual({ numerator: NTSC_2997.num, denominator: NTSC_2997.den });
    expect(document.source).toMatchObject({ kind: "rough-cut", projectId: "project-1" });
    expect(document.source.edlFingerprint).toEqual(expect.any(String));
    expect(document.segments[0].words.map((w: { word: string }) => w.word)).toEqual([
      "hello",
      "world",
    ]);
  });

  it("matches the download in every field but generatedAt (AC-9)", async () => {
    const { buildProjectTranscriptDocument } = await import(
      "@/lib/export/transcript-document"
    );
    const row = project();
    const download = buildProjectTranscriptDocument({
      projectId: row.id,
      edl: row.edl as never,
      transcript: row.transcript as never,
      fps: { numerator: NTSC_2997.num, denominator: NTSC_2997.den },
      wordsAligned: true,
    });

    const served = await (await GET(request(), { params })).json();
    expect(withoutGeneratedAt(served)).toEqual(withoutGeneratedAt(download));
  });
});

/**
 * These call the handlers directly, so they do NOT exercise `proxy.ts`. That
 * gap once hid a real bug: the middleware answered every `OPTIONS` with 401
 * before the handler ran, so the preflight tests below passed while the real
 * endpoint was unreachable. `proxy.ts` now lets a transcript preflight through
 * (a preflight carries no credentials, so Clerk can never authorize one), and
 * that behaviour is only provable by driving the running server — see the
 * `isTranscriptPreflight` comment in `proxy.ts`. Keep these, but do not read a
 * green run here as proof the endpoint answers.
 */
describe("GET /api/projects/:id/transcript — cross origin (AC-15)", () => {
  it("grants nothing while b-roll has no configured origin", async () => {
    state.brollUrl = null;
    const res = await GET(request("https://example.com"), { params });
    expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });

  it("allows the named b-roll origin with credentials, never a wildcard", async () => {
    state.brollUrl = "https://broll.example";
    const res = await GET(request("https://broll.example"), { params });
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("https://broll.example");
    expect(res.headers.get("Access-Control-Allow-Credentials")).toBe("true");
    expect(res.headers.get("Vary")).toBe("Origin");
  });

  it("grants nothing to any other origin", async () => {
    state.brollUrl = "https://broll.example";
    const res = await GET(request("https://attacker.example"), { params });
    expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });

  it("answers a preflight from the named origin and refuses every other", async () => {
    state.brollUrl = "https://broll.example";
    expect((await OPTIONS(request("https://broll.example"))).status).toBe(204);
    expect((await OPTIONS(request("https://attacker.example"))).status).toBe(403);
  });
});
