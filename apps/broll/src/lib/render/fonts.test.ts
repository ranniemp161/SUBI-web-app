import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadBrandFonts, resetBrandFontsForTest } from "./fonts";

/**
 * Registering the brand faces in whichever realm is drawing.
 *
 * The property under test is not "the fonts look right" — a unit test cannot
 * see a glyph. It is the three ways this can go wrong silently: registering
 * twice per realm (so a batch of twelve renders fetches twenty-four files), a
 * failure taking a render down with it, and a realm with no font set at all
 * throwing instead of falling back.
 */

type FakeFace = { family: string; source: string; descriptors: { weight?: string } };

let added: FakeFace[] = [];
let loadCalls = 0;
let failFamilies: string[] = [];

class FakeFontFace {
  family: string;
  source: string;
  descriptors: { weight?: string };

  constructor(family: string, source: string, descriptors: { weight?: string } = {}) {
    this.family = family;
    this.source = source;
    this.descriptors = descriptors;
  }

  async load() {
    loadCalls += 1;
    if (failFamilies.includes(this.family)) throw new Error("network");
    return this;
  }
}

beforeEach(() => {
  added = [];
  loadCalls = 0;
  failFamilies = [];
  resetBrandFontsForTest();
  vi.stubGlobal("FontFace", FakeFontFace);
  vi.stubGlobal("fonts", { add: (f: FakeFace) => added.push(f) });
  // The module reads the set off `globalThis`, which is what both a window and
  // a worker actually have — see the note in `fonts.ts`.
  (globalThis as unknown as { fonts: unknown }).fonts = {
    add: (f: FakeFace) => added.push(f),
  };
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete (globalThis as unknown as { fonts?: unknown }).fonts;
  resetBrandFontsForTest();
});

describe("loadBrandFonts", () => {
  it("registers both brand families", async () => {
    await expect(loadBrandFonts()).resolves.toBe(true);
    expect(added.map((f) => f.family).sort()).toEqual(["DM Sans", "Space Grotesk"]);
  });

  it("points each family at a file under /fonts/", async () => {
    await loadBrandFonts();
    for (const face of added) expect(face.source).toContain("/fonts/");
    expect(added.every((f) => f.source.endsWith(".woff2)"))).toBe(true);
  });

  it("declares a weight range, because these are variable fonts", async () => {
    // Without it the browser assumes 400 and synthesises 700 — heavier,
    // blurrier, and different between the preview and the encode.
    await loadBrandFonts();
    for (const face of added) expect(face.descriptors.weight).toMatch(/^\d+ \d+$/);
  });

  it("covers every weight the templates actually draw", async () => {
    // 400, 600 and 700 all appear in the renderers today.
    await loadBrandFonts();
    for (const face of added) {
      const [min, max] = (face.descriptors.weight ?? "").split(" ").map(Number);
      expect(min).toBeLessThanOrEqual(400);
      expect(max).toBeGreaterThanOrEqual(700);
    }
  });

  it("registers once per realm, however many callers ask", async () => {
    // Every still on the studio screen calls this, and so does every render in
    // a batch. Fetching per caller would be a dozen downloads of the same file.
    await Promise.all([loadBrandFonts(), loadBrandFonts(), loadBrandFonts()]);
    await loadBrandFonts();
    expect(loadCalls).toBe(2);
    expect(added).toHaveLength(2);
  });

  it("reports false when a face fails, rather than throwing", async () => {
    // The worker awaits this before frame zero. Throwing would lose a render the
    // creator has already waited for, to avoid a clip in the wrong font.
    failFamilies = ["DM Sans"];
    await expect(loadBrandFonts()).resolves.toBe(false);
  });

  it("still registers the face that did load", async () => {
    failFamilies = ["DM Sans"];
    await loadBrandFonts();
    expect(added.map((f) => f.family)).toEqual(["Space Grotesk"]);
  });

  it("reports false in a realm with no font set at all", async () => {
    // An old browser, or a test environment. Not an error: it draws in the
    // fallback stack.
    delete (globalThis as unknown as { fonts?: unknown }).fonts;
    await expect(loadBrandFonts()).resolves.toBe(false);
  });

  it("reports false where FontFace does not exist", async () => {
    vi.stubGlobal("FontFace", undefined);
    await expect(loadBrandFonts()).resolves.toBe(false);
  });
});
