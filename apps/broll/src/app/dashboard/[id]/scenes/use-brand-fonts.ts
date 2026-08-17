"use client";

import { useEffect, useState } from "react";
import { loadBrandFonts } from "@/lib/render/fonts";

/**
 * Whether the brand faces have settled in this page's font set.
 *
 * **Exists to trigger one repaint, not to gate the first one.** Both canvases on
 * this screen paint inside an effect keyed on their inputs, so a still drawn
 * before the fonts registered would sit there in the fallback stack until
 * something else happened to change. Adding this to those dependency lists
 * repaints them once, the moment the faces are available.
 *
 * The page is deliberately **not** blocked on it: a scene appears immediately in
 * whatever face is resolvable, and sharpens a moment later. The worker's
 * situation is the opposite and it does await — an encode is a single pass, so a
 * frame drawn early ships that way (see `render-worker.ts`).
 *
 * True means *settled*, not *succeeded*. A face that failed to load still ends
 * the wait, because there is nothing further to repaint for.
 */
export function useBrandFonts(): boolean {
  const [settled, setSettled] = useState(false);

  useEffect(() => {
    let active = true;
    // Idempotent and cached per realm, so every canvas on the screen calling
    // this shares one fetch.
    loadBrandFonts()
      .then(() => {
        if (active) setSettled(true);
      })
      .catch(() => {
        if (active) setSettled(true);
      });
    return () => {
      active = false;
    };
  }, []);

  return settled;
}
