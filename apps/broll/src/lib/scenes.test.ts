import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

const state = vi.hoisted(() => ({
  executed: [] as unknown[],
  committed: 2,
}));

vi.mock("@repo/db", () => ({
  db: {
    execute: vi.fn(async (query: unknown) => {
      state.executed.push(query);
      return { rows: [{ committed: state.committed }] };
    }),
  },
}));

import { replacePlannerScenes } from "./scenes";
import type { PlannedScene } from "./planner";

function scene(over: Partial<PlannedScene> = {}): PlannedScene {
  return {
    startMs: 0,
    durationMs: 6_000,
    sourceText: "We cut fuel imports by 80%.",
    sourceStartMs: 0,
    sourceEndMs: 5_000,
    visualType: "infographic",
    emotion: null,
    layoutTemplate: "chart-full",
    overlayText: null,
    chart: null,
    strength: 0.8,
    ...over,
  };
}

/**
 * Flatten a Drizzle `sql` template back into its literal text, so the
 * statement's shape can be asserted without a database.
 */
function sqlText(query: unknown): string {
  const chunks = (query as { queryChunks?: { value?: string[] }[] }).queryChunks ?? [];
  return chunks
    .map((chunk) => (Array.isArray(chunk?.value) ? chunk.value.join("") : ""))
    .join(" ");
}

beforeEach(() => {
  state.executed = [];
  state.committed = 2;
});

describe("replacePlannerScenes (AC-51)", () => {
  it("does the delete and the insert in exactly one statement", async () => {
    // Two statements leave a window with no scenes at all, and two concurrent
    // runs interleaving across that window leave a mixture of two plans.
    await replacePlannerScenes("proj-1", [scene(), scene({ startMs: 9_000 })]);

    expect(state.executed).toHaveLength(1);
    const text = sqlText(state.executed[0]);
    expect(text).toContain("DELETE FROM broll_scenes");
    expect(text).toContain("INSERT INTO broll_scenes");
  });

  it("deletes only the planner's own scenes", async () => {
    await replacePlannerScenes("proj-1", [scene()]);

    // Invariant 4: a re-run never destroys a scene the user added by hand.
    expect(sqlText(state.executed[0])).toContain("origin = 'planner'");
  });

  it("returns how many scenes were actually committed", async () => {
    state.committed = 7;
    expect(await replacePlannerScenes("proj-1", [scene()])).toBe(7);
  });

  it("leaves the previous plan standing when the new one is empty", async () => {
    // The run is refunded either way (AC-53). Wiping a good plan in exchange
    // for nothing would be worse than a failed run.
    expect(await replacePlannerScenes("proj-1", [])).toBe(0);
    expect(state.executed).toHaveLength(0);
  });
});
