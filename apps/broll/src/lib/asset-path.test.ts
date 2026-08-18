import { describe, expect, it } from "vitest";
import {
  characterAssetPathname,
  characterAssetPrefix,
  characterIdFromAssetPathname,
  isCharacterAssetPathname,
  isObjectAssetPathname,
  isObjectAssetPathnameForAttempt,
  objectAssetPathname,
  sceneIdFromObjectAssetPathname,
} from "@/lib/asset-path";

const CHARACTER = "3f7c1e2a-0b44-4d19-9a6e-8c5b21d0f7aa";
const OTHER = "9d2b4c8e-1a33-4f70-8b21-6e9c04a5d1bb";
const RANDOM = "0123456789abcdef";

/**
 * A path in the shape spec `broll/0004` used, where the segment after `broll/`
 * was a **project** id rather than a character id.
 *
 * It appears throughout this file as an explicit rejection case, which spec
 * `broll/0007`'s migration risks call for by name: the two shapes are both
 * `broll/<something>/<emotion>-…` and a reviewer skimming the regular
 * expressions can read one for the other. Nothing accepts it any more, and the
 * `0018` migration deleted every row that referenced one.
 */
const OLD_PROJECT_SHAPED = `broll/${CHARACTER}/neutral-1-${RANDOM}.png`;

describe("characterAssetPathname", () => {
  it("mints under the character's prefix, with emotion, attempt and randomness", () => {
    expect(characterAssetPathname(CHARACTER, "neutral", 1, RANDOM)).toBe(
      `broll/characters/${CHARACTER}/neutral-1-${RANDOM}.png`
    );
  });

  it("gives a regeneration a new path rather than reusing the old one (AC-69)", () => {
    // Overwriting in place would serve the superseded cutout back from the CDN
    // cache for up to a minute, to the very user who just rejected it.
    const first = characterAssetPathname(CHARACTER, "happy", 1);
    const second = characterAssetPathname(CHARACTER, "happy", 2);
    expect(first).not.toBe(second);
  });

  it("produces a path it will itself accept", () => {
    for (const emotion of ["neutral", "happy", "surprised", "thoughtful", "skeptical", "excited"]) {
      const pathname = characterAssetPathname(CHARACTER, emotion, 3);
      expect(isCharacterAssetPathname(pathname, CHARACTER)).toBe(true);
    }
  });

  it("uses real randomness when none is injected", () => {
    const a = characterAssetPathname(CHARACTER, "neutral", 1);
    const b = characterAssetPathname(CHARACTER, "neutral", 1);
    expect(a).not.toBe(b);
  });
});

