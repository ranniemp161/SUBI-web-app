"use server";

import { auth } from "@clerk/nextjs/server";
import { readRateLimit } from "@/lib/rate-limit";
import {
  findUserIdByClerkId,
  listProjectPage,
  type ProjectSummary,
} from "@/lib/projects";

export type { ProjectSummary };

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

  const userId = await findUserIdByClerkId(clerkId);
  if (!userId) {
    return { data: [] };
  }

  try {
    return await listProjectPage(userId, { cursor });
  } catch {
    // The only thing listProjectPage throws for is a cursor we didn't issue.
    // Surfacing it beats restarting from page one, which would loop forever.
    return { data: [], error: "Invalid cursor. Reload the page." };
  }
}
