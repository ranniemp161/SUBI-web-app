import { Webhook } from "svix";
import { NextResponse } from "next/server";
import { clerkClient } from "@clerk/nextjs/server";
import { db } from "@/db";
import { users } from "@/db/schema";
import { hasValidAccessCode } from "@/lib/access-code";
import { ipRateLimit } from "@/lib/ip-rate-limit";

// No Clerk session on this request (Clerk itself is calling us), so it's
// exempt from src/proxy.ts's middleware and per-user limits. The svix
// signature below is the real gate; this is just a volume/cost ceiling, kept
// high since Clerk's own infra may proxy through few IPs and can burst
// during real signup spikes — a dropped legitimate webhook (meaning the
// access-code gate never runs) is worse than a temporarily loose limit.
const WEBHOOK_LIMIT = 120;
const WEBHOOK_WINDOW_SECONDS = 60;

/**
 * POST /api/webhooks/clerk
 *
 * Server-side enforcement of the access-code gate. The signup form
 * can't actually block account creation — `signUp.create()` talks
 * directly to Clerk's API with a public key, so any client-side check
 * is just a UX nicety. This webhook is the real gate: on every
 * `user.created` event we check the access code the client attached
 * as `unsafeMetadata`, and delete the user immediately if it's missing
 * or wrong.
 */
export async function POST(request: Request) {
  const webhookSecret = process.env.CLERK_WEBHOOK_SECRET;

  if (!webhookSecret) {
    console.error("CLERK_WEBHOOK_SECRET environment variable is not set.");
    return NextResponse.json(
      { error: "Server configuration error." },
      { status: 500 }
    );
  }

  const svixId = request.headers.get("svix-id");
  const svixTimestamp = request.headers.get("svix-timestamp");
  const svixSignature = request.headers.get("svix-signature");

  if (!svixId || !svixTimestamp || !svixSignature) {
    return NextResponse.json(
      { error: "Missing svix headers." },
      { status: 400 }
    );
  }

  const limit = await ipRateLimit(request, "webhook-clerk", WEBHOOK_LIMIT, WEBHOOK_WINDOW_SECONDS);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Too many webhook requests." },
      { status: 429 }
    );
  }

  const body = await request.text();

  let event: { type: string; data: Record<string, unknown> };

  try {
    const webhook = new Webhook(webhookSecret);
    event = webhook.verify(body, {
      "svix-id": svixId,
      "svix-timestamp": svixTimestamp,
      "svix-signature": svixSignature,
    }) as { type: string; data: Record<string, unknown> };
  } catch {
    return NextResponse.json(
      { error: "Invalid webhook signature." },
      { status: 400 }
    );
  }

  if (event.type === "user.created") {
    const userId = event.data.id as string;
    const unsafeMetadata = event.data.unsafe_metadata as
      | Record<string, unknown>
      | undefined;
    if (!hasValidAccessCode(unsafeMetadata)) {
      const client = await clerkClient();
      await client.users.deleteUser(userId);
      console.warn(`Deleted user ${userId}: invalid or missing access code.`);
      return NextResponse.json({ received: true });
    }

    // Access code is valid — create our own users row now, with the
    // real email, instead of waiting for the first project creation
    // to lazily upsert a placeholder.
    const emailAddresses = event.data.email_addresses as
      | Array<{ id: string; email_address: string }>
      | undefined;
    const primaryEmailId = event.data.primary_email_address_id as
      | string
      | undefined;
    const email =
      emailAddresses?.find((e) => e.id === primaryEmailId)?.email_address ??
      emailAddresses?.[0]?.email_address ??
      "";

    await db
      .insert(users)
      .values({ clerkId: userId, email })
      .onConflictDoNothing();
  }

  return NextResponse.json({ received: true });
}
