import { NextResponse } from "next/server";

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

    const validCode = process.env.ACCESS_CODE;

    if (!validCode) {
      console.error("ACCESS_CODE environment variable is not set.");
      return NextResponse.json(
        { valid: false, error: "Server configuration error." },
        { status: 500 }
      );
    }

    if (accessCode.trim() === validCode.trim()) {
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
