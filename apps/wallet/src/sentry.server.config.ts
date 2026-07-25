import * as Sentry from "@sentry/nextjs";

// Env-gated: without a DSN the SDK is never initialized, so every Sentry.*
// call across the app is a no-op.
//
// Mirrors apps/rough-cut/src/sentry.server.config.ts, including the
// NEXT_PUBLIC_SENTRY_DSN fallback — the Vercel<->Sentry integration provisions
// that name but never a bare SENTRY_DSN. A DSN is public by design (it ships in
// the client bundle), so reading the NEXT_PUBLIC_ one here leaks nothing.
const dsn = process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? "0"),
    environment: process.env.NODE_ENV,
  });
}
