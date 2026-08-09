import { describe, it, expect, vi, beforeEach } from "vitest";

// `projects.ts` carries `import "server-only"`, whose default export throws
// outside Next's react-server condition. Vitest has no such condition and this
// app's vitest.config.ts sets no alias for it, so the module is stubbed here
// rather than editing shared config. Our tests exercise server-side code paths,
// which is exactly what the guard is meant to allow.
vi.mock("server-only", () => ({}));

const state = vi.hoisted(() => ({
  inserted: null as Record<string, unknown> | null,
  selectedColumns: null as Record<string, unknown> | null,
  rows: [] as Record<string, unknown>[],
}));

vi.mock("@repo/db", () => ({
  db: {
    insert: vi.fn(() => ({
      values: vi.fn((values: Record<string, unknown>) => {
        state.inserted = values;
        return {
          returning: vi.fn(async () => [{ id: "broll-project-1" }]),
        };
      }),
    })),
    select: vi.fn((columns: Record<string, unknown>) => {
      state.selectedColumns = columns;
      return {
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            limit: vi.fn(async () => state.rows),
          })),
        })),
      };
    }),
  },
}));

import { createBrollProject, getBrollProject } from "./projects";
import type { TranscriptDocument } from "@repo/transcript";

beforeEach(() => {
  state.inserted = null;
  state.selectedColumns = null;
  state.rows = [];
  vi.clearAllMocks();
});

function document(overrides: Record<string, unknown> = {}): TranscriptDocument {
  return {
    version: 1,
    fps: { numerator: 30, denominator: 1 },
    duration: 395.5,
    generatedAt: "2026-08-09T12:00:00.000Z",
    wordsAligned: true,
    source: {
      kind: "rough-cut",
      projectId: "rough-cut-project-1",
      edlFingerprint: "abc123def456",
    },
    segments: [],
    ...overrides,
  } as unknown as TranscriptDocument;
}

describe("createBrollProject", () => {
  it("returns the new project's id", async () => {
    await expect(
      createBrollProject({
        userId: "user-1",
        name: "Launch video",
        style: "anime",
        document: document(),
        sourceProjectId: "rough-cut-project-1",
      })
    ).resolves.toBe("broll-project-1");
  });

  it("stores the duration in milliseconds, not the document's seconds", async () => {
    // Seconds in the document, milliseconds in the column. Stored rather than
    // recomputed because every project card reads it and parsing a 5 MB
    // document to learn one number is absurd.
    await createBrollProject({
      userId: "user-1",
      name: "Launch video",
      style: "anime",
      document: document({ duration: 395.5 }),
      sourceProjectId: null,
    });
    expect(state.inserted?.durationMs).toBe(395_500);
  });

  it("rounds a fractional millisecond rather than truncating", async () => {
    await createBrollProject({
      userId: "user-1",
      name: "n",
      style: "anime",
      document: document({ duration: 1.00049 }),
      sourceProjectId: null,
    });
    expect(state.inserted?.durationMs).toBe(1000);
  });

  it("lifts the edit fingerprint out of the document into its own column", async () => {
    // So a future staleness check can compare without parsing the document.
    await createBrollProject({
      userId: "user-1",
      name: "n",
      style: "anime",
      document: document(),
      sourceProjectId: null,
    });
    expect(state.inserted?.edlFingerprint).toBe("abc123def456");
  });

  it("accepts a null source project, which is what a subtitle upload has", async () => {
    // `source_project_id` is nullable precisely because an uploaded .srt has no
    // Rough Cut project behind it.
    await createBrollProject({
      userId: "user-1",
      name: "n",
      style: "anime",
      document: document(),
      sourceProjectId: null,
    });
    expect(state.inserted?.sourceProjectId).toBeNull();
  });

  it("stores the whole document as the transcript", async () => {
    const doc = document();
    await createBrollProject({
      userId: "user-1",
      name: "n",
      style: "anime",
      document: doc,
      sourceProjectId: null,
    });
    expect(state.inserted?.transcript).toBe(doc);
  });
});

describe("getBrollProject", () => {
  it("returns the project with its transcript", async () => {
    const doc = document();
    state.rows = [
      {
        id: "broll-project-1",
        name: "Launch video",
        durationMs: 395_500,
        style: "anime",
        createdAt: new Date("2026-08-09T12:00:00.000Z"),
        transcript: doc,
      },
    ];
    const result = await getBrollProject("user-1", "broll-project-1");
    expect(result?.id).toBe("broll-project-1");
    expect(result?.transcript).toBe(doc);
  });

  it("returns null when no row matched (AC-37, AC-38)", async () => {
    // The user_id predicate is part of the query, so another user's project is
    // indistinguishable from one that does not exist. There is no code path
    // that reads a foreign row and then decides what to do about it.
    state.rows = [];
    await expect(getBrollProject("user-2", "broll-project-1")).resolves.toBeNull();
  });

  it("reads the transcript column, since a detail view needs it", async () => {
    state.rows = [];
    await getBrollProject("user-1", "broll-project-1");
    expect(state.selectedColumns).toHaveProperty("transcript");
  });
});
