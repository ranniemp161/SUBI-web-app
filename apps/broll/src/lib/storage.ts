import "server-only";
import {
  del,
  head,
  issueSignedToken,
  list,
  presignUrl,
  type IssuedSignedToken,
} from "@vercel/blob";
import { reportError } from "@repo/server-shared/observability";
import { characterAssetPrefix } from "@/lib/asset-path";

/**
 * The character asset storage seam (spec `broll/0004`).
 *
 * **App local on purpose**, not in `packages/server-shared` (spec `0001` §5.3):
 * Ruff Cut's blob use is ephemeral audio swept by a cron, b-roll's is permanent
 * PNGs read by signed URL. Different lifecycles, different interfaces. Hoisting
 * a shared abstraction from one real implementation and one imagined one is
 * speculative.
 *
 * **The vendor here is temporary.** Spec `0001` §5.3 chose Cloudflare R2 and its
 * reasoning still holds; Vercel Blob is a deliberate, recorded deviation pending
 * a conversation with the client. Everything vendor specific is inside this
 * file so that conversation resolves into a one file change. The risk being
 * carried meanwhile: Hobby has no overage, exceeding the limit blocks Blob for
 * thirty days, and Ruff Cut's audio uploads share that allowance.
 *
 * **The store must be created with `access: 'private'`, and that cannot be
 * changed afterwards.** A public store hands out permanent unguessable URLs; a
 * private one requires a signature on every read, which is what makes the one
 * hour expiry below mean anything.
 */

/** Every read URL this app mints is a private store URL. */
const ACCESS = "private" as const;

/**
 * How long a signed read URL lives (spec `broll/0004`).
 *
 * One hour comfortably outlasts a Scene Studio session and a batch export, so a
 * URL never expires in the middle of the work, while a leaked link is stale
 * within the hour. It is also the SDK's own default for a delegation, so the
 * per URL expiry never has to be capped down to something shorter.
 */
export const READ_URL_TTL_MS = 60 * 60 * 1000;

/** Only PNG is ever stored: no JPEG intermediate exists anywhere (AC-19). */
export const ASSET_CONTENT_TYPE = "image/png";

/**
 * Ceiling on a single uploaded cutout, enforced by the CDN rather than by us.
 *
 * A trimmed 1K portrait PNG with alpha runs around one to two megabytes, so
 * eight is generous headroom rather than a real constraint. It exists to bound
 * what a presigned PUT can write, since the browser controls the request body.
 */
export const MAX_ASSET_BYTES = 8 * 1024 * 1024;

/**
 * One credential, because one is all that exists.
 *
 * Spec `0004` also lists `BLOB_WEBHOOK_PUBLIC_KEY` as required configuration.
 * **Vercel does not provision it.** Measured on 2026-08-11: Ruff Cut's project
 * has had a Blob store connected for a month and holds exactly one blob
 * variable, `BLOB_READ_WRITE_TOKEN`, and `vercel blob get-store` exposes no key
 * either. Requiring it here would gate the feature on a value nobody can
 * obtain. `/api/blob/upload` supplies its own inert key instead, and says why.
 */
export function isStorageConfigured(): boolean {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN);
}

/**
 * A cached whole store delegation, used **only** on the server to sign reads.
 *
 * `issueSignedToken` is a network call to the Blob control API while
 * `presignUrl` is pure HMAC, so caching the delegation turns "six round trips
 * every time a review gate loads" into "one round trip an hour". The SDK's own
 * docs recommend exactly this.
 *
 * The `*` scope is safe here and would not be safe if this token ever reached a
 * browser: whoever holds `clientSigningToken` can sign any pathname in the
 * store. It never leaves the server. The browser only ever receives a finished
 * URL, already scoped to one pathname and one operation. Uploads take the
 * opposite approach and scope their delegation to a single pathname, because
 * that flow does involve the client.
 *
 * Module scope means per instance, which is what we want: a cold start pays for
 * one token and every request on that instance reuses it.
 */
let readDelegation: IssuedSignedToken | null = null;

/** Re-issue a minute before expiry so a URL is never signed with a dead key. */
const RENEW_MARGIN_MS = 60 * 1000;

async function readToken(): Promise<IssuedSignedToken> {
  const now = Date.now();
  if (readDelegation && readDelegation.validUntil - RENEW_MARGIN_MS > now) {
    return readDelegation;
  }
  readDelegation = await issueSignedToken({
    pathname: "*",
    operations: ["get"],
    validUntil: now + READ_URL_TTL_MS,
  });
  return readDelegation;
}

