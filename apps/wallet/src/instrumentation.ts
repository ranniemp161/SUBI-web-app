import * as Sentry from "@sentry/nextjs";

// Next.js calls register() once per server runtime at startup. Load the
// matching Sentry config; each is itself env-gated, so this is a no-op until
// SENTRY_DSN (or NEXT_PUBLIC_SENTRY_DSN) is set.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");
  } else if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
  }
}

// Reports errors Next.js surfaces from server components / route handlers —
// which here includes the Stripe webhook and the auto-recharge cron.
export const onRequestError = Sentry.captureRequestError;
