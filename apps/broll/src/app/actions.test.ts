import { describe, it, expect, vi, beforeEach } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const state = vi.hoisted(() => ({
  clerkId: null as string | null,
  token: "session-token" as string | null,
  dbUser: null as { id: string } | null,
  created: null as Record<string, unknown> | null,
  fetchImpl: null as ((url: string, init?: RequestInit) => Promise<Response>) | null,
  lastFetch: null as { url: string; init?: RequestInit } | null,
}));

vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn(async () => ({
    userId: state.clerkId,
    getToken: async () => state.token,
  })),
}));

vi.mock("@repo/server-shared/authz", () => ({
  getAuthorizedDbUser: vi.fn(async () => state.dbUser),
}));

vi.mock("@/lib/projects", () => ({
  createBrollProject: vi.fn(async (input: Record<string, unknown>) => {
    state.created = input;
    return "broll-project-1";
  }),
}));

vi.mock("@/lib/env", () => ({ ROUGH_CUT_URL: "http://localhost:3000" }));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

// redirect() signals by throwing, exactly as it does in Next. Keeping that
// behaviour is the point: it is what proves the redirect sits outside the
// try/catch, rather than being swallowed and reported as a parse failure.
class RedirectSignal extends Error {
  constructor(public readonly to: string) {
    super(`NEXT_REDIRECT:${to}`);
  }
}
vi.mock("next/navigation", () => ({
  redirect: vi.fn((to: string) => {
    throw new RedirectSignal(to);
  }),
}));

// The same guard apps/rough-cut carries, for the same reason, kept here rather
// than shared because it has to walk THIS app's source tree.
//
// A `"use server"` module may export nothing but async functions. Not even a
// type. TypeScript erases `export type { X }` and so does webpack, but
// Turbopack's server actions transform does not: it reads the name as one more
// runtime export and emits `registerServerReference(X, ...)` against an
// identifier that only exists in the type system. Evaluating the module then
// throws `ReferenceError: X is not defined`, so every call to every action in
// it answers 500.
//
// Nothing else catches this. lint, typecheck and the test suite never evaluate
// a built server chunk, and `next build` compiles it happily. It cost Rough Cut
// a live production outage (PR #122), which is why the check is source level.
const SRC = join(process.cwd(), "src");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return /\.tsx?$/.test(entry.name) ? [full] : [];
  });
}

/** A module is a server-action module when its first directive is "use server". */
function isServerActionModule(contents: string): boolean {
  return /^\s*(\/\/[^\n]*\n|\/\*[\s\S]*?\*\/\s*)*["']use server["']/.test(contents);
}

// `export type { X }`, `export type X =`, and `export { type X }` — every way a
// type-only export can be written.
const TYPE_EXPORT = /^\s*export\s+type\s|^\s*export\s*\{[^}]*\btype\s/m;

describe('"use server" modules', () => {
  const modules = sourceFiles(SRC)
    .filter((file) => !file.endsWith(".test.ts") && !file.endsWith(".test.tsx"))
    .map((file) => [file, readFileSync(file, "utf8")] as const)
    .filter(([, contents]) => isServerActionModule(contents));

  it("finds the app's server-action modules", () => {
    // If this drops to zero the check below passes vacuously.
    expect(modules.length).toBeGreaterThan(0);
  });

  it.each(modules.map(([file]) => file))(
    "%s exports no types (Turbopack registers them as server references)",
    (file) => {
      const contents = modules.find(([f]) => f === file)![1];
      expect(TYPE_EXPORT.test(contents)).toBe(false);
    }
  );
});

// ---------------------------------------------------------------------------
// The two intake paths. Everything above this line is the source-level guard;
// what follows drives the actions themselves.
//
// @repo/transcript's importers and builder are NOT mocked: they are a workspace
// package with their own suite, and using them for real is what makes these
// tests prove the intake actually parses rather than that a stub was called.
// ---------------------------------------------------------------------------

const { createProjectFromUpload, importFromRoughCut } = await import("./actions");
const { buildTranscriptDocument } = await import("@repo/transcript");

const SRT = `1
00:00:00,000 --> 00:00:02,000
Hello there

2
00:00:02,500 --> 00:00:04,000
Second line
`;

const VTT = `WEBVTT

00:00:00.000 --> 00:00:02.000
Hello there
`;

function handoffJson(projectId = "rough-cut-project-1"): string {
  return JSON.stringify(
    buildTranscriptDocument({
      segments: [],
      duration: 4,
      fps: { numerator: 30, denominator: 1 },
      wordsAligned: true,
      generatedAt: "2026-08-09T12:00:00.000Z",
      source: { kind: "rough-cut", projectId, edlFingerprint: "abc123" },
    })
  );
}

/** Drive an action that is expected to redirect; returns the redirect target. */
async function redirectTargetOf(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
  } catch (error) {
    if (error instanceof RedirectSignal) return error.to;
    throw error;
  }
  throw new Error("expected a redirect, but the action returned normally");
}

