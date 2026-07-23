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
  const email = clerkUser?.emailAddresses[0]?.emailAddress ?? "";

  const rows = await withDbRetry(() =>
    db.select().from(users).where(eq(users.clerkId, clerkId)).limit(1)
  );

  if (rows.length > 0) {
    const existing = rows[0];
    if (email && isAllowlistedMember(email) && !existing.isMember) {
      return provisionUser(clerkId, email);
    }
    return existing;
  }

  if (!email) return null;

  return provisionUser(clerkId, email);
}
