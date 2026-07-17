import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SQL } from "drizzle-orm";

const { selectMock, fromMock, innerJoinMock, whereMock, limitMock, executeMock } = vi.hoisted(
  () => ({
    selectMock: vi.fn(),
    fromMock: vi.fn(),
    innerJoinMock: vi.fn(),
    whereMock: vi.fn(),
    limitMock: vi.fn(),
    executeMock: vi.fn(),
  })
);

vi.mock("@repo/db", () => ({
  db: { select: selectMock, execute: executeMock },
  withDbRetry: vi.fn(async (cb: () => unknown) => cb()),
}));

vi.mock("@repo/db/schema", () => ({
  projects: { id: "projects.id", userId: "projects.userId" },
  users: { id: "users.id", clerkId: "users.clerkId" },
}));

import {
  getOwnedProject,
  claimAiCutSlot,
  releaseAiCutClaim,
  countAiCutRuns,
  listAiCutRuns,
  getAiCutRun,
  createAiCutRun,
  setActiveAiCutRun,
  deleteAiCutRunAndRenumber,
  renameAiCutRun,
  AI_CUT_CLAIM_STALE_MS,
} from "@/lib/projects";

/**
 * Render a drizzle `sql` template's chunks back into a rough SQL string plus
 * the interpolated params, so tests can assert on statement text/values
 * without a real database. Drizzle stores literal segments as `{ value: [str] }`
 * chunks and interpolated values as raw entries in `queryChunks`.
 */
function renderSql(query: SQL): { text: string; params: unknown[] } {
  const params: unknown[] = [];
  const text = (query.queryChunks as unknown[])
    .map((chunk) => {
      if (chunk && typeof chunk === "object" && "value" in chunk) {
        return (chunk as { value: string[] }).value[0];
      }
      params.push(chunk);
      return "?";
    })
    .join("");
  return { text, params };
}

beforeEach(() => {
  vi.clearAllMocks();
  selectMock.mockReturnValue({ from: fromMock });
  fromMock.mockReturnValue({ innerJoin: innerJoinMock, where: whereMock });
  innerJoinMock.mockReturnValue({ where: whereMock });
  whereMock.mockReturnValue({ limit: limitMock });
  limitMock.mockResolvedValue([]);
  executeMock.mockResolvedValue({ rows: [] });
});

describe("getOwnedProject", () => {
  it("returns the project when the join finds a row owned by the caller", async () => {
    const project = { id: "p1", userId: "u1" };
    limitMock.mockResolvedValue([{ project, user: { id: "u1" } }]);

    const result = await getOwnedProject("p1", "clerk_1");

    expect(result).toEqual(project);
    expect(limitMock).toHaveBeenCalledWith(1);
  });

  it("returns null when no row matches (not found or not owned)", async () => {
    limitMock.mockResolvedValue([]);
    const result = await getOwnedProject("p1", "clerk_1");
    expect(result).toBeNull();
  });
});

describe("claimAiCutSlot — the atomic claim + ai_polish_requested flip (ADR 0003 AC-3/AC-4)", () => {
  it("returns true and flips ai_polish_requested to false in the same UPDATE when the claim is won", async () => {
    executeMock.mockResolvedValue({ rows: [{ id: "p1" }] });

    const result = await claimAiCutSlot("p1", "u1");

    expect(result).toBe(true);
    expect(executeMock).toHaveBeenCalledTimes(1);
    const { text, params } = renderSql(executeMock.mock.calls[0][0]);
    // The single statement must both claim the slot and clear the auto-fire
    // flag — the exactly-once guarantee this ADR is built on.
    expect(text).toContain("ai_cut_claim_at = now()");
    expect(text).toContain("ai_polish_requested = false");
    expect(text).toContain("UPDATE projects");
    expect(text).toContain("RETURNING id");
    expect(params).toContain("p1");
    expect(params).toContain("u1");
    expect(params).toContain(AI_CUT_CLAIM_STALE_MS);
  });

  it("returns false when the row doesn't match (another request already holds the claim)", async () => {
    executeMock.mockResolvedValue({ rows: [] });
    const result = await claimAiCutSlot("p1", "u1");
    expect(result).toBe(false);
  });

  it("scopes the claim to both the project id and the owning user id", async () => {
    executeMock.mockResolvedValue({ rows: [{ id: "p1" }] });
    await claimAiCutSlot("p1", "u1");
    const { text } = renderSql(executeMock.mock.calls[0][0]);
    expect(text).toContain("WHERE id = ");
    expect(text).toContain("AND user_id = ");
  });

  it("allows reclaiming a stale claim (ai_cut_claim_at older than the staleness window)", async () => {
    executeMock.mockResolvedValue({ rows: [{ id: "p1" }] });
    await claimAiCutSlot("p1", "u1");
    const { text } = renderSql(executeMock.mock.calls[0][0]);
    expect(text).toContain("ai_cut_claim_at IS NULL");
    expect(text).toContain("ai_cut_claim_at <");
  });
});

describe("releaseAiCutClaim", () => {
  it("clears ai_cut_claim_at for the project", async () => {
    await releaseAiCutClaim("p1");
    expect(executeMock).toHaveBeenCalledTimes(1);
    const { text, params } = renderSql(executeMock.mock.calls[0][0]);
    expect(text).toContain("SET ai_cut_claim_at = NULL");
    expect(params).toContain("p1");
  });
});

describe("countAiCutRuns", () => {
  it("returns the stored count for the project", async () => {
    executeMock.mockResolvedValue({ rows: [{ count: 2 }] });
    const result = await countAiCutRuns("p1");
    expect(result).toBe(2);
  });

  it("returns 0 when there are no rows at all", async () => {
    executeMock.mockResolvedValue({ rows: [] });
    const result = await countAiCutRuns("p1");
    expect(result).toBe(0);
  });
});

