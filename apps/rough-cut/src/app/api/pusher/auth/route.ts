import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { pusherServer, projectChannel } from "@/lib/pusher";
import { getOwnedProject } from "@/lib/projects";
import { getAuthorizedDbUser } from "@/lib/authz";
import { rateLimit } from "@/lib/rate-limit";

// Subscriptions re-authorize on every reconnect and the dashboard subscribes
// once per in-flight project, so this needs more headroom than a
// one-shot action — but it's still a cheap DB read, capped like one.
const AUTH_LIMIT = 120;
const AUTH_WINDOW_SECONDS = 300;

// Matches `private-<project uuid>` — same UUID shape the transcribe callback
// validates. Anything else (other prefixes, presence channels, junk) is
// rejected before any DB work.
const CHANNEL_SHAPE =
  /^private-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

// Pusher socket ids are `<digits>.<digits>`.
const SOCKET_ID_SHAPE = /^\d+\.\d+$/;

/**
 * POST /api/pusher/auth — countersigns private-channel subscriptions.
 *
 * pusher-js calls this (see `channelAuthorization` in lib/pusher.ts) with
 * `socket_id` + `channel_name` when the client subscribes to a `private-`
 * channel. Only the owner of the project named in the channel gets a
 * signature; everyone else — including anyone who lifted the public
 * NEXT_PUBLIC_PUSHER_KEY from the bundle — is refused, which is what makes
 * third-party connection floods against our Pusher quota unauthenticatable.
 */
export async function POST(request: Request) {
  const { userId: clerkId } = await auth();

  if (!clerkId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = await getAuthorizedDbUser(clerkId);

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const limit = await rateLimit(
    `pusher-auth:${clerkId}`,
    AUTH_LIMIT,
    AUTH_WINDOW_SECONDS
  );
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Too many subscription attempts. Please wait a bit and try again." },
      { status: 429 }
    );
  }

  // pusher-js sends application/x-www-form-urlencoded.
  const form = await request.formData().catch(() => null);
  const socketId = form?.get("socket_id");
  const channelName = form?.get("channel_name");

  if (typeof socketId !== "string" || !SOCKET_ID_SHAPE.test(socketId)) {
    return NextResponse.json({ error: "Invalid socket_id." }, { status: 400 });
  }

  const channelMatch =
    typeof channelName === "string" ? channelName.match(CHANNEL_SHAPE) : null;

  if (!channelMatch) {
    return NextResponse.json({ error: "Invalid channel_name." }, { status: 400 });
  }

  const projectId = channelMatch[1];

  // Ownership is the authorization: subscribing to another user's project
  // channel fails exactly like a project that doesn't exist.
  const project = await getOwnedProject(projectId, clerkId);

  if (!project) {
    return NextResponse.json({ error: "Project not found." }, { status: 404 });
  }

  return NextResponse.json(
    pusherServer.authorizeChannel(socketId, projectChannel(projectId))
  );
}
