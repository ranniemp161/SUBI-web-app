/**
 * Getting a generated illustration onto a canvas (spec `broll/0008`).
 *
 * The sibling of `character-assets.ts`, and the same shape for the same reason:
 * the store is private, so an image is only readable through a short lived
 * signed URL. That fetch is authorized by the Clerk session, which exists on the
 * page and not inside a worker, so the page loads and decodes and then hands the
 * worker a decoded bitmap. The worker never sees a URL and never needs a session.
 *
 * **Keyed by scene, not by emotion.** A character cutout is shared by every
 * scene that picks that emotion; an illustration was generated for one scene and
 * belongs to nothing else. That is the whole difference between the two modules,
 * and it is why they are not one.
 *
 * One route call for the whole project rather than one per scene: the Neon HTTP
 * driver gives every statement its own round trip, and a twenty scene plan
 * asking twenty times is the shape this repo already has a convention against.
 */

/** One stored illustration, as the urls route reports it. */
export interface ObjectAsset {
  sceneId: string;
  url: string | null;
  expiresAt: string | null;
}

export interface ObjectAssetsResponse {
  assets: ObjectAsset[];
}

/** Whether a signed URL is still usable, with a little room for the round trip. */
export function isObjectAssetFresh(asset: ObjectAsset, now: number = Date.now()): boolean {
  if (!asset.expiresAt) return true;
  const expires = Date.parse(asset.expiresAt);
  if (Number.isNaN(expires)) return true;
  // Thirty seconds of slack, matching the character path: a URL that expires
  // mid decode is a failed render for no reason, and re-signing is cheap.
  return expires - now > 30_000;
}

/** Fetches the signed URLs for every illustration in a project. */
export async function fetchObjectAssets(projectId: string): Promise<ObjectAsset[]> {
  const response = await fetch(`/api/projects/${projectId}/objects/urls`);
  if (!response.ok) throw new Error("Couldn't load this project's illustrations.");
  const body = (await response.json()) as ObjectAssetsResponse;
  return Array.isArray(body.assets) ? body.assets : [];
}

/** Decodes one illustration into a bitmap ready to draw. */
export async function decodeObjectAsset(asset: ObjectAsset): Promise<ImageBitmap> {
  if (!asset.url) throw new Error(`No signed URL for scene ${asset.sceneId}.`);
  const response = await fetch(asset.url);
  if (!response.ok) throw new Error(`Couldn't download the illustration for scene ${asset.sceneId}.`);
  return createImageBitmap(await response.blob());
}

/**
 * Loads the illustrations for the scenes that have one.
 *
 * `wanted` is the set of scene ids the plan actually draws objects for, so a
 * project whose creator generated three illustrations and then restyled two of
 * those scenes to text downloads one image rather than three.
 */
export async function loadObjectBitmaps(
  projectId: string,
  wanted: Iterable<string>
): Promise<Map<string, ImageBitmap>> {
  const ids = new Set(Array.from(wanted).filter(Boolean));
  if (ids.size === 0) return new Map();

  const assets = (await fetchObjectAssets(projectId)).filter((asset) =>
    ids.has(asset.sceneId)
  );
  const loaded = new Map<string, ImageBitmap>();

  await Promise.all(
    assets.map(async (asset) => {
      if (!isObjectAssetFresh(asset)) return;
      try {
        loaded.set(asset.sceneId, await decodeObjectAsset(asset));
      } catch {
        // One illustration failing must not lose the others. That scene renders
        // without its object rather than the whole studio rendering nothing.
      }
    })
  );

  return loaded;
}