function response(status: number, body = ""): Response {
  return new Response(body, { status });
}

const VALID_REF = "b3f1c2d4-1111-4222-8333-444455556666";

beforeEach(() => {
  state.clerkId = "clerk_user_1";
  state.token = "session-token";
  state.dbUser = { id: "user-1" };
  state.created = null;
  state.lastFetch = null;
  state.fetchImpl = null;
  vi.clearAllMocks();
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    state.lastFetch = { url: String(url), init };
    if (!state.fetchImpl) throw new Error("no fetch stub configured");
    return state.fetchImpl(String(url), init);
  });
});

describe("createProjectFromUpload — the gate", () => {
  const valid = { name: "Launch", style: "anime", format: "srt", text: SRT };

  it("refuses a signed-out caller", async () => {
    state.clerkId = null;
    await expect(createProjectFromUpload(valid)).resolves.toEqual({
      error: "You are not signed in.",
    });
  });

  it("refuses a session with no provisioned user row", async () => {
    state.dbUser = null;
    await expect(createProjectFromUpload(valid)).resolves.toEqual({
      error: "Your account is not set up yet.",
    });
  });

  it("never reaches the database when the caller is not signed in", async () => {
    state.clerkId = null;
    await createProjectFromUpload(valid);
    expect(state.created).toBeNull();
  });
});

describe("createProjectFromUpload — input validation", () => {
  it("rejects an empty name", async () => {
    const result = await createProjectFromUpload({
      name: "   ",
      style: "anime",
      format: "srt",
      text: SRT,
    });
    expect(result.error).toBeTruthy();
    expect(state.created).toBeNull();
  });

  it("rejects a name over 200 characters", async () => {
    const result = await createProjectFromUpload({
      name: "x".repeat(201),
      style: "anime",
      format: "srt",
      text: SRT,
    });
    expect(result.error).toBeTruthy();
  });

  it("rejects an unknown character style", async () => {
    const result = await createProjectFromUpload({
      name: "Launch",
      style: "not-a-real-style",
      format: "srt",
      text: SRT,
    });
    expect(result.error).toBe("Unknown character style");
  });

  it("rejects a format that is not srt, vtt or json", async () => {
    const result = await createProjectFromUpload({
      name: "Launch",
      style: "anime",
      format: "docx",
      text: SRT,
    });
    expect(result.error).toBeTruthy();
  });

  it("rejects empty text", async () => {
    const result = await createProjectFromUpload({
      name: "Launch",
      style: "anime",
      format: "srt",
      text: "",
    });
    expect(result.error).toBeTruthy();
  });

  it("returns a parse failure as an error rather than throwing", async () => {
    // Malformed JSON is the case that really does throw TranscriptParseError:
    // the document schema rejects it. The action catches and returns it.
    const result = await createProjectFromUpload({
      name: "Launch",
      style: "anime",
      format: "json",
      text: "{ not a document }",
    });
    expect(result.error).toBeTruthy();
    expect(state.created).toBeNull();
  });

  it("PINS CURRENT BEHAVIOUR: text with no cues in it creates an empty project", async () => {
    // Not an endorsement. `importSrt` finds zero cues in text that is not a
    // subtitle file, and `documentFromCues` turns zero cues into a valid
    // document with no segments and duration 0 rather than throwing. So a user
    // who picks the wrong file gets a successfully created, silently empty
    // project instead of being told the file was wrong.
    //
    // The document contract genuinely permits zero segments (the export path
    // relies on it: a project with everything cut still exports a valid empty
    // document), so the parser alone cannot tell "empty subtitle file" from
    // "not a subtitle file". The check that could tell them apart belongs at
    // this intake boundary, and does not exist yet.
    //
    // Change this test when that check lands; do not delete it quietly.
    await redirectTargetOf(() =>
      createProjectFromUpload({
        name: "Launch",
        style: "anime",
        format: "srt",
        text: "this is not a subtitle file at all",
      })
    );
    const document = state.created?.document as { segments: unknown[]; duration: number };
    expect(document.segments).toEqual([]);
    expect(document.duration).toBe(0);
  });
});

