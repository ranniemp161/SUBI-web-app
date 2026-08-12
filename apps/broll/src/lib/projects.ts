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
  /** The Ruff Cut project this was inherited from, or null on an upload. */
  sourceProjectId: string | null;
  /**
   * The edit fingerprint the transcript was taken at, lifted out of the
   * document so the staleness check can compare without parsing it (AC-49).
   */
  edlFingerprint: string | null;
  /**
   * How many plan runs this project has had. Zero means the next one is
   * bundled into the character set price rather than charged (AC-25) — the
   * page needs it to tell the user which before they press the button.
   *
   * Read only for display. The decision that actually moves money is made
   * inside `chargeBrollPlanRerun`, in the same statement as the charge, because
   * reading it here and charging on the answer would be check-then-act.
   */
  planRuns: number;
  /** Output frame size the renderer encodes at (spec `0001` Phase 4). */
  outputWidth: number;
  outputHeight: number;
  /**
   * Output rate as an exact rational. Kept as numerator and denominator rather
   * than a decimal because 30000/1001 is not 29.97, and rounding it there would
   * put the encoder on a different frame grid from the timecode in the
   * filename — the one disagreement `@repo/transcript` exists to prevent.
   */
  outputFpsNum: number;
  outputFpsDen: number;
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
    .select({
      ...summaryColumns,
      transcript: brollProjects.transcript,
      sourceProjectId: brollProjects.sourceProjectId,
      edlFingerprint: brollProjects.edlFingerprint,
      planRuns: brollProjects.planRuns,
      outputWidth: brollProjects.outputWidth,
      outputHeight: brollProjects.outputHeight,
      outputFpsNum: brollProjects.outputFpsNum,
      outputFpsDen: brollProjects.outputFpsDen,
    })
    .from(brollProjects)
    .where(and(eq(brollProjects.id, id), eq(brollProjects.userId, userId)))
    .limit(1);

  const row = rows[0];
  if (!row) return null;
  return { ...row, transcript: row.transcript as TranscriptDocument };
}

/**
 * Whether a generation currently holds this project, and for how much.
 *
 * Read only, and deliberately never written here: `hold_micros` and
 * `gen_claim_at` are set and cleared together inside `@repo/billing`, which is
 * what keeps spec `broll/0002`'s invariant 5 checkable by reading one file. This
 * exists so the commit route can tell a run that still holds its money from one
 * whose claim was already reclaimed and refunded — storing a set for the second
 * would hand over six images the user has been given their money back for.
 *
 * Owner scoped like every other query in this file.
 */
export async function getBrollGenerationState(
  userId: string,
  id: string
): Promise<{ holdMicros: number | null; genClaimAt: Date | null } | null> {
  const rows = await db
    .select({
      holdMicros: brollProjects.holdMicros,
      genClaimAt: brollProjects.genClaimAt,
    })
    .from(brollProjects)
    .where(and(eq(brollProjects.id, id), eq(brollProjects.userId, userId)))
    .limit(1);

  return rows[0] ?? null;
}
