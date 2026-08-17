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

/**
 * Object illustrations (spec `broll/0008`), which live under their own prefix
 * and are owned by a **scene** rather than by a character.
 *
 * A separate prefix rather than a fifth field in the character shape, and the
 * `objects/` segment is matched literally for exactly the reason `characters/`
 * is: the two shapes look alike enough to be confused by a reader skimming the
 * regular expressions, and confusing them is a cross user read. A character path
 * yields no scene id here and an object path yields no character id there —
 * `asset-path.test.ts` keeps one of each as an explicit rejection case.
 *
 * Ownership runs `broll_scenes → broll_projects.user_id`, which is the chain the
 * scene PATCH route already proves inside its own statement.
 */
export function objectAssetPrefix(sceneId: string): string {
  return `broll/objects/${sceneId}/`;
}

/**
 * The shape of everything after the prefix: `<attempt>-<random>.png`.
 *
 * No leading name segment, because unlike a character variant there is nothing
 * to name: a scene has one illustration at a time, and the attempt number is
 * what distinguishes this one from the one it replaced. As strict as its
 * sibling — no slash, no dot but the extension's — so traversal is impossible by
 * construction rather than filtered.
 */
const OBJECT_TAIL = /^[0-9]+-[0-9a-f]{16}\.png$/;

/**
 * Mint the pathname for one scene's illustration.
 *
 * A regeneration passes the next `attempt` and gets a **new** path, never the
 * old one: Vercel's CDN caches blobs for up to a month and an overwrite takes up
 * to sixty seconds to propagate, so writing in place would serve the creator
 * back the very illustration they just paid to replace.
 */
export function objectAssetPathname(
  sceneId: string,
  attempt: number,
  random: string = randomSuffix()
): string {
  return `${objectAssetPrefix(sceneId)}${attempt}-${random}.png`;
}

/** True only if `pathname` is an illustration belonging to `sceneId`. */
export function isObjectAssetPathname(pathname: string, sceneId: string): boolean {
  const prefix = objectAssetPrefix(sceneId);
  if (!pathname.startsWith(prefix)) return false;
  return OBJECT_TAIL.test(pathname.slice(prefix.length));
}

/**
 * True only if `pathname` is the illustration this scene's given attempt would
 * have produced — the check the commit route needs.
 *
 * Stricter than well-formedness on purpose. A path that is valid for a *different*
 * attempt is a stale upload from a request that lost a race, and pointing the row
 * at it would show the creator an illustration they had already replaced. The
 * random tail is deliberately not checked: it is the part the generate route
 * chose and the client is simply handing back.
 */
export function isObjectAssetPathnameForAttempt(
  pathname: string,
  sceneId: string,
  attempt: number
): boolean {
  if (!isObjectAssetPathname(pathname, sceneId)) return false;
  const tail = pathname.slice(objectAssetPrefix(sceneId).length);
  return tail.startsWith(`${attempt}-`);
}

/**
 * Recover the owning scene id from a pathname, so the presigned upload route can
 * look the scene up and prove ownership before it signs anything.
 *
 * Returns null unless the whole pathname is a well formed illustration path, so
 * a caller can never get an id back out of a string this module would reject.
 */
export function sceneIdFromObjectAssetPathname(pathname: string): string | null {
  const match = pathname.match(/^broll\/objects\/([^/]+)\/(.+)$/);
  if (!match) return null;
  const [, sceneId, tail] = match;
  if (!OBJECT_TAIL.test(tail)) return null;
  return sceneId;
}
