import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * Guards the DSN resolution in sentry.server.config.ts.
 *
 * This exists because of a real production outage-in-the-dark: the config used
 * to gate solely on `SENTRY_DSN`, while the Vercel<->Sentry integration only
 * ever provisions `NEXT_PUBLIC_SENTRY_DSN`. Sentry looked installed, the client
 * reported errors, and every server/edge error was silently dropped for weeks.
 *
 * If someone "tidies up" the fallback, these fail instead of the failure being
 * invisible until an incident nobody gets paged for.
 */

const initMock = vi.fn();
vi.mock("@sentry/nextjs", () => ({
  init: (...args: unknown[]) => initMock(...args),
}));

const ORIGINAL = { ...process.env };

async function loadConfig() {
  // The module inits as a side effect of import, so each case needs a fresh one.
  vi.resetModules();
  await import("./sentry.server.config");
}

describe("sentry.server.config DSN gating", () => {
  beforeEach(() => {
    initMock.mockClear();
    delete process.env.SENTRY_DSN;
    delete process.env.NEXT_PUBLIC_SENTRY_DSN;
  });

  afterEach(() => {
    process.env = { ...ORIGINAL };
  });

  it("does not initialize when no DSN is present", async () => {
    await loadConfig();
    expect(initMock).not.toHaveBeenCalled();
  });

  it("initializes from SENTRY_DSN when it is set", async () => {
    process.env.SENTRY_DSN = "https://abc@o1.ingest.sentry.io/1";
    await loadConfig();
    expect(initMock).toHaveBeenCalledTimes(1);
    expect(initMock.mock.calls[0][0]).toMatchObject({
      dsn: "https://abc@o1.ingest.sentry.io/1",
    });
  });

  it("falls back to NEXT_PUBLIC_SENTRY_DSN — the name Vercel's Sentry integration actually sets", async () => {
    process.env.NEXT_PUBLIC_SENTRY_DSN = "https://pub@o1.ingest.sentry.io/2";
    await loadConfig();
    expect(initMock).toHaveBeenCalledTimes(1);
    expect(initMock.mock.calls[0][0]).toMatchObject({
      dsn: "https://pub@o1.ingest.sentry.io/2",
    });
  });

  it("prefers SENTRY_DSN over the public one when both are set", async () => {
    process.env.SENTRY_DSN = "https://private@o1.ingest.sentry.io/1";
    process.env.NEXT_PUBLIC_SENTRY_DSN = "https://pub@o1.ingest.sentry.io/2";
    await loadConfig();
    expect(initMock.mock.calls[0][0]).toMatchObject({
      dsn: "https://private@o1.ingest.sentry.io/1",
    });
  });

  it("treats an empty-string DSN as absent", async () => {
    // Vercel returns "" for an unset-but-declared variable, which is not a
    // usable DSN — Sentry.init would throw on it.
    process.env.SENTRY_DSN = "";
    process.env.NEXT_PUBLIC_SENTRY_DSN = "";
    await loadConfig();
    expect(initMock).not.toHaveBeenCalled();
  });
});
