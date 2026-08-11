import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@repo/server-shared/observability", () => ({ reportError: vi.fn() }));

const state = vi.hoisted(() => ({
  clerkId: "user_clerk" as string | null,
  dbUser: { id: "user-db" } as { id: string } | null,
  project: { id: "p" } as Record<string, unknown> | null,
  configured: true,
}));

vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn(async () => ({ userId: state.clerkId })),
}));
vi.mock("@repo/server-shared/authz", () => ({
  getAuthorizedDbUser: vi.fn(async () => state.dbUser),
}));
vi.mock("@/lib/projects", () => ({
  getBrollProject: vi.fn(async () => state.project),
}));
vi.mock("@vercel/blob", () => ({ issueSignedToken: vi.fn(async () => "signed-token") }));
vi.mock("@vercel/blob/client", () => ({
  handleUploadPresigned: vi.fn(async () => ({
    type: "blob.generate-presigned-url",
    presignedUrlPayload: { url: "https://example.invalid/put" },
  })),
}));

import { handleUploadPresigned } from "@vercel/blob/client";
import { POST } from "./route";

/**
 * The presign route (spec `broll/0004` AC-17, AC-70).
 *
 * The case this file exists for: `handleUploadPresigned` refuses to run at all
 * without a webhook public key, throwing before it even reads the event type,
 * and **Vercel provisions no such variable**. The route therefore supplies its
 * own inert key. Without that, every upload in the pipeline answered 400 and the
 * failure landed in the browser after six images had already been paid for.
 */

const ORIGINAL_WEBHOOK_KEY = process.env.BLOB_WEBHOOK_PUBLIC_KEY;

function presignRequest() {
  return new Request("http://localhost:3003/api/blob/upload", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      type: "blob.generate-presigned-url",
      payload: {
        pathname: "broll/p/neutral-1-0123456789abcdef.png",
        multipart: false,
        clientPayload: null,
      },
    }),
  });
}

beforeEach(() => {
  state.clerkId = "user_clerk";
  state.dbUser = { id: "user-db" };
  state.project = { id: "p" };
  state.configured = true;
  process.env.BLOB_READ_WRITE_TOKEN = "vercel_blob_rw_ABC123_secret";
  vi.clearAllMocks();
});

afterEach(() => {
  if (ORIGINAL_WEBHOOK_KEY === undefined) delete process.env.BLOB_WEBHOOK_PUBLIC_KEY;
  else process.env.BLOB_WEBHOOK_PUBLIC_KEY = ORIGINAL_WEBHOOK_KEY;
});

describe("the webhook key the SDK demands and never uses", () => {
  it("always hands the SDK a key, even with the env var unset", async () => {
    delete process.env.BLOB_WEBHOOK_PUBLIC_KEY;

    const response = await POST(presignRequest());
    expect(response.status).toBe(200);

    const passed = vi.mocked(handleUploadPresigned).mock.calls[0][0];
    // Non empty is the whole requirement: the SDK only checks presence before
    // the event type, and the value is never read on this route's one path.
    expect(typeof passed.webhookPublicKey).toBe("string");
    expect(passed.webhookPublicKey).toBeTruthy();
  });

  it("prefers a real key when the environment does provide one", async () => {
    process.env.BLOB_WEBHOOK_PUBLIC_KEY = "a-real-key";

    await POST(presignRequest());

    const passed = vi.mocked(handleUploadPresigned).mock.calls[0][0];
    expect(passed.webhookPublicKey).toBe("a-real-key");
  });

  it("registers no completion callback, which is what keeps the key inert", async () => {
    await POST(presignRequest());

    const passed = vi.mocked(handleUploadPresigned).mock.calls[0][0];
    expect(passed.onUploadCompleted).toBeUndefined();
  });

  it("rejects a completion callback outright, without reaching the SDK", async () => {
    // Nothing legitimate sends this: no callback URL is ever registered, so
    // such an event is a mistake or forged.
    const response = await POST(
      new Request("http://localhost:3003/api/blob/upload", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          type: "blob.upload-completed",
          payload: { blob: {}, tokenPayload: null },
        }),
      })
    );

    expect(response.status).toBe(400);
    expect(handleUploadPresigned).not.toHaveBeenCalled();
  });
});

describe("the gates", () => {
  it("503s when the read write token is missing", async () => {
    delete process.env.BLOB_READ_WRITE_TOKEN;
    const response = await POST(presignRequest());
    expect(response.status).toBe(503);
    expect(handleUploadPresigned).not.toHaveBeenCalled();
  });

  it("400s a body that is not JSON", async () => {
    const response = await POST(
      new Request("http://localhost:3003/api/blob/upload", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "not json",
      })
    );
    expect(response.status).toBe(400);
    expect(handleUploadPresigned).not.toHaveBeenCalled();
  });
});
