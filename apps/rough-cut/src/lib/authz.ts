import { currentUser } from "@clerk/nextjs/server";
import { eq } from "drizzle-orm";
import { db, withDbRetry } from "@repo/db";
import { users, type User } from "@repo/db/schema";
import { provisionUser, isAllowlistedMember } from "@/lib/users";

/**
 * DB-backed authorization for write routes.
 *
 * The users row IS the authorization: it only exists once the Clerk
 * `user.created` webhook (or the fallback below) provisions the user.
 * The fallback covers the window where signUp.create() has already granted a
 * session but the webhook hasn't landed yet.
 */
export async function getAuthorizedDbUser(clerkId: string): Promise<User | null> {
  const clerkUser = await currentUser();
  // Must be the account's PRIMARY email AND verified — emailAddresses[0] is
  // not guaranteed to be either. Clerk lets a signed-in user attach extra
  // (initially unverified) addresses to their profile; picking index 0 blind
  // would let someone add MEMBER_ALLOWLIST_EMAIL as a secondary address and
  // self-grant membership without ever proving they control that inbox.
  const email =
    clerkUser?.emailAddresses.find(
      (e) =>
        e.id === clerkUser.primaryEmailAddressId &&
        e.verification?.status === "verified"
    )?.emailAddress ?? "";

  const rows = await withDbRetry(() =>
    db.select().from(users).where(eq(users.clerkId, clerkId)).limit(1)
  );

  if (rows.length > 0) {
    const existing = rows[0];
    const userEmail = email || existing.email || "";
    if (userEmail && isAllowlistedMember(userEmail) && !existing.isMember) {
      return provisionUser(clerkId, userEmail);
    }
    return existing;
  }

  if (!email) return null;

  return provisionUser(clerkId, email);
}
