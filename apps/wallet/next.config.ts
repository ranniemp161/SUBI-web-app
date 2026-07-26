import type { NextConfig } from "next";

if (process.env.NODE_ENV === "production") {
  const roughCutUrl = process.env.NEXT_PUBLIC_ROUGH_CUT_URL;
  if (!roughCutUrl) throw new Error("Missing NEXT_PUBLIC_ROUGH_CUT_URL during production build");
  if (process.env.VERCEL) {
    const url = new URL(roughCutUrl);
    if (url.hostname === "localhost" || url.hostname === "127.0.0.1") {
      throw new Error(`NEXT_PUBLIC_ROUGH_CUT_URL points to localhost in a production Vercel build`);
    }
  }
}

const nextConfig: NextConfig = {
  /* config options here */
  reactCompiler: true,
  transpilePackages: ["@repo/db"],
};

// Mirrors apps/rough-cut/next.config.ts: only wrap when a DSN is present, so a
// local build without Sentry configured stays untouched. Source-map upload
// additionally needs SENTRY_AUTH_TOKEN/ORG/PROJECT, which the Vercel<->Sentry
// integration provisions.
const buildConfig = async (): Promise<NextConfig> => {
  if (!process.env.SENTRY_DSN && !process.env.NEXT_PUBLIC_SENTRY_DSN) {
    return nextConfig;
  }
  const { withSentryConfig } = await import("@sentry/nextjs");
  return withSentryConfig(nextConfig, {
    org: process.env.SENTRY_ORG,
    project: process.env.SENTRY_PROJECT,
    silent: !process.env.CI,
    disableLogger: true,
  });
};

export default buildConfig;