describe("isCharacterAssetPathname (AC-70, AC-141)", () => {
  it("accepts this character's own asset", () => {
    expect(
      isCharacterAssetPathname(
        `broll/characters/${CHARACTER}/neutral-1-${RANDOM}.png`,
        CHARACTER
      )
    ).toBe(true);
  });

  it("rejects a well formed path belonging to another character", () => {
    // The case that matters: a real, valid pathname, just not this caller's.
    // Accepting it would let broll_assets.r2_key point at someone else's object.
    expect(
      isCharacterAssetPathname(
        `broll/characters/${OTHER}/neutral-1-${RANDOM}.png`,
        CHARACTER
      )
    ).toBe(false);
  });

  it("rejects the old project shaped path (AC-141)", () => {
    // Spec `broll/0007` is a clean break: a path in the old shape matches
    // nothing and is never accepted, even when the id in it is this caller's.
    expect(isCharacterAssetPathname(OLD_PROJECT_SHAPED, CHARACTER)).toBe(false);
  });

  it("rejects traversal out of the character prefix", () => {
    for (const pathname of [
      `broll/characters/${CHARACTER}/../${OTHER}/neutral-1-${RANDOM}.png`,
      `broll/characters/${CHARACTER}/../../etc/passwd.png`,
      `broll/characters/${CHARACTER}/sub/neutral-1-${RANDOM}.png`,
    ]) {
      expect(isCharacterAssetPathname(pathname, CHARACTER)).toBe(false);
    }
  });

  it("rejects anything that is not the exact asset shape", () => {
    for (const tail of [
      "neutral-1-.png",
      "neutral--1-0123456789abcdef.png",
      `neutral-1-${RANDOM}.jpg`, // AC-19: PNG end to end, no JPEG anywhere
      `neutral-1-${RANDOM}.png.txt`,
      `Neutral-1-${RANDOM}.png`,
      `neutral-1-${RANDOM.toUpperCase()}.png`,
      `neutral-1-${RANDOM}`,
      "",
    ]) {
      expect(
        isCharacterAssetPathname(`broll/characters/${CHARACTER}/${tail}`, CHARACTER)
      ).toBe(false);
    }
  });

  it("rejects a path outside the broll namespace entirely", () => {
    expect(isCharacterAssetPathname(`projects/${CHARACTER}/audio.png`, CHARACTER)).toBe(
      false
    );
    expect(
      isCharacterAssetPathname(`${CHARACTER}/neutral-1-${RANDOM}.png`, CHARACTER)
    ).toBe(false);
  });

  it("rejects a prefix that only looks like this character's", () => {
    // `startsWith` on a prefix without its trailing slash would let a character
    // whose id extends this one's slip through.
    expect(
      isCharacterAssetPathname(
        `broll/characters/${CHARACTER}extra/neutral-1-${RANDOM}.png`,
        CHARACTER
      )
    ).toBe(false);
  });

  it("stays independent of the emotion list", () => {
    // A seventh emotion must not invalidate paths already stored, which is why
    // the shape is matched rather than membership in CHARACTER_EMOTIONS.
    expect(
      isCharacterAssetPathname(
        `broll/characters/${CHARACTER}/curious-1-${RANDOM}.png`,
        CHARACTER
      )
    ).toBe(true);
  });
});

describe("characterIdFromAssetPathname", () => {
  it("recovers the id from a well formed path", () => {
    expect(
      characterIdFromAssetPathname(
        `broll/characters/${CHARACTER}/neutral-1-${RANDOM}.png`
      )
    ).toBe(CHARACTER);
  });

  it("yields no id at all from an old project shaped path (AC-141)", () => {
    // The upload route looks the returned id up in `broll_characters`. If this
    // returned the segment after `broll/` for an old shaped path, that id would
    // be a **project** id being checked against the wrong table — which is
    // exactly the confusion the literal `characters/` segment prevents.
    expect(characterIdFromAssetPathname(OLD_PROJECT_SHAPED)).toBeNull();
  });

  it("returns null for anything it would not accept, so no id can be mined from a bad path", () => {
    for (const pathname of [
      `broll/characters/${CHARACTER}/../../secrets.png`,
      `broll/characters/${CHARACTER}/neutral-1-${RANDOM}.jpg`,
      `broll/characters/${CHARACTER}/`,
      "broll/characters/",
      "broll/",
      "",
      "not-a-path",
    ]) {
      expect(characterIdFromAssetPathname(pathname)).toBeNull();
    }
  });

  it("round trips with the minter", () => {
    const pathname = characterAssetPathname(CHARACTER, "skeptical", 4);
    expect(characterIdFromAssetPathname(pathname)).toBe(CHARACTER);
  });
});

describe("characterAssetPrefix", () => {
  it("ends with a slash so a sibling id cannot match by prefix", () => {
    expect(characterAssetPrefix(CHARACTER)).toBe(`broll/characters/${CHARACTER}/`);
  });
});

/**
 * Object illustration paths (spec `broll/0008`).
 *
 * The two shapes look alike enough to be confused by a reader skimming the
 * regular expressions, and confusing them is a cross user read: a character path
 * accepted as an object path would be authorized against the wrong table. So the
 * cross rejections below are the point of this block, not an edge case in it.
 */