describe("createProjectFromUpload — the happy paths", () => {
  it("parses an SRT upload and lands on the new project", async () => {
    const to = await redirectTargetOf(() =>
      createProjectFromUpload({
        name: "Launch",
        style: "anime",
        format: "srt",
        text: SRT,
      })
    );
    expect(to).toBe("/dashboard/broll-project-1");
    expect(state.created?.userId).toBe("user-1");
    expect(state.created?.name).toBe("Launch");
  });

  it("parses a VTT upload", async () => {
    const to = await redirectTargetOf(() =>
      createProjectFromUpload({
        name: "Launch",
        style: "anime",
        format: "vtt",
        text: VTT,
      })
    );
    expect(to).toBe("/dashboard/broll-project-1");
  });

  it("leaves sourceProjectId null for a subtitle upload", async () => {
    // A subtitle file has no Rough Cut project behind it, which is exactly why
    // the column is nullable.
    await redirectTargetOf(() =>
      createProjectFromUpload({
        name: "Launch",
        style: "anime",
        format: "srt",
        text: SRT,
      })
    );
    expect(state.created?.sourceProjectId).toBeNull();
  });

  it("takes sourceProjectId from inside a JSON handoff document", async () => {
    await redirectTargetOf(() =>
      createProjectFromUpload({
        name: "Launch",
        style: "anime",
        format: "json",
        text: handoffJson("rough-cut-project-9"),
      })
    );
    expect(state.created?.sourceProjectId).toBe("rough-cut-project-9");
  });
});

describe("importFromRoughCut — the gate and the reference", () => {
  const valid = { reference: VALID_REF, name: "Launch", style: "anime" };

  it("refuses a signed-out caller", async () => {
    state.clerkId = null;
    await expect(importFromRoughCut(valid)).resolves.toEqual({
      error: "You are not signed in.",
    });
  });

  it("refuses a session with no provisioned user row", async () => {
    state.dbUser = null;
    await expect(importFromRoughCut(valid)).resolves.toEqual({
      error: "Your account is not set up yet.",
    });
  });

  it("rejects a reference with no project id in it", async () => {
    await expect(
      importFromRoughCut({ ...valid, reference: "not a link" })
    ).resolves.toEqual({
      error: "Paste a Ruff Cut project link, or its project id.",
    });
  });

  it("accepts a pasted studio URL, not just a bare id", async () => {
    // People paste the URL, so the action digs the id out of it.
    state.fetchImpl = async () => response(200, handoffJson());
    await redirectTargetOf(() =>
      importFromRoughCut({
        ...valid,
        reference: `http://localhost:3000/dashboard/${VALID_REF}`,
      })
    );
    expect(state.lastFetch?.url).toBe(
      `http://localhost:3000/api/projects/${VALID_REF}/transcript`
    );
  });

  it("rejects an unknown character style before making any request", async () => {
    await expect(
      importFromRoughCut({ ...valid, style: "not-a-real-style" })
    ).resolves.toEqual({ error: "Unknown character style." });
    expect(state.lastFetch).toBeNull();
  });

  it("rejects an empty name", async () => {
    await expect(importFromRoughCut({ ...valid, name: "  " })).resolves.toEqual({
      error: "Give the project a name.",
    });
  });

  it("reports a session it cannot read", async () => {
    state.token = null;
    await expect(importFromRoughCut(valid)).resolves.toEqual({
      error: "Could not read your session. Sign in again.",
    });
  });
});

