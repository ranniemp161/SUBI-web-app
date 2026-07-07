import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

describe("env.ts", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("uses devFallback in non-production when env var is missing", async () => {
    Object.defineProperty(process.env, 'NODE_ENV', {
      value: 'development',
      writable: true,
      configurable: true,
    });
    delete process.env.NEXT_PUBLIC_WALLET_URL;
    const env = await import("./env");
    expect(env.WALLET_URL).toBe("http://localhost:3001");
    expect(env.WALLET_DASHBOARD_URL).toBe("http://localhost:3001/dashboard");
  });

  it("uses env var in non-production when provided", async () => {
    Object.defineProperty(process.env, 'NODE_ENV', {
      value: 'development',
      writable: true,
      configurable: true,
    });
    process.env.NEXT_PUBLIC_WALLET_URL = "https://dev.wallet.test/";
    const env = await import("./env");
    expect(env.WALLET_URL).toBe("https://dev.wallet.test"); // Strips trailing slash
  });

  it("throws in production when env var is missing", async () => {
    Object.defineProperty(process.env, 'NODE_ENV', {
      value: 'production',
      writable: true,
      configurable: true,
    });
    delete process.env.NEXT_PUBLIC_WALLET_URL;
    await expect(import("./env")).rejects.toThrow("Missing required env var: NEXT_PUBLIC_WALLET_URL");
  });

  it("uses env var in production when provided", async () => {
    Object.defineProperty(process.env, 'NODE_ENV', {
      value: 'production',
      writable: true,
      configurable: true,
    });
    process.env.NEXT_PUBLIC_WALLET_URL = "https://prod.wallet.test";
    const env = await import("./env");
    expect(env.WALLET_URL).toBe("https://prod.wallet.test");
  });
});
