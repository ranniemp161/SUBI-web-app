import { sql } from "drizzle-orm";
import { db } from "@repo/db";
import { users, type User } from "@repo/db/schema";

/**
 * Idempotently ensure a users row exists for this Clerk user.
 * 
 * This creates a user record so they can use the application.
 */
export async function provisionUser(
  clerkId: string,
  email: string
): Promise<User> {
  if (!clerkId || !email) {
    throw new Error(
      `provisionUser requires both clerkId and email (got clerkId="${clerkId}", email="${email}")`
    );
  }

  const [user] = await db
    .insert(users)
    .values({ clerkId, email })
    .onConflictDoUpdate({
      target: users.clerkId,
      set: { email: sql`${users.email}` },
    })
    .returning();

  return user;
}
