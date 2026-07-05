import { NextResponse } from "next/server";
import { ipRateLimit } from "@/lib/ip-rate-limit";
import { isCodeAvailable } from "@/lib/access-codes";

// Public and pre-session, so there's no clerkId to key a limit on — IP is
// the next-best identity. 10/5min leaves room for a handful of real signups
// sharing one IP/NAT while keeping online brute-force impractical (codes are
// ~41 bits of entropy; 120 guesses/hour/IP doesn't dent that).
const VERIFY_LIMIT = 10;
const VERIFY_WINDOW_SECONDS = 300;

/**
 * POST /api/auth/verify-code
 *
 * UX pre-check of a per-member Skool access code against the access_codes
 * table (exists, unrevoked, unredeemed). This endpoint is public (not behind
 * Clerk auth) so it can be called during the signup flow. It does NOT redeem
 * the code — redemption happens server-side once the account exists (Clerk
 * user.created webhook → provisionMemberWithCode).
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { accessCode } = body;

    if (!accessCode || typeof accessCode !== "string") {
      return NextResponse.json(
        { valid: false, error: "Access code is required." },
        { status: 400 }
      );
    }

    const limit = await ipRateLimit(request, "verify-code", VERIFY_LIMIT, VERIFY_WINDOW_SECONDS);
    if (!limit.allowed) {
      return NextResponse.json(
        { valid: false, error: "Too many attempts. Please wait a bit and try again." },
        { status: 429 }
      );
    }

    if (await isCodeAvailable(accessCode.trim())) {
      return NextResponse.json({ valid: true });
    }

    return NextResponse.json(
      { valid: false, error: "Invalid access code." },
      { status: 401 }
    );
  } catch {
    return NextResponse.json(
      { valid: false, error: "Invalid request body." },
      { status: 400 }
    );
  }
}
