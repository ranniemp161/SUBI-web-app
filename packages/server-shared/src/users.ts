import { db } from "@repo/db";
import { users, type User } from "@repo/db/schema";

/**
 * Only this email is granted membership (monthly credit grant) on
 * provisioning — everyone else starts at isMember=false and pays via Stripe.
 * Case-insensitive since email providers treat case as insignificant.
 */
export function isAllowlistedMember(email: string): boolean {
  const raw = process.env.MEMBER_ALLOWLIST_EMAIL;
  if (!raw || !email) return false;
  const cleanAllowlisted = raw.trim().replace(/^["']|["']$/g, "").toLowerCase();
  const cleanEmail = email.trim().toLowerCase();
  return cleanEmail === cleanAllowlisted;
}

/**
 * Idempotently ensure a users row exists for this Clerk user.
 *
 * Called from the Clerk webhook on both `user.created` and `user.updated`,
 * so it runs again on every profile change — not just once at sign-up.
 * On conflict, `email` and `isMember` are written together from the verified
 * primary address in the event, keeping the row consistent with Clerk. That
 * means membership follows the current email: changing the primary address to
 * (or away from) MEMBER_ALLOWLIST_EMAIL grants or revokes it. The caller must
 * only ever pass an address Clerk reports as primary AND verified.
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
      set: { email, isMember },
    })
    .returning();

  return user;
}
