import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, withDbRetry } from "@/db";
import { users } from "@/db/schema";
import { getAuthorizedDbUser } from "@/lib/authz";
import { ensureMonthlyGrant, memberGrantSeconds } from "@/lib/credits";
import { reportError } from "@/lib/observability";

/**
 * GET /api/credits — the caller's credit balance.
 *
 * Applies the lazy monthly member grant first, so the dashboard's number is
 * always post-top-up (a member opening the app on the 1st sees the new month's
 * allowance without transcribing anything).
 */
export async function GET() {
  const { userId: clerkId } = await auth();

  if (!clerkId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const user = await getAuthorizedDbUser(clerkId);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    await ensureMonthlyGrant(user.id, memberGrantSeconds());

    // Re-read: the grant may have just changed the balance.
    const [fresh] = await withDbRetry(() =>
      db.select().from(users).where(eq(users.id, user.id)).limit(1)
    );

    return NextResponse.json({
      creditSeconds: fresh?.creditSeconds ?? user.creditSeconds,
      isMember: fresh?.isMember ?? user.isMember,
    });
  } catch (error) {
    reportError("Error fetching credit balance", error);
    return NextResponse.json(
      { error: "Failed to fetch credits." },
      { status: 500 }
    );
  }
}
