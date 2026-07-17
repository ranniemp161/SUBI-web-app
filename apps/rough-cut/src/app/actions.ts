"use server";

import { auth } from "@clerk/nextjs/server";
import { db, withDbRetry } from "@repo/db";
import { projects, users } from "@repo/db/schema";
import { eq, desc, sql, lt, and } from "drizzle-orm";
import { readRateLimit } from "@/lib/rate-limit";

export interface ProjectSummary {
  id: string;
  fileName: string;
  durationMs: number | null;
  transcriptStatus: "idle" | "processing" | "ready" | "failed";
  hasEdl: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const PAGE_SIZE = 12;

export async function loadMoreProjects(cursor?: string): Promise<{
  data: ProjectSummary[];
  nextCursor?: string;
  error?: string;
}> {
  const { userId: clerkId } = await auth();

  if (!clerkId) {
    return { data: [], error: "Unauthorized" };
  }

  const limit = await readRateLimit(clerkId);
  if (!limit.allowed) {
    return { data: [], error: "Too many requests. Please wait a bit." };
  }

  const userRows = await withDbRetry(() =>
    db.select().from(users).where(eq(users.clerkId, clerkId)).limit(1)
  );

  if (userRows.length === 0) {
    return { data: [] };
  }

  const userId = userRows[0].id;

  const conditions = [eq(projects.userId, userId)];
  if (cursor) {
    const cursorDate = new Date(cursor);
    conditions.push(lt(projects.createdAt, cursorDate));
  }

  const userProjects = await withDbRetry(() =>
    db
      .select({
        id: projects.id,
        fileName: projects.fileName,
        durationMs: projects.durationMs,
        transcriptStatus: projects.transcriptStatus,
        createdAt: projects.createdAt,
        updatedAt: projects.updatedAt,
        hasEdl: sql<boolean>`${projects.edl} is not null`,
      })
      .from(projects)
      .where(and(...conditions))
      .orderBy(desc(projects.createdAt))
      .limit(PAGE_SIZE)
  );

  const nextCursor =
    userProjects.length === PAGE_SIZE
      ? userProjects[userProjects.length - 1].createdAt.toISOString()
      : undefined;

  return { data: userProjects, nextCursor };
}
