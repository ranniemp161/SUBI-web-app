import { describe, it, expect, afterEach, vi } from "vitest";

const ORIGINAL_TOKEN = process.env.BLOB_READ_WRITE_TOKEN;

async function freshIsOwnBlobUrl() {
  // The expected hostname is derived once at module load from
  // BLOB_READ_WRITE_TOKEN, so each test needs its own module instance.
  vi.resetModules();
  return (await import("./blob")).isOwnBlobUrl;
}

describe("isOwnBlobUrl", () => {
  afterEach(() => {
    if (ORIGINAL_TOKEN === undefined) delete process.env.BLOB_READ_WRITE_TOKEN;
    else process.env.BLOB_READ_WRITE_TOKEN = ORIGINAL_TOKEN;
  });

  it("pins to the exact store hostname when the token parses", async () => {
    process.env.BLOB_READ_WRITE_TOKEN = "vercel_blob_rw_ABC123_supersecret";
    const isOwnBlobUrl = await freshIsOwnBlobUrl();

    expect(isOwnBlobUrl("https://abc123.public.blob.vercel-storage.com/projects/x/a.m4a")).toBe(true);
    // A different, equally valid-looking Vercel Blob store — rejected once pinned.
    expect(isOwnBlobUrl("https://someoneelse.public.blob.vercel-storage.com/a.m4a")).toBe(false);
  });

  it("falls back to a domain-suffix check when the token doesn't parse", async () => {
    delete process.env.BLOB_READ_WRITE_TOKEN;
    const isOwnBlobUrl = await freshIsOwnBlobUrl();

    expect(isOwnBlobUrl("https://anything.public.blob.vercel-storage.com/a.m4a")).toBe(true);
  });

  it("rejects arbitrary external URLs (SSRF guard) regardless of token state", async () => {
    process.env.BLOB_READ_WRITE_TOKEN = "vercel_blob_rw_ABC123_supersecret";
    const isOwnBlobUrl = await freshIsOwnBlobUrl();

    expect(isOwnBlobUrl("https://evil.example.com/steal-our-quota")).toBe(false);
    expect(isOwnBlobUrl("http://169.254.169.254/latest/meta-data")).toBe(false);
    expect(isOwnBlobUrl("not-a-url")).toBe(false);
  });
});
