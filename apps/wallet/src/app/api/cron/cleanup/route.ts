import { NextResponse } from "next/server";
import { db } from "@repo/db";
import { rateLimits } from "@repo/db/schema";
import { sql } from "drizzle-orm";
import { reportError } from "@/lib/observability";

// Allow a generous timeout for the DB deletion.
export const maxDuration = 300;

export async function GET(request: Request) {
  // Enforce Vercel cron authorization
  const authHeader = request.headers.get("Authorization");
  if (
    process.env.CRON_SECRET &&
    authHeader !== `Bearer ${process.env.CRON_SECRET}`
  ) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    // Delete rate limit buckets that are older than 24 hours.
    // This prevents the table from growing unboundedly under load.
    await db
      .delete(rateLimits)
      .where(sql`${rateLimits.windowStart} < now() - interval '24 hours'`);

    return NextResponse.json({ success: true });
  } catch (error) {
    reportError("Failed to clean up rate limits", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
