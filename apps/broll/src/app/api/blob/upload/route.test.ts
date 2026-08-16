import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@repo/server-shared/observability", () => ({ reportError: vi.fn() }));

const CHARACTER_ID = "33333333-3333-3333-3333-333333333333";
const OTHER_CHARACTER_ID = "44444444-4444-4444-4444-444444444444";
const ASSET_PATH = `broll/characters/${CHARACTER_ID}/neutral-1-0123456789abcdef.png`;

// The literal id is repeated rather than referenced: `vi.hoisted` runs before
// the consts above are initialised, so naming one here is a temporal dead zone
// error rather than a tidier test.
const state = vi.hoisted(() => ({
  clerkId: "user_clerk" as string | null,
  dbUser: { id: "user-db" } as { id: string } | null,
  character: { id: "33333333-3333-3333-3333-333333333333" } as Record<
    string,
    unknown
  > | null,
  configured: true,
}));

vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn(async () => ({ userId: state.clerkId })),
}));
vi.mock("@repo/server-shared/authz", () => ({
  getAuthorizedDbUser: vi.fn(async () => state.dbUser),
}));
vi.mock("@/lib/characters", () => ({
  getBrollCharacter: vi.fn(async () => state.character),
}));
vi.mock("@vercel/blob", () => ({ issueSignedToken: vi.fn(async () => "signed-token") }));
vi.mock("@vercel/blob/client", () => ({
  handleUploadPresigned: vi.fn(async () => ({
    type: "blob.generate-presigned-url",
    presignedUrlPayload: { url: "https://example.invalid/put" },
  })),
}));

import { handleUploadPresigned } from "@vercel/blob/client";
import { issueSignedToken } from "@vercel/blob";
import { getBrollCharacter } from "@/lib/characters";
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
        pathname: ASSET_PATH,
        multipart: false,
        clientPayload: null,
      },
    }),
  });
}

beforeEach(() => {
  state.clerkId = "user_clerk";
  state.dbUser = { id: "user-db" };
  state.character = { id: CHARACTER_ID };
  state.configured = true;
  process.env.BLOB_READ_WRITE_TOKEN = "test-token-not-a-credential";
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

/**
 * The authorization inside `getSignedToken`, which `apps/broll/AGENTS.md` calls
 * the whole security of this route.
 *
 * The SDK is mocked, so the callback the route hands it is never invoked by the
 * request itself. These tests pull it back out of the mock and call it directly,
 * which is the only way to exercise it at all. Without this block the one thing
 * that stops this being an anonymous write endpoint into the store has no test.
 *
 * Spec `broll/0007` moved this check one level over, from the project in the
 * pathname to the character in it, which is exactly the kind of change that
 * looks safe and is not (AC-142).
 */
describe("the authorization inside getSignedToken (AC-142)", () => {
  async function signedTokenFor(pathname: string) {
    await POST(presignRequest());
    const passed = vi.mocked(handleUploadPresigned).mock.calls[0][0];
    // The SDK passes the client payload and the multipart flag alongside the
    // pathname. Neither is read by this route: the pathname is the whole of its
    // authorization, which is the property these tests are here to pin.
    return passed.getSignedToken(pathname, null, false);
  }

  it("signs a well formed path whose character belongs to the caller", async () => {
    const result = await signedTokenFor(ASSET_PATH);
    expect(result).toMatchObject({ token: "signed-token" });
  });

  it("scopes the signature to that one pathname, never the whole store", async () => {
    // Unlike the read delegation in `storage.ts`, this flow does involve the
    // client, so a wildcard here would be a signing key for every object.
    await signedTokenFor(ASSET_PATH);
    expect(vi.mocked(issueSignedToken).mock.calls[0][0]).toMatchObject({
      pathname: ASSET_PATH,
      operations: ["put"],
    });
  });

  it("refuses a path naming a character the caller does not own", async () => {
    // The owner scoped read answers null for someone else's character exactly
    // as it does for a missing one, so this is the cross user write refused.
    state.character = null;
    await expect(
      signedTokenFor(
        `broll/characters/${OTHER_CHARACTER_ID}/neutral-1-0123456789abcdef.png`
      )
    ).rejects.toThrow("Not authorized");
    expect(issueSignedToken).not.toHaveBeenCalled();
  });

  it("refuses without ever looking up an id when the path is malformed", async () => {
    // The order is load bearing: a malformed path must yield no id at all, so
    // there is nothing to look up. Traversal is impossible by construction here
    // rather than filtered.
    for (const pathname of [
      `broll/characters/${CHARACTER_ID}/../${OTHER_CHARACTER_ID}/neutral-1-0123456789abcdef.png`,
      `broll/characters/${CHARACTER_ID}/nested/neutral-1-0123456789abcdef.png`,
      `broll/characters/${CHARACTER_ID}/neutral-1-0123456789abcdef.jpg`,
      "broll/characters/",
      "not-a-path",
      "",
    ]) {
      vi.mocked(getBrollCharacter).mockClear();
      await expect(signedTokenFor(pathname)).rejects.toThrow("Not authorized");
      expect(getBrollCharacter).not.toHaveBeenCalled();
      vi.mocked(handleUploadPresigned).mockClear();
    }
  });

  it("refuses the old project shaped path, yielding no id to look up (AC-141)", async () => {
    // `broll/<id>/<emotion>-…` was a valid pathname before spec `broll/0007`.
    // It must now fail at the shape check, before any lookup, so the id in it
    // is never checked against the wrong table.
    await expect(
      signedTokenFor(`broll/${CHARACTER_ID}/neutral-1-0123456789abcdef.png`)
    ).rejects.toThrow("Not authorized");
    expect(getBrollCharacter).not.toHaveBeenCalled();
  });

  it("refuses without a session, before any pathname is even parsed", async () => {
    state.clerkId = null;
    await expect(signedTokenFor(ASSET_PATH)).rejects.toThrow("Not authorized");
    expect(getBrollCharacter).not.toHaveBeenCalled();
  });

  it("refuses a signed in user with no provisioned row", async () => {
    state.dbUser = null;
    await expect(signedTokenFor(ASSET_PATH)).rejects.toThrow("Not authorized");
    expect(getBrollCharacter).not.toHaveBeenCalled();
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
