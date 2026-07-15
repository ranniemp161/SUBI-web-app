import PusherServer from "pusher";
import PusherClient from "pusher-js";

/**
 * The private channel carrying a project's `transcript_status` events.
 *
 * `private-` is load-bearing, not a naming convention: Pusher only enforces
 * authorization on channels with this prefix. A bare channel name would let
 * anyone holding the (public, bundled) NEXT_PUBLIC_PUSHER_KEY subscribe to
 * any project's events — and open unauthenticated connections against our
 * Pusher quota (see docs/reviews/2026-07-15-ddos-abuse-review.md, Finding 1).
 * Subscription therefore round-trips through /api/pusher/auth, which checks
 * project ownership before countersigning.
 */
export function projectChannel(projectId: string): string {
  return `private-${projectId}`;
}

// Server-side instance
export const pusherServer = new PusherServer({
  appId: process.env.PUSHER_APP_ID!,
  key: process.env.NEXT_PUBLIC_PUSHER_KEY!,
  secret: process.env.PUSHER_SECRET!,
  cluster: process.env.NEXT_PUBLIC_PUSHER_CLUSTER!,
  useTLS: true,
});

// Client-side singleton
let pusherClientInstance: PusherClient | null = null;

export const getPusherClient = () => {
  if (typeof window === "undefined") return null;

  if (!pusherClientInstance) {
    pusherClientInstance = new PusherClient(process.env.NEXT_PUBLIC_PUSHER_KEY!, {
      cluster: process.env.NEXT_PUBLIC_PUSHER_CLUSTER!,
      // Private-channel subscriptions POST {socket_id, channel_name} here;
      // the route authorizes only channels for projects the session owns.
      // Same-origin ajax, so the Clerk session cookie rides along.
      channelAuthorization: {
        endpoint: "/api/pusher/auth",
        transport: "ajax",
      },
    });
  }

  return pusherClientInstance;
};