describe("object asset pathnames", () => {
  const SCENE = "11111111-2222-3333-4444-555555555555";
  const OTHER = "99999999-8888-7777-6666-555555555555";

  it("mints a path under its own prefix", () => {
    const path = objectAssetPathname(SCENE, 1, "00112233445566ff");
    expect(path).toBe(`broll/objects/${SCENE}/1-00112233445566ff.png`);
    expect(isObjectAssetPathname(path, SCENE)).toBe(true);
  });

  it("gives a redraw a new path rather than the old one", () => {
    // Vercel's CDN caches blobs for up to a month, so writing in place would
    // serve the creator back the very illustration they just paid to replace.
    const first = objectAssetPathname(SCENE, 1);
    const second = objectAssetPathname(SCENE, 2);
    expect(first).not.toBe(second);
  });

  it("carries randomness, so knowing a scene id does not yield a key", () => {
    expect(objectAssetPathname(SCENE, 1)).not.toBe(objectAssetPathname(SCENE, 1));
  });

  it("recovers the scene id, so the upload route can prove ownership", () => {
    const path = objectAssetPathname(SCENE, 3, "aabbccddeeff0011");
    expect(sceneIdFromObjectAssetPathname(path)).toBe(SCENE);
  });

  it("rejects a path belonging to another scene", () => {
    expect(isObjectAssetPathname(objectAssetPathname(OTHER, 1), SCENE)).toBe(false);
  });

  it("admits no traversal, by shape rather than by filtering", () => {
    for (const bad of [
      `broll/objects/${SCENE}/../1-00112233445566ff.png`,
      `broll/objects/${SCENE}/a/1-00112233445566ff.png`,
      `broll/objects/${SCENE}/1-00112233445566ff.png.exe`,
      `broll/objects/${SCENE}/1-nothex0011223344.png`,
      `broll/objects/${SCENE}/x-00112233445566ff.png`,
    ]) {
      expect(isObjectAssetPathname(bad, SCENE)).toBe(false);
      expect(sceneIdFromObjectAssetPathname(bad)).toBeNull();
    }
  });

  it("never mistakes a character path for an object path", () => {
    const characterPath = characterAssetPathname(SCENE, "neutral", 1, "00112233445566ff");
    expect(isObjectAssetPathname(characterPath, SCENE)).toBe(false);
    expect(sceneIdFromObjectAssetPathname(characterPath)).toBeNull();
  });

  it("never mistakes an object path for a character path", () => {
    const objectPath = objectAssetPathname(SCENE, 1, "00112233445566ff");
    expect(isCharacterAssetPathname(objectPath, SCENE)).toBe(false);
    expect(characterIdFromAssetPathname(objectPath)).toBeNull();
  });
});

describe("isObjectAssetPathnameForAttempt", () => {
  const SCENE = "11111111-2222-3333-4444-555555555555";

  it("accepts the attempt it was minted for", () => {
    const path = objectAssetPathname(SCENE, 4, "00112233445566ff");
    expect(isObjectAssetPathnameForAttempt(path, SCENE, 4)).toBe(true);
  });

  it("rejects a well formed path for a different attempt", () => {
    // A stale upload from a request that lost a race. Pointing the row at it
    // would show the creator an illustration they had already replaced.
    const path = objectAssetPathname(SCENE, 3, "00112233445566ff");
    expect(isObjectAssetPathnameForAttempt(path, SCENE, 4)).toBe(false);
  });

  it("does not let attempt 1 match attempt 10", () => {
    // The separator is what makes this a whole-token check rather than a prefix
    // one; without it `10-` starts with `1`.
    const tenth = objectAssetPathname(SCENE, 10, "00112233445566ff");
    expect(isObjectAssetPathnameForAttempt(tenth, SCENE, 1)).toBe(false);
    expect(isObjectAssetPathnameForAttempt(tenth, SCENE, 10)).toBe(true);
  });
});
