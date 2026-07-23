import { sql } from "drizzle-orm";
import { db } from "@repo/db";
import { users, type User } from "@repo/db/schema";

/**
 * Only this email is granted membership (monthly credit grant) on
 * provisioning — everyone else starts at isMember=false and pays via Stripe.
 * Case-insensitive since email providers treat case as insignificant.
 */
export function isAllowlistedMember(email: string): boolean {
  const allowlisted = process.env.MEMBER_ALLOWLIST_EMAIL;
  return !!allowlisted && email.toLowerCase() === allowlisted.toLowerCase();
}

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

  const isMember = isAllowlistedMember(email);

  const [user] = await db
    .insert(users)
    .values({ clerkId, email, isMember })
    .onConflictDoUpdate({
      target: users.clerkId,
      set: { email: sql`${users.email}`, isMember },
    })
    .returning();

  return user;
}
