import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { issueSignedToken } from "@vercel/blob";
import {
  handleUploadPresigned,
  type HandleUploadPresignedBody,
} from "@vercel/blob/client";
import { getAuthorizedDbUser } from "@repo/server-shared/authz";
import { reportError } from "@repo/server-shared/observability";
import {
  isCharacterAssetPathname,
  characterIdFromAssetPathname,
  isObjectAssetPathname,
  sceneIdFromObjectAssetPathname,
} from "@/lib/asset-path";
import {
  ASSET_CONTENT_TYPE,
  MAX_ASSET_BYTES,
  isStorageConfigured,
} from "@/lib/storage";
import { getBrollCharacter } from "@/lib/characters";
import { getObjectSceneContext } from "@/lib/scenes";

/**
 * `POST /api/blob/upload` — hand the browser a presigned PUT for exactly one
 * generated asset, so the finished PNG goes straight to storage and never
 * crosses a Function (spec `broll/0004` AC-17).
 *
 * Two kinds of asset take this path: a **character** variant, owned by a
 * character, and an **object** illustration, owned by a scene (spec
 * `broll/0008`). They are told apart by their pathname prefix and authorized
 * through different tables, in `authorizePathname` below.
 *
 * **The authorization lives inside `getSignedToken`, and that is the whole
 * security of this route.** Without it this is an anonymous write endpoint into
 * the store. The SDK calls that function with the pathname the client asked for,
 * which means the pathname is untrusted input here even though the generate
 * route minted it: nothing stops a client sending a different one. So it is
 * re-derived and re-checked (AC-70).
 *
 * Three things must all hold before a URL is signed:
 *
 * 1. There is a signed in user with a provisioned `users` row.
 * 2. The pathname is a well formed character asset path, which is what makes
 *    traversal impossible rather than filtered.
 * 3. That path's **character** belongs to this user, checked by an owner scoped
 *    query rather than by trusting the id in the string.
 *
 * Point 3 is the load bearing change of spec `broll/0007`: the pathname names a
 * character now, so the id it yields is looked up in `broll_characters` rather
 * than `broll_projects`. The property that had to survive is unchanged, and it
 * is the reason the two checks are in this order — a malformed path must yield
 * no id at all, so there is nothing to look up, and a well formed one must still
 * be proven to belong to the caller.
 */

/** A presigned PUT is short lived; the browser uses it within seconds of asking. */
const UPLOAD_URL_TTL_MS = 10 * 60 * 1000;

/**
 * A webhook public key this route supplies so the SDK will run, and never uses.
 *
 * `handleUploadPresigned` throws `Missing webhook public key` as its **first**
 * statement, before it reads the event type, so a plain presign request dies
 * without one (`@vercel/blob@2.7.0`). The key itself is used in exactly one
 * place: verifying the Ed25519 signature on a `blob.upload-completed` callback.
 *
 * **No such callback can reach this route.** A callback URL is registered with
 * the Blob API only when `onUploadCompleted` is passed, which this route does
 * not do, so Vercel is never told anywhere to send one. The `POST` below then
 * rejects that event type outright, which turns "no callback exists" from an
 * accident of configuration into a property of this file.
 *
 * So the value is inert, and it has to come from somewhere. Spec `0004` says
 * `BLOB_WEBHOOK_PUBLIC_KEY`, but **Vercel does not provision that variable**:
 * measured 2026-08-11, Ruff Cut has had a store connected for a month and its
 * project holds only `BLOB_READ_WRITE_TOKEN`. Reading it from the environment
 * would gate uploads on a value nobody can obtain. The env var still wins if it
 * is ever set, so the day Vercel does issue one, nothing here has to change.
 *
 * Never pass `onUploadCompleted` in this route without replacing this with a
 * real key. Doing so would register a callback URL that accepts anything.
 */
const INERT_WEBHOOK_KEY =
  "-----BEGIN PUBLIC KEY-----unused-----END PUBLIC KEY-----";

