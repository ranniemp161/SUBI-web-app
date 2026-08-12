import * as Sentry from "@sentry/nextjs";
import { SERVER_SENTRY_OPTIONS } from "@/lib/sentry-scrub";

// Env-gated: without a DSN the SDK is never initialized, so every Sentry.*
// call across the app is a no-op.
//
// Falls back to NEXT_PUBLIC_SENTRY_DSN because the Vercel<->Sentry integration
// provisions that name but never a bare SENTRY_DSN. A DSN is public by design —
// it already ships inside the client bundle — so reading the public one here
// leaks nothing.
//
// `SHARED_SENTRY_OPTIONS` carries this app's privacy posture: no PII, no
// request bodies collected, and a scrubber that removes them anyway. Do not
// init Sentry here without it — a generate request's body is a face photo.
const dsn = process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  Sentry.init({
    ...SERVER_SENTRY_OPTIONS,
    dsn,
    tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? "0"),
    environment: process.env.NODE_ENV,
  });
}
