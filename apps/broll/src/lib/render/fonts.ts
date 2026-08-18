/**
 * Getting the brand faces onto a canvas — on the page and inside the worker.
 *
 * **This module exists because a worker cannot inherit the page's fonts.** The
 * app loads Space Grotesk and DM Sans through `next/font/google`, which
 * self-hosts them under a content-hashed name with no stable public URL; the DOM
 * resolves them, and a worker's `OffscreenCanvas` resolves against `self.fonts`,
 * which starts empty. Naming a brand family in a canvas `font` string without
 * this would render correctly in the on-page preview and silently fall back to a
 * system face in the encoded MP4 — preview and export disagreeing, which is the
 * one failure `renderable.ts` exists to prevent.
 *
 * So both sides register the **same two files** from `public/fonts/`, through
 * this one module, and both await it before their first draw.
 *
 * Works in either context: `FontFace` and `self.fonts` exist on a window and in
 * a worker, and nothing here touches `document`.
 */

/** Registered once per realm. A second call awaits the first rather than re-fetching. */
let loading: Promise<boolean> | null = null;

/**
 * The realm's font set, however this realm spells it.
 *
 * Reached through `globalThis` rather than `self` or `document` on purpose. The
 * shared tsconfig uses the `dom` lib, where `self` is a `Window` and carries no
 * `fonts`; the worker declares its own narrow `self` with only `postMessage` and
 * `onmessage`. Neither typing describes the one thing both realms actually have,
 * which is a `FontFaceSet` on the global object.
 */
function fontSet(): FontFaceSet | undefined {
  return (globalThis as unknown as { fonts?: FontFaceSet }).fonts;
}

/**
 * The two families, the files behind them, and the axis range each covers.
 *
 * `weight` is stated as a range because these are variable fonts: without it the
 * browser assumes 400, and asking for 700 then gets a synthesised bold — which
 * is heavier, blurrier, and different between the preview and the encode.
 */
const FACES: readonly { family: string; url: string; weight: string }[] = [
  {
    family: "Space Grotesk",
    url: "/fonts/space-grotesk-latin-var.woff2",
    weight: "300 700",
  },
  {
    family: "DM Sans",
    url: "/fonts/dm-sans-latin-var.woff2",
    weight: "100 1000",
  },
];

/**
 * Whether both faces are registered and ready to draw with.
 *
 * **Resolves `false` rather than throwing when a face fails to load**, and the
 * callers treat that as "draw anyway". A missing font is a clip set in the
 * fallback stack; a thrown error here would be a clip that does not exist. The
 * first is a worse-looking export, the second is a lost render the creator
 * already waited for.
 *
 * Both faces are awaited together, so a frame is never drawn with one of them
 * resolved and the other still in flight — that would put two different faces in
 * one exported file depending on when each frame happened to be drawn.
 */
export function loadBrandFonts(): Promise<boolean> {
  if (loading) return loading;

  loading = (async () => {
    // A realm with no FontFace at all (an old browser, or a test environment)
    // is not an error: it just draws in the fallback stack.
    const fonts = fontSet();
    if (typeof FontFace === "undefined" || !fonts) return false;

    const results = await Promise.all(
      FACES.map(async (face) => {
        try {
          const loaded = await new FontFace(face.family, `url(${face.url})`, {
            weight: face.weight,
            style: "normal",
          }).load();
          fonts.add(loaded);
          return true;
        } catch {
          return false;
        }
      })
    );

    return results.every(Boolean);
  })();

  return loading;
}

/**
 * Forget the cached registration. Tests only — nothing in the app re-registers,
 * because a realm's font set does not go stale.
 */
export function resetBrandFontsForTest(): void {
  loading = null;
}