/**
 * Prove that this user may write to this pathname, or throw.
 *
 * **Throws rather than returning a boolean, on purpose.** A caller that forgets
 * to check a returned `false` signs a URL anyway; a caller that forgets to await
 * a throwing function fails its own lint. On the one path in the app where
 * getting this wrong means an anonymous write into the store, the failure mode
 * of the signature is worth choosing deliberately.
 *
 * Each branch ends in an **owner scoped query**, never in trusting the id the
 * string carried. Someone else's character or scene is indistinguishable from a
 * missing one here, so this both authorizes and avoids confirming that an id
 * exists.
 */
async function authorizePathname(pathname: string, userId: string): Promise<void> {
  const characterId = characterIdFromAssetPathname(pathname);
  if (characterId) {
    if (!isCharacterAssetPathname(pathname, characterId)) throw new Error("Not authorized");
    const character = await getBrollCharacter(userId, characterId);
    if (!character) throw new Error("Not authorized");
    return;
  }

  // An object illustration belongs to a scene, and a scene belongs to a project,
  // which is where the `user_id` actually lives (spec `broll/0008`).
  const sceneId = sceneIdFromObjectAssetPathname(pathname);
  if (sceneId) {
    if (!isObjectAssetPathname(pathname, sceneId)) throw new Error("Not authorized");
    const scene = await getObjectSceneContext(userId, sceneId);
    if (!scene) throw new Error("Not authorized");
    return;
  }

  throw new Error("Not authorized");
}

export async function POST(request: Request): Promise<NextResponse> {
  if (!isStorageConfigured()) {
    return NextResponse.json(
      { error: "Storage isn't configured on this server." },
      { status: 503 }
    );
  }

  let body: HandleUploadPresignedBody;
  try {
    body = (await request.json()) as HandleUploadPresignedBody;
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  // This route issues presigned URLs and nothing else. It registers no
  // completion callback, so a completion event is either a mistake or forged;
  // either way there is nothing here for it to do.
  if (body.type === "blob.upload-completed") {
    return NextResponse.json(
      { error: "This route does not accept upload callbacks." },
      { status: 400 }
    );
  }

  try {
    const result = await handleUploadPresigned({
      body,
      request,
      webhookPublicKey: process.env.BLOB_WEBHOOK_PUBLIC_KEY ?? INERT_WEBHOOK_KEY,
      getSignedToken: async (pathname) => {
        const { userId: clerkId } = await auth();
        if (!clerkId) throw new Error("Not authorized");

        const user = await getAuthorizedDbUser(clerkId);
        if (!user) throw new Error("Not authorized");

        // Two shapes, and the pathname decides which. Each is recognised only
        // by its own literal prefix segment, so neither can be reached through
        // the other's check — see `asset-path.ts`.
        //
        // In both cases the id comes out of the pathname first and the pathname
        // is then validated against it. Doing it in that order means a malformed
        // path cannot yield an id at all, so there is nothing to look up. An old
        // project shaped path yields nothing from either, which is what makes
        // the clean break structural rather than a convention.
        await authorizePathname(pathname, user.id);

        const token = await issueSignedToken({
          // Scoped to this one pathname, unlike the read delegation in
          // `storage.ts`: this flow does involve the client, so a wildcard
          // would be a signing key for the whole store.
          pathname,
          operations: ["put"],
          allowedContentTypes: [ASSET_CONTENT_TYPE],
          maximumSizeInBytes: MAX_ASSET_BYTES,
          validUntil: Date.now() + UPLOAD_URL_TTL_MS,
        });

        return {
          token,
          urlOptions: {
            allowedContentTypes: [ASSET_CONTENT_TYPE],
            maximumSizeInBytes: MAX_ASSET_BYTES,
            // The pathname already carries a random element and a fresh
            // `attempt`, so a suffix would only make the stored key disagree
            // with the one the generate route streamed to the browser.
            addRandomSuffix: false,
            // A replacement is always a new pathname (AC-69), so a collision
            // here means something is wrong and should fail rather than
            // silently overwrite.
            allowOverwrite: false,
          },
        };
      },
    });

    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message === "Not authorized") {
      return NextResponse.json({ error: "Not authorized" }, { status: 401 });
    }
    reportError("Failed to presign a b-roll asset upload", error);
    return NextResponse.json({ error: "Could not start the upload." }, { status: 400 });
  }
}
