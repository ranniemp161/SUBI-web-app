import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  reactCompiler: true,
  // Lets the dev server's HMR websocket work when accessed through a
  // temporary tunnel (e.g. cloudflared) for testing webhooks locally.
  allowedDevOrigins: ["bidding-bend-pockets-gif.trycloudflare.com"],
  // clerkMiddleware (src/proxy.ts) runs on /api routes and otherwise caps
  // the body it buffers at 10MB — too small for the video uploads that
  // /api/transcribe/whisper accepts directly.
  experimental: {
    proxyClientMaxBodySize: "8gb",
  },
};

// Wrap with the Sentry build plugin (source-map upload, etc.) only when Sentry
// is configured. The import is dynamic + env-gated so that when Sentry is off,
// @sentry/nextjs never enters next.config's module trace — otherwise Turbopack
// flags it as unintentionally tracing the whole project — and default builds
// stay completely Sentry-free.
export default async (): Promise<NextConfig> => {
  if (!process.env.SENTRY_DSN) return nextConfig;
  const { withSentryConfig } = await import("@sentry/nextjs");
  return withSentryConfig(nextConfig, {
    org: process.env.SENTRY_ORG,
    project: process.env.SENTRY_PROJECT,
    silent: !process.env.CI,
    disableLogger: true,
  });
};
