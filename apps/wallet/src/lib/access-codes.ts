import { and, eq, isNull } from "drizzle-orm";
import { db, withDbRetry } from "@repo/db";
import { users, accessCodes, type User } from "@repo/db/schema";
import { sql } from "drizzle-orm";

/**
 * Per-member Skool access codes (see db/schema.ts accessCodes). A code is
 * redeemable once; redemption marks the redeeming user a member. The users
 * row itself is what authorizes write routes afterwards (lib/authz.ts).
 */

/**
 * Pre-signup UX check: the code exists, isn't revoked, and hasn't been
 * redeemed. Does NOT redeem — that happens in provisionMemberWithCode once
 * the Clerk account exists.
 */
export async function isCodeAvailable(code: string): Promise<boolean> {
  const rows = await withDbRetry(() =>
    db
      .select({ code: accessCodes.code })
      .from(accessCodes)
      .where(
        and(
          eq(accessCodes.code, code),
          isNull(accessCodes.revokedAt),
          isNull(accessCodes.redeemedByUserId)
        )
      )
      .limit(1)
  );
  return rows.length > 0;
}

type Row = Record<string, unknown>;

/**
 * Idempotently ensure a users row exists for this Clerk user and redeem
 * `code` for it. Returns the users row when authorized (newly redeemed, or a
 * user who is already a member — which covers grandfathered accounts with a
 * stale shared code in their Clerk metadata, and makes the Clerk-webhook +
 * lazy-route double-provisioning race harmless), null otherwise.
 *
 * On a failed redemption this deletes only a row it may itself have just
 * created (non-member, zero credits) — never an established account. If the
 * app later opens to non-members, the webhook should stop calling this for
 * codeless signups rather than this function changing shape.
 */
export async function provisionMemberWithCode(
  clerkId: string,
  email: string,
  code: string | undefined
): Promise<User | null> {
  // The no-op DO UPDATE makes RETURNING always yield the row, insert or not.
  const [user] = await db
    .insert(users)
    .values({ clerkId, email })
    .onConflictDoUpdate({
      target: users.clerkId,
      set: { email: sql`${users.email}` },
    })
    .returning();

  if (user.isMember) return user;

  if (code) {
    // One statement: the conditional UPDATE on the code row is the
    // anti-double-redemption gate. Concurrent redemptions of one code
    // serialize on that row; the loser re-evaluates the qual against the
    // committed row and matches nothing. Re-redemption by the same user
    // passes (idempotency for the webhook/lazy-route race).
    const result = await db.execute(sql`
      WITH redeemed AS (
        UPDATE access_codes
        SET redeemed_by_user_id = ${user.id}, redeemed_at = COALESCE(redeemed_at, now())
        WHERE code = ${code} AND revoked_at IS NULL
          AND (redeemed_by_user_id IS NULL OR redeemed_by_user_id = ${user.id})
        RETURNING code
      )
      UPDATE users SET is_member = true
      WHERE id = ${user.id} AND EXISTS (SELECT 1 FROM redeemed)
      RETURNING id
    `);
    const rows = (result as unknown as { rows: Row[] }).rows ?? [];
    if (rows.length > 0) return { ...user, isMember: true };
  }

  // Invalid, revoked, or someone else's code — undo a row we may have just
  // created. The quals keep this from ever touching a real account.
  await db
    .delete(users)
    .where(
      and(
        eq(users.id, user.id),
        eq(users.isMember, false),
        eq(users.balanceMicros, 0)
      )
    );
  return null;
}
