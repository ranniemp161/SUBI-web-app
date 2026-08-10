import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@repo/server-shared/observability", () => ({ reportError: vi.fn() }));

const state = vi.hoisted(() => ({
  clerkId: "user_clerk" as string | null,
  dbUser: { id: "user-db" } as { id: string } | null,
  project: null as Record<string, unknown> | null,
  allowed: true,
  charge: { status: "charged" } as { status: string },
  plan: null as unknown,
  planError: null as Error | null,
  committed: 0,
  charges: [] as unknown[][],
  refunds: [] as unknown[][],
  replaced: [] as unknown[][],
}));

vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn(async () => ({ userId: state.clerkId })),
}));

vi.mock("@repo/server-shared/authz", () => ({
  getAuthorizedDbUser: vi.fn(async () => state.dbUser),
}));

vi.mock("@repo/billing", () => ({
  chargeBrollPlanRerun: vi.fn(async (...args: unknown[]) => {
    state.charges.push(args);
    return state.charge;
  }),
  refundBrollPlanRerun: vi.fn(async (...args: unknown[]) => {
    state.refunds.push(args);
  }),
}));

vi.mock("@/lib/projects", () => ({
  getBrollProject: vi.fn(async () => state.project),
}));

vi.mock("@/lib/scenes", () => ({
  replacePlannerScenes: vi.fn(async (...args: unknown[]) => {
    state.replaced.push(args);
    return state.committed;
  }),
  listBrollScenes: vi.fn(async () => [
    { id: "scene-1", startMs: 0, durationMs: 6000, sourceText: "a line.", origin: "planner" },
  ]),
}));

vi.mock("@/lib/rate-limit", () => ({
  planRateLimit: vi.fn(async () => ({ allowed: state.allowed, remaining: 9, limit: 10 })),
}));

vi.mock("@/lib/planner", async () => {
  const actual = await vi.importActual<typeof import("@/lib/planner")>("@/lib/planner");
  return {
    ...actual,
    isPlannerConfigured: vi.fn(() => true),
    runScenePlan: vi.fn(async (input: { onPhase?: (p: string) => void }) => {
      input.onPhase?.("planning");
      input.onPhase?.("validating");
      if (state.planError) throw state.planError;
      return state.plan;
    }),
  };
});

import { POST, runtime, maxDuration } from "./route";
import { PlannerError } from "@/lib/planner";

/** One long line of speech, enough to merge into one utterance. */
function transcript(segments = [{ start: 0, end: 5, text: "We cut fuel imports by 80%." }]) {
  return { version: 1, fps: null, duration: 600, generatedAt: "", wordsAligned: false, source: { kind: "import", projectId: null, edlFingerprint: null }, segments };
}

function project(over: Record<string, unknown> = {}) {
  return {
    id: "proj-1",
    name: "Talk",
    durationMs: 586_800,
    style: "anime",
    createdAt: new Date(),
    transcript: transcript(),
    sourceProjectId: null,
    edlFingerprint: null,
    planRuns: 1,
    ...over,
  };
}

function call(headers: Record<string, string> = {}) {
  return POST(new Request("http://localhost:3003/api/projects/proj-1/plan", { method: "POST", headers }), {
    params: Promise.resolve({ id: "proj-1" }),
  });
}

/** The result is the last line; a 200 alone never means success here. */
async function terminal(res: Response): Promise<Record<string, unknown>> {
  const text = await res.text();
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  return JSON.parse(lines[lines.length - 1]);
}

async function phases(res: Response): Promise<string[]> {
  const text = await res.text();
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => JSON.parse(l))
    .filter((v) => typeof v.phase === "string")
    .map((v) => v.phase as string);
}

const onePlannedScene = {
  scenes: [
    {
      startMs: 0,
      durationMs: 6000,
      sourceText: "We cut fuel imports by 80%.",
      sourceStartMs: 0,
      sourceEndMs: 5000,
      visualType: "infographic",
      emotion: null,
      layoutTemplate: "chart-full",
      overlayText: null,
      chart: null,
      strength: 0.8,
    },
  ],
  rejections: [],
};

beforeEach(() => {
  state.clerkId = "user_clerk";
  state.dbUser = { id: "user-db" };
  state.project = project();
  state.allowed = true;
  state.charge = { status: "charged" };
  state.plan = onePlannedScene;
  state.planError = null;
  state.committed = 1;
  state.charges = [];
  state.refunds = [];
  state.replaced = [];
});

describe("route configuration (AC-59)", () => {
  it("runs on the edge with an explicit maxDuration", () => {
    // Streaming defeats the proxy's idle timeout; it does nothing about the
    // function duration ceiling, which is why both are set.
    expect(runtime).toBe("edge");
    expect(maxDuration).toBe(300);
  });
});

