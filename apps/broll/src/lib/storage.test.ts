import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@repo/server-shared/observability", () => ({ reportError: vi.fn() }));
vi.mock("@vercel/blob", () => ({
  del: vi.fn(),
  head: vi.fn(),
  issueSignedToken: vi.fn(),
  list: vi.fn(),
  presignUrl: vi.fn(),
}));

/**
 * `isStorageConfigured` is the gate the generate route asks **before** it
 * reserves a hold, so what it counts as "configured" decides whether a missing
 * credential costs the user nothing or costs them six paid Gemini images.
 *
 * The one credential that exists is the read write token. Spec `0004` also
 * lists `BLOB_WEBHOOK_PUBLIC_KEY`, but Vercel provisions no such variable, so
 * requiring it here would refuse the feature on every machine and every deploy
 * forever. `/api/blob/upload` supplies its own inert key instead.
 */

const ORIGINAL = {
  rw: process.env.BLOB_READ_WRITE_TOKEN,
  webhook: process.env.BLOB_WEBHOOK_PUBLIC_KEY,
};

function restore(
  name: "BLOB_READ_WRITE_TOKEN" | "BLOB_WEBHOOK_PUBLIC_KEY",
  value?: string
) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  restore("BLOB_READ_WRITE_TOKEN", ORIGINAL.rw);
  restore("BLOB_WEBHOOK_PUBLIC_KEY", ORIGINAL.webhook);
});

async function isConfigured(): Promise<boolean> {
  const { isStorageConfigured } = await import("@/lib/storage");
  return isStorageConfigured();
}

describe("isStorageConfigured", () => {
  it("is true with the read write token alone", async () => {
    // The load bearing case. Requiring a second, unobtainable variable here is
    // what turned "storage works" into a permanent 503.
    process.env.BLOB_READ_WRITE_TOKEN = "test-token-not-a-credential";
    delete process.env.BLOB_WEBHOOK_PUBLIC_KEY;
    expect(await isConfigured()).toBe(true);
  });

  it("is false without the read write token", async () => {
    delete process.env.BLOB_READ_WRITE_TOKEN;
    expect(await isConfigured()).toBe(false);
  });

  it("does not become false when a webhook key happens to be set", async () => {
    process.env.BLOB_READ_WRITE_TOKEN = "test-token-not-a-credential";
    process.env.BLOB_WEBHOOK_PUBLIC_KEY = "whatever";
    expect(await isConfigured()).toBe(true);
  });
});
