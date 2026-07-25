import * as Sentry from "@sentry/nextjs";

// Edge runtime (Clerk middleware in src/proxy.ts runs here). Same env gate and
// same NEXT_PUBLIC_SENTRY_DSN fallback as the server config.
const dsn = process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? "0"),
    environment: process.env.NODE_ENV,
  });
}
