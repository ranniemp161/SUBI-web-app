import * as Sentry from "@sentry/nextjs";

// Edge runtime (Clerk middleware in src/proxy.ts runs here). Same env gate as
// the server config — no DSN, no initialization.
if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? "0"),
    environment: process.env.NODE_ENV,
  });
}
