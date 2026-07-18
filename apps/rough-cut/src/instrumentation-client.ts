import * as Sentry from "@sentry/nextjs";

// Client-side error + navigation reporting. Env-gated on the public DSN — no
// DSN, no init (the SDK ships in the bundle but stays inert).
if (process.env.NEXT_PUBLIC_SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
    tracesSampleRate: Number(process.env.NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE ?? "0"),
    environment: process.env.NODE_ENV,
    integrations: [
      Sentry.feedbackIntegration({
        colorScheme: "system",
        autoInject: false,
        submitButtonLabel: "Send",
        formTitle: "Request a feature or share feedback",
        messagePlaceholder:
          "What feature would make Ruff Cut better for you? The more detail the better.",
        showBranding: false,
      }),
    ],
  });
}

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