export type SignedAssetUrl = {
  pathname: string;
  url: string;
  expiresAt: number;
};

/**
 * Signed GET URLs the browser fetches **directly** from the blob host (AC-17).
 *
 * This is the whole reason the store is private rather than served through a
 * route: Vercel's documented alternative for a private blob is delivery through
 * a Function via `get()`, which would put image bytes back in the data path on
 * every review gate and Scene Studio load.
 */
export async function presignAssetReads(
  pathnames: string[]
): Promise<SignedAssetUrl[]> {
  if (pathnames.length === 0) return [];
  const token = await readToken();
  const expiresAt = Math.min(token.validUntil, Date.now() + READ_URL_TTL_MS);

  return Promise.all(
    pathnames.map(async (pathname) => {
      const { presignedUrl } = await presignUrl(token, {
        operation: "get",
        pathname,
        access: ACCESS,
        validUntil: expiresAt,
      });
      return { pathname, url: presignedUrl, expiresAt };
    })
  );
}

/**
 * A signed GET the **server** uses to read a stored asset back, which is how a
 * regeneration anchors on the stored `neutral` cutout without the original
 * photograph (which is never kept, AC-22).
 *
 * `useCache: false` because this read must reflect the latest write: a
 * regeneration that anchored on a cached, superseded image would quietly chain
 * off the picture the user already rejected.
 */
export async function fetchAssetBytes(pathname: string): Promise<ArrayBuffer> {
  const token = await readToken();
  const { presignedUrl } = await presignUrl(token, {
    operation: "get",
    pathname,
    access: ACCESS,
    useCache: false,
  });
  const response = await fetch(presignedUrl);
  if (!response.ok) {
    throw new Error(`Could not read stored asset (${response.status})`);
  }
  return response.arrayBuffer();
}

/**
 * The stored object's real size, read server side rather than believed from the
 * client (spec `broll/0004`, the Value sourcing table).
 *
 * The browser reports the trimmed width and height because only it knows them,
 * but the byte size is checkable and so it is checked. Returns null when the
 * object is not there, which is how commit tells "uploaded" from "claimed to
 * have uploaded".
 */
export async function assetByteSize(pathname: string): Promise<number | null> {
  try {
    const meta = await head(pathname);
    return meta.size;
  } catch {
    return null;
  }
}

/** Remove one superseded object. Called only after its replacement row is written (AC-69). */
export async function deleteAsset(pathname: string): Promise<void> {
  await del(pathname);
}

/** Best effort delete: a storage hiccup must never mask a generated set. */
export async function deleteAssetQuietly(pathname: string): Promise<void> {
  try {
    await deleteAsset(pathname);
  } catch (error) {
    reportError("Failed to delete b-roll character asset", error, { pathname });
  }
}

/**
 * Every object currently stored under a character, for the orphan sweep (AC-73,
 * spec `broll/0007` AC-144).
 *
 * A run that uploads four of six cutouts and is then abandoned leaves objects no
 * row references. On a plan whose failure mode is a thirty day lockout, letting
 * those accumulate is not a tidiness problem.
 *
 * Scoped to the character rather than the project, because that is what the
 * prefix names now. A per run sweep that still listed a project prefix would
 * find nothing at all and quietly stop collecting anything.
 */
export async function listCharacterAssetPathnames(
  characterId: string
): Promise<string[]> {
  const prefix = characterAssetPrefix(characterId);
  const found: string[] = [];
  let cursor: string | undefined;

  do {
    const page = await list({ prefix, cursor, limit: 1000 });
    for (const blob of page.blobs) found.push(blob.pathname);
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);

  return found;
}

/**
 * Delete every object under this character that no row claims.
 *
 * Takes the referenced set rather than reading the database itself, so this file
 * stays a storage seam and the caller keeps ownership of what "referenced"
 * means. Best effort per object: one stubborn delete must not abandon the rest.
 */
export async function sweepOrphanedAssets(
  characterId: string,
  referenced: Iterable<string>
): Promise<number> {
  const keep = new Set(referenced);
  const stored = await listCharacterAssetPathnames(characterId);
  const orphans = stored.filter((pathname) => !keep.has(pathname));

  for (const pathname of orphans) await deleteAssetQuietly(pathname);
  return orphans.length;
}
