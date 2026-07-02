import * as Sentry from "@sentry/nextjs";

// Env-gated: without SENTRY_DSN the SDK is never initialized, so every Sentry.*
// call across the app is a no-op. Set SENTRY_DSN to turn error reporting on.
if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? "0"),
    environment: process.env.NODE_ENV,
  });
}
