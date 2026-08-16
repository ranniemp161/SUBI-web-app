/**
 * Where a character asset lives in the blob store, and the only place that
 * decides it (spec `broll/0004` AC-70, spec `broll/0007` AC-141).
 *
 * Pure and dependency free on purpose, the same reason `styles.ts` and
 * `emotions.ts` are, and the same precedent `apps/rough-cut/src/lib/blob-path.ts`
 * set: two server routes and their tests all need this, and none of them should
 * have to pull the storage client in to ask what a pathname looks like.
 *
 * **A pathname is a server value, never a client one.** The generate route mints
 * one per turn and sends it down the stream; the browser uploads to exactly that
 * pathname and cannot pick its own. Both the upload route and the commit route
 * re-check the result here before it becomes a `broll_assets.r2_key`. Two checks
 * for one property is deliberate: without them a client supplied string would
 * become a stored key, and a stored key pointing at another user's object is a
 * cross user read that no amount of query scoping would catch.
 *
 * **The path names a character, not a project** (spec `broll/0007`). The images
 * belong to a reusable character that several projects may point at, so the
 * prefix and the ownership question moved one level over with them. The old
 * project shaped path, `broll/<projectId>/<emotion>-…`, matches nothing here and
 * is never accepted: `asset-path.test.ts` keeps one as an explicit rejection
 * case, because the two shapes look alike enough to be confused by a reader
 * skimming the regular expressions.
 */

/** Every object for one character lives under this prefix, and nothing else does. */
export function characterAssetPrefix(characterId: string): string {
  return `broll/characters/${characterId}/`;
}

/**
 * The shape of everything after the prefix: `<emotion>-<attempt>-<random>.png`.
 *
 * Deliberately strict. It admits no slash and no dot other than the extension's,
 * which is what makes path traversal (`../`) structurally impossible rather than
 * merely filtered. Anything that does not match this exactly is rejected, so a
 * new pathname shape has to be added here on purpose.
 *
 * The emotion is matched as lowercase letters rather than against
 * `CHARACTER_EMOTIONS`. That keeps this module independent of the emotion list:
 * the routes validate membership themselves, and a stored path stays valid if
 * the set ever grows. Validating membership here would silently invalidate
 * every existing object the day a seventh emotion shipped.
 */
const ASSET_TAIL = /^[a-z]+-[0-9]+-[0-9a-f]{16}\.png$/;

/**
 * 64 bits of randomness, so knowing a character id does not yield a key.
 *
 * The store is private and every read is a signed URL, so this is defence in
 * depth rather than the only lock. It exists because `broll_assets.r2_key` is
 * stored rather than derived precisely so it can carry a random element (spec
 * `broll/0002`), and a derivable key would throw that away.
 *
 * `crypto.getRandomValues` is present in the Edge runtime, in Node 18 and up,
 * and in browsers, which is why this module can stay dependency free.
 */
function randomSuffix(): string {
  const bytes = new Uint8Array(8);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Mint the pathname for one character asset.
 *
 * A regeneration passes the next `attempt` and gets a **new** path, never the
 * old one: Vercel's CDN caches blobs for up to a month and an overwrite takes up
 * to sixty seconds to propagate, so writing in place would serve the user back
 * the very cutout they just rejected (AC-69).
 *
 * `random` is injectable so tests can assert the exact shape without stubbing
 * global crypto.
 */
export function characterAssetPathname(
  characterId: string,
  emotion: string,
  attempt: number,
  random: string = randomSuffix()
): string {
  return `${characterAssetPrefix(characterId)}${emotion}-${attempt}-${random}.png`;
}

/**
 * True only if `pathname` is a character asset belonging to `characterId`.
 *
 * `characterId` must already be a character the caller was proven to own (the
 * routes resolve it through `getBrollCharacter`, which scopes by `user_id`).
 * Given that, a true here means the object is this user's to write or to
 * reference.
 */
export function isCharacterAssetPathname(
  pathname: string,
  characterId: string
): boolean {
  const prefix = characterAssetPrefix(characterId);
  if (!pathname.startsWith(prefix)) return false;
  return ASSET_TAIL.test(pathname.slice(prefix.length));
}

/**
 * Recover the owning character id from a pathname, so a route handed only a
 * pathname (the presigned upload callback) can look the character up and check
 * ownership before it signs anything.
 *
 * Returns null unless the whole pathname is a well formed character asset path,
 * so a caller can never get an id back out of a string this module would reject.
 * The `characters/` segment is matched literally, which is what makes an old
 * project shaped path yield no id at all rather than yielding a project id that
 * would then be looked up in the wrong table.
 */
export function characterIdFromAssetPathname(pathname: string): string | null {
  const match = pathname.match(/^broll\/characters\/([^/]+)\/(.+)$/);
  if (!match) return null;
  const [, characterId, tail] = match;
  if (!ASSET_TAIL.test(tail)) return null;
  return characterId;
}