describe("listAiCutRuns", () => {
  it("shapes rows into AiCutRun objects, oldest first", async () => {
    executeMock.mockResolvedValue({
      rows: [
        { id: "r1", runNumber: 1, name: null, ranges: [], model: "m", createdAt: "2026-01-01T00:00:00Z" },
        { id: "r2", runNumber: 2, name: "take 2", ranges: [{ startIndex: 0, endIndex: 1, category: "retake" }], model: "m", createdAt: "2026-01-02T00:00:00Z" },
      ],
    });

    const result = await listAiCutRuns("p1");

    expect(result).toEqual([
      { id: "r1", runNumber: 1, name: null, ranges: [], model: "m", createdAt: "2026-01-01T00:00:00.000Z" },
      {
        id: "r2",
        runNumber: 2,
        name: "take 2",
        ranges: [{ startIndex: 0, endIndex: 1, category: "retake" }],
        model: "m",
        createdAt: "2026-01-02T00:00:00.000Z",
      },
    ]);
  });

  it("returns an empty array when the project has no stored runs", async () => {
    executeMock.mockResolvedValue({ rows: [] });
    const result = await listAiCutRuns("p1");
    expect(result).toEqual([]);
  });
});

describe("getAiCutRun", () => {
  it("returns the run when scoped to the given project", async () => {
    executeMock.mockResolvedValue({
      rows: [{ id: "r1", runNumber: 1, name: null, ranges: [], model: "m", createdAt: "2026-01-01T00:00:00Z" }],
    });
    const result = await getAiCutRun("r1", "p1");
    expect(result?.id).toBe("r1");
  });

  it("returns null when no run matches that id + project pair", async () => {
    executeMock.mockResolvedValue({ rows: [] });
    const result = await getAiCutRun("r1", "wrong-project");
    expect(result).toBeNull();
  });
});

describe("createAiCutRun", () => {
  it("inserts at the next contiguous run_number and returns the shaped run", async () => {
    executeMock.mockResolvedValue({
      rows: [{ id: "r3", runNumber: 3, name: null, ranges: [], model: "gemini-2.5-flash", createdAt: "2026-01-03T00:00:00Z" }],
    });

    const result = await createAiCutRun("p1", [], "gemini-2.5-flash");

    expect(result).toEqual({
      id: "r3",
      runNumber: 3,
      name: null,
      ranges: [],
      model: "gemini-2.5-flash",
      createdAt: "2026-01-03T00:00:00.000Z",
    });
    const { text } = renderSql(executeMock.mock.calls[0][0]);
    expect(text).toContain("INSERT INTO ai_cut_runs");
    expect(text).toContain("active_ai_cut_run_id = ins.id");
    expect(text).toContain("ai_cut_claim_at = NULL");
  });
});

describe("setActiveAiCutRun", () => {
  it("returns the run when it belongs to the project", async () => {
    executeMock.mockResolvedValue({
      rows: [{ id: "r1", runNumber: 1, name: null, ranges: [], model: "m", createdAt: "2026-01-01T00:00:00Z" }],
    });
    const result = await setActiveAiCutRun("p1", "r1");
    expect(result?.id).toBe("r1");
  });

  it("returns null when the run doesn't belong to the project (no cross-project switch)", async () => {
    executeMock.mockResolvedValue({ rows: [] });
    const result = await setActiveAiCutRun("p1", "run-on-another-project");
    expect(result).toBeNull();
  });
});

describe("deleteAiCutRunAndRenumber", () => {
  it("deletes the run then renumbers the remaining rows contiguously", async () => {
    await deleteAiCutRunAndRenumber("p1", "r2");

    expect(executeMock).toHaveBeenCalledTimes(2);
    const del = renderSql(executeMock.mock.calls[0][0]);
    expect(del.text).toContain("DELETE FROM ai_cut_runs");
    expect(del.params).toEqual(["r2", "p1"]);

    const renumber = renderSql(executeMock.mock.calls[1][0]);
    expect(renumber.text).toContain("UPDATE ai_cut_runs");
    expect(renumber.text).toContain("ROW_NUMBER() OVER (ORDER BY run_number)");
    expect(renumber.text).toContain("run_number != sub.new_number");
  });

  it("issues the delete before the renumber (order matters — renumbering must see the gap)", async () => {
    const order: string[] = [];
    executeMock.mockImplementation(async (q: SQL) => {
      order.push(renderSql(q).text.trim().slice(0, 6));
      return { rows: [] };
    });
    await deleteAiCutRunAndRenumber("p1", "r2");
    expect(order).toEqual(["DELETE", "UPDATE"]);
  });
});

describe("renameAiCutRun", () => {
  it("updates the name and returns the shaped run when found", async () => {
    executeMock.mockResolvedValue({
      rows: [{ id: "r1", runNumber: 1, name: "final take", ranges: [], model: "m", createdAt: "2026-01-01T00:00:00Z" }],
    });
    const result = await renameAiCutRun("p1", "r1", "final take");
    expect(result?.name).toBe("final take");
  });

  it("allows clearing the name back to null", async () => {
    executeMock.mockResolvedValue({
      rows: [{ id: "r1", runNumber: 1, name: null, ranges: [], model: "m", createdAt: "2026-01-01T00:00:00Z" }],
    });
    const result = await renameAiCutRun("p1", "r1", null);
    expect(result?.name).toBeNull();
  });

  it("returns null when the run isn't found for that project", async () => {
    executeMock.mockResolvedValue({ rows: [] });
    const result = await renameAiCutRun("p1", "missing", "x");
    expect(result).toBeNull();
  });
});
