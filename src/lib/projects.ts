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
