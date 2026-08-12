import { describe, expect, it } from "vitest";
import { isAssetFresh, pickAssetForEmotion, type CharacterAsset } from "./character-assets";

const asset = (over: Partial<CharacterAsset> = {}): CharacterAsset => ({
  emotion: "neutral",
  width: 686,
  height: 1126,
  attempt: 1,
  url: "https://example.invalid/neutral.png",
  expiresAt: null,
  ...over,
});

describe("pickAssetForEmotion", () => {
  it("finds the asset for the emotion the scene asked for", () => {
    const assets = [asset({ emotion: "neutral" }), asset({ emotion: "skeptical" })];
    expect(pickAssetForEmotion(assets, "skeptical")?.emotion).toBe("skeptical");
  });

  it("takes the highest attempt, which is the current image", () => {
    // Regeneration bumps attempt in place, so a higher attempt supersedes.
    const assets = [
      asset({ emotion: "happy", attempt: 1, url: "https://example.invalid/old.png" }),
      asset({ emotion: "happy", attempt: 3, url: "https://example.invalid/new.png" }),
      asset({ emotion: "happy", attempt: 2, url: "https://example.invalid/mid.png" }),
    ];
    expect(pickAssetForEmotion(assets, "happy")?.url).toBe("https://example.invalid/new.png");
  });

  it("skips an asset whose URL failed to sign", () => {
    // Returning it with a null URL would push the failure into the renderer.
    const assets = [asset({ emotion: "excited", url: null }), asset({ emotion: "neutral" })];
    expect(pickAssetForEmotion(assets, "excited")).toBeNull();
    expect(pickAssetForEmotion([asset({ emotion: "excited", url: "" })], "excited")).toBeNull();
  });

  it("returns null for a scene with no emotion, which is not an error", () => {
    // Chart and text scenes carry no emotion at all.
    expect(pickAssetForEmotion([asset()], null)).toBeNull();
  });

  it("returns null when the set has no such variant", () => {
    expect(pickAssetForEmotion([asset({ emotion: "neutral" })], "surprised")).toBeNull();
  });
});

describe("isAssetFresh", () => {
  const now = Date.parse("2026-08-12T12:00:00.000Z");

  it("accepts a URL with time left on it", () => {
    expect(isAssetFresh(asset({ expiresAt: "2026-08-12T12:30:00.000Z" }), now)).toBe(true);
  });

  it("rejects one that is about to expire mid decode", () => {
    // A URL expiring during the download is a failed render for no reason, and
    // re-signing costs nothing.
    expect(isAssetFresh(asset({ expiresAt: "2026-08-12T12:00:10.000Z" }), now)).toBe(false);
    expect(isAssetFresh(asset({ expiresAt: "2026-08-12T11:59:00.000Z" }), now)).toBe(false);
  });

  it("treats a missing or unparseable expiry as usable rather than blocking", () => {
    expect(isAssetFresh(asset({ expiresAt: null }), now)).toBe(true);
    expect(isAssetFresh(asset({ expiresAt: "not a date" }), now)).toBe(true);
  });
});
