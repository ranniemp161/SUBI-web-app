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

export default nextConfig;