describe("the gate", () => {
  it("answers 401 when signed out", async () => {
    state.clerkId = null;
    const res = await call();

    expect(res.status).toBe(401);
    expect(state.charges).toHaveLength(0);
  });

  it("answers 404 for a project that is not this user's (security model)", async () => {
    // `getBrollProject` scopes by user_id in the query, so someone else's
    // project is indistinguishable from a missing one — never a 403.
    state.project = null;
    const res = await call();

    expect(res.status).toBe(404);
    expect(state.charges).toHaveLength(0);
  });

  it("answers 429 when rate limited, before charging (AC-26)", async () => {
    state.allowed = false;
    const res = await call();

    expect(res.status).toBe(429);
    expect(state.charges).toHaveLength(0);
  });

  it("refuses a transcript with no speech in it", async () => {
    state.project = project({ transcript: transcript([]) });
    const res = await call();

    expect(res.status).toBe(409);
    expect(state.charges).toHaveLength(0);
  });
});

describe("the size cap (AC-55)", () => {
  it("refuses an oversized transcript, names the limit, and never charges", async () => {
    const long = Array.from({ length: 4_000 }, (_, i) => ({
      start: i * 2,
      end: i * 2 + 1.5,
      text: "a".repeat(400),
    }));
    state.project = project({ transcript: transcript(long) });

    const res = await call();
    const body = await res.json();

    expect(res.status).toBe(413);
    expect(body.code).toBe("TRANSCRIPT_TOO_LONG");
    expect(body.error).toContain("250,000");
    // Checked before the charge, so an oversized transcript is never billed.
    expect(state.charges).toHaveLength(0);
  });
});

describe("the money (AC-25, AC-53)", () => {
  it("forwards the client's idempotency key to the charge", async () => {
    await call({ "Idempotency-Key": "key-abc" });
    expect(state.charges[0]).toEqual(["user-db", "proj-1", "key-abc"]);
  });

  it("answers 402 when the balance will not cover it", async () => {
    state.charge = { status: "insufficient" };
    const res = await call();

    expect(res.status).toBe(402);
    expect((await res.json()).code).toBe("INSUFFICIENT_CREDITS");
  });

  it("runs a bundled first run without a refund path (AC-25)", async () => {
    // The first run on a project is bundled into the character set price. No
    // money moved, so nothing can be given back.
    state.charge = { status: "bundled" };
    state.committed = 0;
    state.plan = { scenes: [], rejections: [] };

    const res = await call();
    const body = await terminal(res);

    expect(body.refunded).toBe(false);
    expect(state.refunds).toHaveLength(0);
  });

  it("refunds when the run commits zero scenes (AC-53)", async () => {
    state.plan = { scenes: [], rejections: [{ utteranceIndex: 0, reason: "bad", kind: "scene" }] };
    state.committed = 0;

    const body = await terminal(await call({ "Idempotency-Key": "key-1" }));

    expect(state.refunds[0]).toEqual(["user-db", "proj-1", "key-1"]);
    expect(body.refunded).toBe(true);
    expect(body.error).toContain("not been charged");
  });

  it("refunds when the write itself fails, not just when scenes are rejected (AC-53)", async () => {
    // The exit worth naming: a charge lands, the model answers, and the write
    // then commits nothing. The refund predicate is scenes *committed*.
    state.plan = onePlannedScene;
    state.committed = 0;

    await terminal(await call());
    expect(state.refunds).toHaveLength(1);
  });

  it("stays charged when at least one scene commits, even with rejections (AC-53)", async () => {
    state.plan = {
      scenes: onePlannedScene.scenes,
      rejections: [{ utteranceIndex: 3, reason: "chart dropped: no", kind: "chart" }],
    };
    state.committed = 1;

    const body = await terminal(await call());

    expect(state.refunds).toHaveLength(0);
    expect(body.rejected).toHaveLength(1);
    expect(body.scenes).toHaveLength(1);
  });

  it("refunds and reports when the planner throws", async () => {
    state.planError = new PlannerError("failed", "The planner could not reach the model. Try again.");

    const body = await terminal(await call());

    expect(state.refunds).toHaveLength(1);
    expect(body.error).toContain("could not reach the model");
    expect(body.code).toBe("failed");
  });

  it("passes a retired model straight through as something actionable (AC-27)", async () => {
    state.planError = new PlannerError(
      "model_unavailable",
      "The planner's model (gemini-3.6-flash) is no longer available. This needs a code change to pin a current model — it is not something you can fix by retrying."
    );

    const body = await terminal(await call());

    expect(body.code).toBe("model_unavailable");
    expect(body.error).toContain("gemini-3.6-flash");
    expect(state.refunds).toHaveLength(1);
  });
});

describe("the stream (AC-52)", () => {
  it("answers 200 and streams phase lines before the terminal line", async () => {
    const res = await call();

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/json");
    expect(await phases(res)).toEqual(["merging", "planning", "validating"]);
  });

  it("carries the stored scenes on the terminal line, read back from the database", async () => {
    const body = await terminal(await call());

    // Read back rather than echoed, so the list the user sees is the list that
    // was stored, ids and all.
    expect(body.scenes).toEqual([
      { id: "scene-1", startMs: 0, durationMs: 6000, sourceText: "a line.", origin: "planner" },
    ]);
  });

  it("writes the merged plan against the project it was asked for (AC-51)", async () => {
    await terminal(await call());
    expect(state.replaced[0][0]).toBe("proj-1");
  });
});