describe("importFromRoughCut — what Ruff Cut answers", () => {
  const valid = { reference: VALID_REF, name: "Launch", style: "anime" };

  it("carries the Clerk session token as a bearer credential", async () => {
    // Server to server: no cookie, no CORS. Rough Cut still runs its own owner
    // check, so no new trust relationship is created.
    state.fetchImpl = async () => response(200, handoffJson());
    await redirectTargetOf(() => importFromRoughCut(valid));
    const headers = state.lastFetch?.init?.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer session-token");
  });

  it("never serves a cached transcript", async () => {
    // The transcript is a snapshot of a finished cut; a cached copy would
    // silently serve stale timings after the creator edits again.
    state.fetchImpl = async () => response(200, handoffJson());
    await redirectTargetOf(() => importFromRoughCut(valid));
    expect(state.lastFetch?.init?.cache).toBe("no-store");
  });

  it.each([401, 403])("treats %i as a project that is not the user's", async (status) => {
    state.fetchImpl = async () => response(status);
    await expect(importFromRoughCut(valid)).resolves.toEqual({
      error: "Ruff Cut did not recognise that project as yours.",
    });
  });

  it("treats 404 as no such project", async () => {
    state.fetchImpl = async () => response(404);
    await expect(importFromRoughCut(valid)).resolves.toEqual({
      error: "No such project in Ruff Cut.",
    });
  });

  it("turns 409 into an instruction the user can act on", async () => {
    // The route refuses rather than guessing when a project has no stored frame
    // rate, no transcript, or no edit list. The fix is on the Rough Cut side.
    state.fetchImpl = async () => response(409);
    const result = await importFromRoughCut(valid);
    expect(result.error).toContain("reselect the source video");
  });

  it("reports any other failure status verbatim", async () => {
    state.fetchImpl = async () => response(500);
    await expect(importFromRoughCut(valid)).resolves.toEqual({
      error: "Ruff Cut answered 500.",
    });
  });

  it("returns a malformed document as an error rather than throwing", async () => {
    state.fetchImpl = async () => response(200, "{ not a document }");
    const result = await importFromRoughCut(valid);
    expect(result.error).toBeTruthy();
    expect(state.created).toBeNull();
  });

  it("creates the project and links it back to the Rough Cut one", async () => {
    // The real link, and the reason source_project_id exists at all.
    state.fetchImpl = async () => response(200, handoffJson());
    const to = await redirectTargetOf(() => importFromRoughCut(valid));
    expect(to).toBe("/dashboard/broll-project-1");
    expect(state.created?.sourceProjectId).toBe(VALID_REF);
  });

  it("does not swallow the redirect as a parse failure", async () => {
    // redirect() throws, and it deliberately sits outside the try/catch. If it
    // moved inside, this would come back as an error object instead.
    state.fetchImpl = async () => response(200, handoffJson());
    await expect(importFromRoughCut(valid)).rejects.toBeInstanceOf(RedirectSignal);
  });
});
