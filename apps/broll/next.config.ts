import type { NextConfig } from "next";

/**
 * Fail the production build rather than deploy an app that deep-links users
 * into nowhere. Mirrors apps/wallet/next.config.ts: src/lib/env.ts throws at
 * import time for the same vars, but a build-time check fails louder and
 * earlier, before any page is prerendered.
 */
if (process.env.NODE_ENV === "production") {
  for (const name of [
    "NEXT_PUBLIC_ROUGH_CUT_URL",
    "NEXT_PUBLIC_WALLET_URL",
  ] as const) {
    const value = process.env[name];
    if (!value) throw new Error(`Missing ${name} during production build`);
    if (process.env.VERCEL) {
      const { hostname } = new URL(value);
      if (hostname === "localhost" || hostname === "127.0.0.1") {
        throw new Error(`${name} points to localhost in a production Vercel build`);
      }
    }
  }
}

const nextConfig: NextConfig = {
  reactCompiler: true,
  transpilePackages: ["@repo/db"],
};

export default nextConfig;
