import { Webhook } from "svix";
import { NextResponse } from "next/server";
import { clerkClient } from "@clerk/nextjs/server";
import { provisionMemberWithCode } from "@/lib/access-codes";
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
    const rawCode = unsafeMetadata?.accessCode;
    const code = typeof rawCode === "string" ? rawCode.trim() : undefined;

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

    // Creates our users row and atomically redeems the per-member code —
    // idempotent against the lazy fallback in lib/authz.ts, which may have
    // provisioned this user already if they raced the webhook.
    const user = await provisionMemberWithCode(userId, email, code);

    if (!user) {
      try {
        const client = await clerkClient();
        await client.users.deleteUser(userId);
        console.warn(`Deleted user ${userId}: invalid or missing access code.`);
      } catch (err) {
        console.error(`Failed to delete Clerk user ${userId} on failed provisioning:`, err);
      }
    }
  }

  return NextResponse.json({ received: true });
}
