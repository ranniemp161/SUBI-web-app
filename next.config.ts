import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  reactCompiler: true,
  // Lets the dev server's HMR websocket work when accessed through a
  // temporary tunnel (e.g. cloudflared) for testing webhooks locally.
  allowedDevOrigins: ["observation-rand-broad-glossary.trycloudflare.com"],
};

export default nextConfig;
