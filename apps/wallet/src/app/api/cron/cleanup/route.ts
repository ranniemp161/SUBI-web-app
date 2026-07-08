import { NextResponse } from "next/server";
import { reportError } from "@/lib/observability";

// Allow a generous timeout for the DB deletion.
export const maxDuration = 300;

export async function GET(request: Request) {
  // Enforce Vercel cron authorization. Fails closed (matches the autorecharge
  // cron): a missing CRON_SECRET must never leave the route world-callable,
  // even though today's body is a no-op — a future deletion added here would
  // otherwise ship unauthenticated by default.
  const authHeader = request.headers.get("Authorization");
  if (
    !process.env.CRON_SECRET ||
    authHeader !== `Bearer ${process.env.CRON_SECRET}`
  ) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    // Upstash Redis (Vercel KV) handles rate limit TTLs natively,
    // so manual cron cleanup is no longer required here.
    return NextResponse.json({ success: true, message: "No cleanup required" });
  } catch (error) {
    reportError("Failed to run cleanup cron", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
