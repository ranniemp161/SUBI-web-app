import { currentUser } from "@clerk/nextjs/server";
import { eq } from "drizzle-orm";
import { db, withDbRetry } from "@/db";
import { users, type User } from "@/db/schema";
import { provisionMemberWithCode } from "@/lib/access-codes";

/**
 * DB-backed authorization for write routes — the successor to the old
 * hasValidAccessCode() env-var check.
 *
 * The users row IS the authorization: it only exists once the Clerk
 * `user.created` webhook (or the fallback below) validated an access code.
 * The fallback covers the window where signUp.create() has already granted a
 * session but the webhook hasn't landed yet — the same wrinkle the old
 * metadata re-check handled, now redeeming the real per-member code.
 */
export async function getAuthorizedDbUser(clerkId: string): Promise<User | null> {
  const rows = await withDbRetry(() =>
    db.select().from(users).where(eq(users.clerkId, clerkId)).limit(1)
  );
  if (rows.length > 0) return rows[0];

  const clerkUser = await currentUser();
  const code = clerkUser?.unsafeMetadata?.accessCode;
  if (typeof code !== "string" || !code.trim()) return null;

  const email = clerkUser?.emailAddresses[0]?.emailAddress ?? "";
  return provisionMemberWithCode(clerkId, email, code.trim());
}
