import { describe, expect, it } from "vitest";
import {
  characterAssetPathname,
  isCharacterAssetPathname,
  projectAssetPrefix,
  projectIdFromAssetPathname,
} from "@/lib/asset-path";

const PROJECT = "3f7c1e2a-0b44-4d19-9a6e-8c5b21d0f7aa";
const OTHER = "9d2b4c8e-1a33-4f70-8b21-6e9c04a5d1bb";
const RANDOM = "0123456789abcdef";

describe("characterAssetPathname", () => {
  it("mints under the project's prefix, with emotion, attempt and randomness", () => {
    expect(characterAssetPathname(PROJECT, "neutral", 1, RANDOM)).toBe(
      `broll/${PROJECT}/neutral-1-${RANDOM}.png`
    );
  });

  it("gives a regeneration a new path rather than reusing the old one (AC-69)", () => {
    // Overwriting in place would serve the superseded cutout back from the CDN
    // cache for up to a minute, to the very user who just rejected it.
    const first = characterAssetPathname(PROJECT, "happy", 1);
    const second = characterAssetPathname(PROJECT, "happy", 2);
    expect(first).not.toBe(second);
  });

  it("produces a path it will itself accept", () => {
    for (const emotion of ["neutral", "happy", "surprised", "thoughtful", "skeptical", "excited"]) {
      const pathname = characterAssetPathname(PROJECT, emotion, 3);
      expect(isCharacterAssetPathname(pathname, PROJECT)).toBe(true);
    }
  });

  it("uses real randomness when none is injected", () => {
    const a = characterAssetPathname(PROJECT, "neutral", 1);
    const b = characterAssetPathname(PROJECT, "neutral", 1);
    expect(a).not.toBe(b);
  });
});

describe("isCharacterAssetPathname (AC-70)", () => {
  it("accepts this project's own asset", () => {
    expect(
      isCharacterAssetPathname(`broll/${PROJECT}/neutral-1-${RANDOM}.png`, PROJECT)
    ).toBe(true);
  });

  it("rejects a well formed path belonging to another project", () => {
    // The case that matters: a real, valid pathname, just not this caller's.
    // Accepting it would let broll_assets.r2_key point at someone else's object.
    expect(
      isCharacterAssetPathname(`broll/${OTHER}/neutral-1-${RANDOM}.png`, PROJECT)
    ).toBe(false);
  });

  it("rejects traversal out of the project prefix", () => {
    for (const pathname of [
      `broll/${PROJECT}/../${OTHER}/neutral-1-${RANDOM}.png`,
      `broll/${PROJECT}/../../etc/passwd.png`,
      `broll/${PROJECT}/sub/neutral-1-${RANDOM}.png`,
    ]) {
      expect(isCharacterAssetPathname(pathname, PROJECT)).toBe(false);
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
      expect(isCharacterAssetPathname(`broll/${PROJECT}/${tail}`, PROJECT)).toBe(false);
    }
  });

  it("rejects a path outside the broll namespace entirely", () => {
    expect(isCharacterAssetPathname(`projects/${PROJECT}/audio.png`, PROJECT)).toBe(false);
    expect(isCharacterAssetPathname(`${PROJECT}/neutral-1-${RANDOM}.png`, PROJECT)).toBe(false);
  });

  it("rejects a prefix that only looks like this project's", () => {
    // `startsWith` on a prefix without its trailing slash would let a project
    // whose id extends this one's slip through.
    expect(
      isCharacterAssetPathname(`broll/${PROJECT}extra/neutral-1-${RANDOM}.png`, PROJECT)
    ).toBe(false);
  });

  it("stays independent of the emotion list", () => {
    // A seventh emotion must not invalidate paths already stored, which is why
    // the shape is matched rather than membership in CHARACTER_EMOTIONS.
    expect(
      isCharacterAssetPathname(`broll/${PROJECT}/curious-1-${RANDOM}.png`, PROJECT)
    ).toBe(true);
  });
});

describe("projectIdFromAssetPathname", () => {
  it("recovers the id from a well formed path", () => {
    expect(projectIdFromAssetPathname(`broll/${PROJECT}/neutral-1-${RANDOM}.png`)).toBe(
      PROJECT
    );
  });

  it("returns null for anything it would not accept, so no id can be mined from a bad path", () => {
    for (const pathname of [
      `broll/${PROJECT}/../../secrets.png`,
      `broll/${PROJECT}/neutral-1-${RANDOM}.jpg`,
      `broll/${PROJECT}/`,
      "broll/",
      "",
      "not-a-path",
    ]) {
      expect(projectIdFromAssetPathname(pathname)).toBeNull();
    }
  });

  it("round trips with the minter", () => {
    const pathname = characterAssetPathname(PROJECT, "skeptical", 4);
    expect(projectIdFromAssetPathname(pathname)).toBe(PROJECT);
  });
});

describe("projectAssetPrefix", () => {
  it("ends with a slash so a sibling id cannot match by prefix", () => {
    expect(projectAssetPrefix(PROJECT)).toBe(`broll/${PROJECT}/`);
  });
});
