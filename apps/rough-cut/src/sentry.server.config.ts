import * as Sentry from "@sentry/nextjs";

// Env-gated: without a DSN the SDK is never initialized, so every Sentry.*
// call across the app is a no-op.
//
// Falls back to NEXT_PUBLIC_SENTRY_DSN because the Vercel<->Sentry integration
// provisions that name (alongside SENTRY_ORG/PROJECT/AUTH_TOKEN) but never a
// bare SENTRY_DSN. Gating only on the latter meant the integration looked
// installed while every server and edge error was silently dropped. A DSN is
// public by design — it already ships inside the client bundle — so reading the
// NEXT_PUBLIC_ one here leaks nothing.
const dsn = process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? "0"),
    environment: process.env.NODE_ENV,
  });
}
