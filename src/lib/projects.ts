import { db } from "@/db";
import { projects, users } from "@/db/schema";
import { eq, and } from "drizzle-orm";

/**
 * Get a project and verify ownership.
 * Returns the project if the authenticated user owns it, null otherwise.
 */
export async function getOwnedProject(projectId: string, clerkId: string) {
  const result = await db
    .select({
      project: projects,
      user: users,
    })
    .from(projects)
    .innerJoin(users, eq(projects.userId, users.id))
    .where(and(eq(projects.id, projectId), eq(users.clerkId, clerkId)))
    .limit(1);

  return result.length > 0 ? result[0].project : null;
}

/**
 * Fetch only a project's transcript status, verifying ownership — for the
 * dashboard's status poll, which shouldn't pull the whole transcript + EDL
 * jsonb every few seconds just to read one field. Returns null if the project
 * doesn't exist or isn't owned by the caller.
 */
export async function getOwnedProjectStatus(projectId: string, clerkId: string) {
  const result = await db
    .select({ transcriptStatus: projects.transcriptStatus })
    .from(projects)
    .innerJoin(users, eq(projects.userId, users.id))
    .where(and(eq(projects.id, projectId), eq(users.clerkId, clerkId)))
    .limit(1);

  return result.length > 0 ? result[0].transcriptStatus : null;
}
