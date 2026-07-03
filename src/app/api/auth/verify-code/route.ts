import { timingSafeEqual } from "crypto";
import { NextResponse } from "next/server";
import { ipRateLimit } from "@/lib/ip-rate-limit";

// Public and pre-session, so there's no clerkId to key a limit on — IP is
// the next-best identity. 10/5min leaves room for a handful of real signups
// sharing one IP/NAT while keeping online brute-force of a short, human-typed
// shared secret impractical (120 guesses/hour/IP).
const VERIFY_LIMIT = 10;
const VERIFY_WINDOW_SECONDS = 300;

/**
 * POST /api/auth/verify-code
 *
 * Verifies the access code submitted during signup against
 * the ACCESS_CODE environment variable. This endpoint is public
 * (not behind Clerk auth) so it can be called during the signup flow.
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { accessCode } = body;

    if (!accessCode) {
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

    const validCode = process.env.ACCESS_CODE;

    if (!validCode) {
      console.error("ACCESS_CODE environment variable is not set.");
      return NextResponse.json(
        { valid: false, error: "Server configuration error." },
        { status: 500 }
      );
    }

    const expected = Buffer.from(validCode.trim());
    const provided = Buffer.from(accessCode.trim());

    if (
      expected.length === provided.length &&
      timingSafeEqual(expected, provided)
    ) {
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
