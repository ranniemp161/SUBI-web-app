import { Webhook } from "svix";
import { NextResponse } from "next/server";
import { provisionUser } from "@/lib/users";
import { ipRateLimit } from "@/lib/ip-rate-limit";

// No Clerk session on this request (Clerk itself is calling us), so it's
// exempt from src/proxy.ts's middleware and per-user limits. The svix
// signature below is the real gate; this is just a volume/cost ceiling, kept
// high since Clerk's own infra may proxy through few IPs and can burst
// during real signup spikes.
const WEBHOOK_LIMIT = 120;
const WEBHOOK_WINDOW_SECONDS = 60;

/**
 * POST /api/webhooks/clerk
 *
 * Webhook that handles user creation from Clerk and provisions them
 * in our own database.
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

  const body = await request.text();

  // Signature BEFORE the rate limit: svix verification is pure CPU, while the
  // limiter costs a Redis command. Checked in this order, unsigned junk can't
  // burn the Upstash quota — whose exhaustion would flip every fail-open
  // abuse cap in both apps to "allow" (see the 2026-07-15 DDoS review). The
  // limiter then only ever counts Clerk-signed traffic.
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

  const limit = await ipRateLimit(request, "webhook-clerk", WEBHOOK_LIMIT, WEBHOOK_WINDOW_SECONDS);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Too many webhook requests." },
      { status: 429 }
    );
  }

  if (event.type === "user.created") {
    const userId = event.data.id as string;

    const emailAddresses = event.data.email_addresses as
      | Array<{
          id: string;
          email_address: string;
          verification: { status: string } | null;
        }>
      | undefined;
    const primaryEmailId = event.data.primary_email_address_id as
      | string
      | undefined;
    // Must be the PRIMARY email AND verified — no falling back to an
    // arbitrary array entry. isMember (granted below via provisionUser) is
    // gated on this exact string matching MEMBER_ALLOWLIST_EMAIL, so an
    // unverified/non-primary address here must never be trusted.
    const email =
      emailAddresses?.find(
        (e) =>
          e.id === primaryEmailId && e.verification?.status === "verified"
      )?.email_address ?? "";

    if (!email) {
      console.error(
        `[Clerk Webhook] user.created for ${userId} has no resolvable email — skipping provisioning.`
      );
      return NextResponse.json({ received: true });
    }

    try {
      await provisionUser(userId, email);
    } catch (err) {
      console.error(
        `[Clerk Webhook] provisionUser failed for ${userId}:`,
        err
      );
      // Return 500 so Clerk retries the webhook delivery.
      return NextResponse.json(
        { error: "User provisioning failed." },
        { status: 500 }
      );
    }
  }

  return NextResponse.json({ received: true });
}

