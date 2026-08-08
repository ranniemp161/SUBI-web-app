import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * env.ts reads process.env at module load, so every case has to re-import it
 * with a fresh module registry. The behaviour worth pinning is the asymmetry:
 * a missing URL is a convenience in development and a build failure in
 * production, because the alternative is silently deep-linking a user who has
 * run out of credit into nowhere.
 */
async function loadEnv() {
  vi.resetModules();
  return import("./env");
}

describe("cross-app URLs", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  it("falls back to the pinned dev ports when unset outside production", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("NEXT_PUBLIC_ROUGH_CUT_URL", "");
    vi.stubEnv("NEXT_PUBLIC_WALLET_URL", "");

    const env = await loadEnv();

    // 3000 and 3001 are pinned repo-wide; b-roll itself is 3003.
    expect(env.ROUGH_CUT_URL).toBe("http://localhost:3000");
    expect(env.WALLET_URL).toBe("http://localhost:3001");
  });

  it("strips a trailing slash so callers can concatenate paths safely", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("NEXT_PUBLIC_ROUGH_CUT_URL", "https://myfirstcut.app/");
    vi.stubEnv("NEXT_PUBLIC_WALLET_URL", "https://myframecredits.app/");

    const env = await loadEnv();

    expect(env.ROUGH_CUT_URL).toBe("https://myfirstcut.app");
    expect(env.WALLET_URL).toBe("https://myframecredits.app");
  });

  it("throws at import time in production when a URL is missing", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_ROUGH_CUT_URL", "https://myfirstcut.app");
    vi.stubEnv("NEXT_PUBLIC_WALLET_URL", "");

    // Failing the prerender step is the point: a deployed build that silently
    // pointed top-up links at nothing would strand a user mid-batch.
    await expect(loadEnv()).rejects.toThrow(/NEXT_PUBLIC_WALLET_URL/);
  });
});
