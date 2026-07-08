import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getAuthorizedDbUser } from "@/lib/authz";
import { rateLimit } from "@/lib/rate-limit";
import { updateAutorechargeSettings } from "@/lib/autorecharge";
import { reportError } from "@/lib/observability";

const UPDATE_LIMIT = 20;
const UPDATE_WINDOW_SECONDS = 3600;

/**
 * Defensive upper bound on a single off-session charge (USD micros). Auto-recharge
 * moves real money without the user present, so a fat-fingered amount is capped.
 * Config, default $1,000.
 */
const MAX_AMOUNT_MICROS =
  Number(process.env.AUTORECHARGE_MAX_AMOUNT_MICROS) || 1_000_000_000;

const settingsSchema = z.object({
  enabled: z.boolean(),
  thresholdMicros: z.number().int().positive(),
  amountMicros: z.number().int().positive(),
});

/** GET /api/billing/autorecharge — the caller's current auto-recharge settings. */
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
    return NextResponse.json({
      enabled: user.autorechargeEnabled,
      thresholdMicros: user.autorechargeThresholdMicros,
      amountMicros: user.autorechargeAmountMicros,
      hasCard: Boolean(user.defaultPaymentMethodId),
      failures: user.autorechargeFailures,
    });
  } catch (error) {
    reportError("Failed to read auto-recharge settings", error);
    return NextResponse.json(
      { error: "Failed to load settings." },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/billing/autorecharge — update auto-recharge settings.
 *
 * Safety rules (ADR 0002/0002): auto-recharge cannot be enabled without a saved
 * card, and the amount must exceed the threshold so a recharge always lifts the
 * balance clear of the trigger line (no immediate re-fire).
 */
export async function PATCH(request: Request) {
  const { userId: clerkId } = await auth();
  if (!clerkId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const user = await getAuthorizedDbUser(clerkId);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    const limit = await rateLimit(
      `autorecharge:${clerkId}`,
      UPDATE_LIMIT,
      UPDATE_WINDOW_SECONDS,
      { failClosed: true }
    );
    if (!limit.allowed) {
      return NextResponse.json(
        { error: "Too many updates. Please wait a bit and try again." },
        { status: 429 }
      );
    }

    const parsed = settingsSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Provide enabled, thresholdMicros, and amountMicros." },
        { status: 400 }
      );
    }
    const { enabled, thresholdMicros, amountMicros } = parsed.data;

    if (enabled && !user.defaultPaymentMethodId) {
      return NextResponse.json(
        { error: "Add a card before turning on auto-recharge.", code: "NO_CARD" },
        { status: 400 }
      );
    }
    if (amountMicros <= thresholdMicros) {
      return NextResponse.json(
        { error: "The recharge amount must be greater than the threshold." },
        { status: 400 }
      );
    }
    if (amountMicros > MAX_AMOUNT_MICROS) {
      return NextResponse.json(
        { error: "That recharge amount is too large." },
        { status: 400 }
      );
    }

    await updateAutorechargeSettings(user.id, {
      enabled,
      thresholdMicros,
      amountMicros,
    });
    return NextResponse.json({ ok: true, enabled });
  } catch (error) {
    reportError("Failed to update auto-recharge settings", error);
    return NextResponse.json(
      { error: "Failed to update settings." },
      { status: 500 }
    );
  }
}
