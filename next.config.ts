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
    proxyClientMaxBodySize: "2gb",
  },
};

export default nextConfig;
