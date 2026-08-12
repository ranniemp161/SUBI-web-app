import * as Sentry from "@sentry/nextjs";
import { SHARED_SENTRY_OPTIONS } from "@/lib/sentry-scrub";

// Client-side error reporting. Env-gated on the public DSN — no DSN, no init
// (the SDK ships in the bundle but stays inert).
//
// The same scrubber runs here. The photo is chosen in this browser and posted
// from it, so a client side event is just as capable of carrying it as a server
// one. No feedback widget, unlike Rough Cut: a free text box on a page holding
// someone's face is not a control this app should offer yet.
if (process.env.NEXT_PUBLIC_SENTRY_DSN) {
  Sentry.init({
    ...SHARED_SENTRY_OPTIONS,
    dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
    tracesSampleRate: Number(process.env.NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE ?? "0"),
    environment: process.env.NODE_ENV,
  });
}

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
