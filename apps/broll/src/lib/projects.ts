import "server-only";
import { db } from "@repo/db";
import { brollProjects } from "@repo/db/schema";
import { and, eq } from "drizzle-orm";
import type { TranscriptDocument } from "@repo/transcript";

/**
 * Every query that reaches `broll_projects` lives here, so the column rules
 * below hold in one place rather than in each caller.
 *
 * Types live in this module, NOT in `src/app/actions.ts`. A `"use server"`
 * module may export nothing but async functions, not even a type: Turbopack's
 * server actions transform reads an exported type name as one more runtime
 * export and emits a reference to an identifier that only exists in the type
 * system, so the module throws the moment it is evaluated. That cost Rough Cut
 * a live production outage. See the root AGENTS.md.
 */

/** What the project list shows. Deliberately excludes `transcript`, see below. */
export type ProjectSummary = {
  id: string;
  name: string;
  durationMs: number;
  style: string;
  createdAt: Date;
};

export type ProjectDetail = ProjectSummary & {
  transcript: TranscriptDocument;
};

/**
 * The columns a list is allowed to read.
 *
 * `transcript` is absent on purpose and must stay absent: it holds a document
 * of up to 5 MB and no list displays it, so selecting it would move tens of
 * megabytes per page over the Neon HTTP driver (spec `broll/0002` AC-39).
 * Nothing in the database enforces this.
 */
const summaryColumns = {
  id: brollProjects.id,
  name: brollProjects.name,
  durationMs: brollProjects.durationMs,
  style: brollProjects.style,
  createdAt: brollProjects.createdAt,
};

export async function createBrollProject(input: {
  userId: string;
  name: string;
  style: string;
  document: TranscriptDocument;
  sourceProjectId: string | null;
}): Promise<string> {
  const [row] = await db
    .insert(brollProjects)
    .values({
      userId: input.userId,
      name: input.name,
      style: input.style,
      transcript: input.document,
      // Seconds in the document, milliseconds in the column. Stored rather than
      // recomputed because the planner and every project card read it, and
      // parsing a 5 MB document to learn one number is absurd.
      durationMs: Math.round(input.document.duration * 1000),
      // Lifted out of the document so a future staleness check can compare
      // without parsing it. No staleness policy is decided yet.
      edlFingerprint: input.document.source.edlFingerprint,
      sourceProjectId: input.sourceProjectId,
    })
    .returning({ id: brollProjects.id });

  return row.id;
}

/**
 * Owner scoped by construction. The `user_id` predicate is part of the query
 * rather than a check on the result, so there is no code path that reads
 * another user's row and then decides what to do about it (AC-37, AC-38).
 */
export async function getBrollProject(
  userId: string,
  id: string
): Promise<ProjectDetail | null> {
  const rows = await db
    .select({ ...summaryColumns, transcript: brollProjects.transcript })
    .from(brollProjects)
    .where(and(eq(brollProjects.id, id), eq(brollProjects.userId, userId)))
    .limit(1);

  const row = rows[0];
  if (!row) return null;
  return { ...row, transcript: row.transcript as TranscriptDocument };
}
