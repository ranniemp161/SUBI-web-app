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

import { getTableColumns } from "drizzle-orm";
import { brollAssets } from "@repo/db/schema";
import { getSceneEditContext, replacePlannerScenes } from "./scenes";
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
    chartRejectionReason: null,
    strength: 0.8,
    included: true,
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

describe("getSceneEditContext", () => {
  /**
   * This statement is hand written SQL, so nothing in the type system ties its
   * column names to the schema, and a column that moves tables takes the route
   * down with a 500 that only a real database can produce. That is not a
   * hypothetical: spec `broll/0007` moved an asset's owner from the project to
   * the character, this subquery kept matching on `broll_assets.broll_project_id`,
   * and every template and emotion edit in Scene Studio answered 500 until it
   * was found. The assertion below is against the schema rather than against a
   * remembered column name, so it catches the next move too.
   */
  it("names only columns broll_assets actually has", async () => {
    await getSceneEditContext("user-1", "proj-1", "scene-1");

    const text = sqlText(state.executed[0]);
    const columns = new Set(
      Object.values(getTableColumns(brollAssets)).map((column) => column.name)
    );
    const referenced = [...text.matchAll(/\ba\.([a-z_]+)\b/g)].map((match) => match[1]);

    expect(referenced.length).toBeGreaterThan(0);
    for (const column of referenced) expect(columns).toContain(column);
  });

  it("reads the emotions through the project's character", async () => {
    await getSceneEditContext("user-1", "proj-1", "scene-1");

    // A project with no character attached yields an empty array, which the
    // route reads as "no character set" — the same answer as before the move.
    expect(sqlText(state.executed[0])).toContain(
      "a.broll_character_id = p.broll_character_id"
    );
  });
});
