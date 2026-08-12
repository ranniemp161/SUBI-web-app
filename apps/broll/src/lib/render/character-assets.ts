import type { CharacterEmotion } from "@/lib/emotions";

/**
 * Getting a character cutout onto a canvas.
 *
 * The store is private, so an image is only readable through a short lived
 * signed URL minted by `GET /api/projects/:id/character/urls`. That fetch is
 * authorized by the Clerk session, which exists on the page and not inside a
 * worker, so the page loads and decodes, then hands the worker a decoded
 * bitmap. The worker never sees a URL and never needs a session.
 *
 * The picking and the shaping live here as pure functions so they can be
 * tested; only `loadCharacterBitmaps` touches the network.
 */

/** One stored variant, as the urls route reports it. */
export interface CharacterAsset {
  emotion: string;
  width: number;
  height: number;
  attempt: number;
  url: string | null;
  expiresAt: string | null;
}

export interface CharacterAssetsResponse {
  assets: CharacterAsset[];
}

/**
 * The asset to draw for an emotion.
 *
 * Regeneration bumps `attempt` in place, so if more than one row ever comes
 * back for an emotion the highest attempt is the current one. An asset whose
 * URL failed to sign is unusable and is skipped rather than returned with a
 * null URL for the caller to trip over.
 */
export function pickAssetForEmotion(
  assets: CharacterAsset[],
  emotion: string | null
): CharacterAsset | null {
  if (!emotion) return null;

  const candidates = assets.filter(
    (asset) => asset.emotion === emotion && typeof asset.url === "string" && asset.url !== ""
  );
  if (candidates.length === 0) return null;

  return candidates.reduce((best, asset) => (asset.attempt > best.attempt ? asset : best));
}

/** Whether a signed URL is still usable, with a little room for the round trip. */
export function isAssetFresh(asset: CharacterAsset, now: number = Date.now()): boolean {
  if (!asset.expiresAt) return true;
  const expires = Date.parse(asset.expiresAt);
  if (Number.isNaN(expires)) return true;
  // Thirty seconds of slack: a URL that expires mid decode is a failed render
  // for no reason, and re-signing is cheap.
  return expires - now > 30_000;
}

/** Fetches the signed URLs for a project's character set. */
export async function fetchCharacterAssets(projectId: string): Promise<CharacterAsset[]> {
  const response = await fetch(`/api/projects/${projectId}/character/urls`);
  if (!response.ok) {
    throw new Error(
      response.status === 404
        ? "This project has no character set yet."
        : "Couldn't load the character images."
    );
  }
  const body = (await response.json()) as CharacterAssetsResponse;
  return Array.isArray(body.assets) ? body.assets : [];
}

/**
 * Decodes one asset into a bitmap ready to draw.
 *
 * `createImageBitmap` is used rather than an `Image` element because the result
 * is transferable, so the same decode serves the page preview and is handed to
 * the worker without a second download.
 */
export async function decodeAsset(asset: CharacterAsset): Promise<ImageBitmap> {
  if (!asset.url) throw new Error(`No signed URL for the ${asset.emotion} variant.`);
  const response = await fetch(asset.url);
  if (!response.ok) throw new Error(`Couldn't download the ${asset.emotion} variant.`);
  return createImageBitmap(await response.blob());
}

/**
 * Loads every emotion this plan actually uses, once.
 *
 * Only the emotions asked for are downloaded: a plan using three of the six
 * variants should not pull five megabytes of images nobody will see.
 */
export async function loadCharacterBitmaps(
  projectId: string,
  emotions: Iterable<CharacterEmotion | string>
): Promise<Map<string, ImageBitmap>> {
  const wanted = Array.from(new Set(Array.from(emotions).filter(Boolean)));
  if (wanted.length === 0) return new Map();

  const assets = await fetchCharacterAssets(projectId);
  const loaded = new Map<string, ImageBitmap>();

  await Promise.all(
    wanted.map(async (emotion) => {
      const asset = pickAssetForEmotion(assets, emotion);
      if (!asset || !isAssetFresh(asset)) return;
      try {
        loaded.set(emotion, await decodeAsset(asset));
      } catch {
        // One variant failing must not lose the others. The scene renders
        // without its character rather than not at all.
      }
    })
  );

  return loaded;
}
