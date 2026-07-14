import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, withDbRetry } from "@repo/db";
import { users } from "@repo/db/schema";
import { getAuthorizedDbUser } from "@/lib/authz";
import { ensureMonthlyGrant, memberGrantMicros } from "@/lib/credits";
import { readRateLimit } from "@/lib/rate-limit";
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

  const limit = await readRateLimit(clerkId);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Too many requests. Please wait a bit and try again." },
      { status: 429 }
    );
  }

  try {
    const user = await getAuthorizedDbUser(clerkId);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    await ensureMonthlyGrant(user.id, memberGrantMicros());

    // Re-read: the grant may have just changed the balance.
    const [fresh] = await withDbRetry(() =>
      db.select().from(users).where(eq(users.id, user.id)).limit(1)
    );

    // Explicit no-store: per-user balance must never be served stale (or,
    // worse, cross-user) by any cache/proxy in front of the app.
    return NextResponse.json(
      {
        balanceMicros: fresh?.balanceMicros ?? user.balanceMicros,
        isMember: fresh?.isMember ?? user.isMember,
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    reportError("Error fetching credit balance", error);
    return NextResponse.json(
      { error: "Failed to fetch credits." },
      { status: 500 }
    );
  }
}
