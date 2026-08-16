"use client";

import { useEffect, useState } from "react";

/**
 * A media query as React state (spec `broll/0006` AC-110, AC-111).
 *
 * Two of this screen's rules cannot be expressed in CSS alone. Below the one
 * pane breakpoint the detail pane stops being a column beside the list and
 * becomes a layer over it with a way back, which is a different component tree
 * rather than a different width. And under `prefers-reduced-motion` the preview
 * must not start a frame loop at all, which means not attaching the hover
 * handler rather than animating invisibly.
 *
 * Starts `false` on the server and on the first client paint, then settles
 * after mount. That order matters: reading `matchMedia` during render would
 * make the markup depend on the window and hydration would mismatch. The cost
 * is that a narrow window paints the wide layout for one frame, which is
 * cheaper than the alternatives.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const list = window.matchMedia(query);
    const update = () => setMatches(list.matches);
    update();
    list.addEventListener("change", update);
    return () => list.removeEventListener("change", update);
  }, [query]);

  return matches;
}

/** Below this the screen collapses to one pane (spec `0006` sizes table). */
export const ONE_PANE_QUERY = "(max-width: 1099px)";

/** Nothing plays on hover or on focus while this is true (AC-111). */
export const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";
