# UI Registry

The reference for visual consistency across Rough Cut. Read this before building
any new component. Match these patterns; don't invent new ones.

Token system (from `src/app/globals.css`): the only theme colors are
`--background` and `--foreground`. Everything is built from `bg-background`,
`text-foreground`, and alpha variants (`foreground/5`, `foreground/[0.02]`, …).
Accent and status colors use Tailwind's built-in palettes (violet, emerald,
amber, red). Dark mode is automatic via `prefers-color-scheme`.

---

## Baseline — Established 2026-06-30

Captured from the editor rebuild (page chrome, transcript panel, timeline,
video player). This is the de-facto design language for the **editor surface**.

| Property            | Class |
| ------------------- | ----- |
| App background      | `bg-background` |
| Subtle surface      | `bg-foreground/[0.02]` (panels), `bg-foreground/[0.03]`–`[0.04]` (raised) |
| Divider / hairline  | `border-foreground/5` |
| Control / card border | `border-foreground/10` |
| Text — primary      | `text-foreground` / `text-foreground/90` |
| Text — secondary    | `text-foreground/70` / `text-foreground/60` |
| Text — muted        | `text-foreground/40` / `text-foreground/30` |
| Accent (editor)     | violet — `bg-violet-600` (solid), `bg-violet-500/15`–`/20` (tint), `text-violet-300` |
| Radius — control/clip | `rounded-md` |
| Radius — button/input/card | `rounded-lg` |
| Radius — panel / big card | `rounded-xl` |
| Radius — modal      | `rounded-2xl` |
| Radius — pill/dot/avatar | `rounded-full` |
| Hover — secondary   | `hover:bg-foreground/10 hover:text-foreground/90` |
| Mono usage          | `font-mono` for all timecodes, durations, keycaps |

**Accent note (IMPORTANT inconsistency):** the **editor** uses **violet**, but
the rest of the app (dashboard list, landing page, auth, app-nav logo) still
uses **blue** (`bg-blue-600`, `text-blue-400`). The app currently has two accent
colors. Pick one direction before shipping: either migrate the marketing/dashboard
surfaces to violet, or treat violet as an editor-only accent on purpose. Until
resolved, **new editor components → violet; new dashboard/marketing components → blue.**

**Icon note:** the editor uses **`lucide-react`** for all iconography (swapped in
from emoji placeholders on 2026-06-30). Conventions: import named icons directly
(`import { Play, Scissors } from "lucide-react"`); size with `h-4 w-4` (inline /
transport / toolbar) or `h-5 w-5` (tool rail), and `h-3.5 w-3.5` for small inline
affordances (context-menu trailing glyphs, timeline toolbar). Use `fill-current` on
Play/Pause for a solid transport look; nudge the Play triangle with `translate-x-0.5`
to optically center it. Icons inherit color via `currentColor` (stroke-based), so
they pick up the surrounding `text-*` class. The dashboard/file-picker still use
hand-rolled inline `stroke="currentColor"` SVGs — fine to leave, but prefer lucide
for new work.

---

## Status / semantic colors

| Meaning            | Class |
| ------------------ | ----- |
| Success / saved / decoded | dot `bg-emerald-400`, text `text-emerald-400` |
| In-progress / saving | dot `bg-amber-400` |
| Search match (highlight) | `bg-amber-400/25` |
| Active word (playback tracker) | `bg-violet-500 font-medium text-white shadow-sm shadow-violet-500/40 ring-1 ring-violet-300/60` |
| Destructive / cut word | `text-red-400/70 line-through decoration-red-400/50` |
| Cut action button  | `bg-red-500/15 text-red-300 hover:bg-red-500/25` |
| Retake (auto-detected repeated take) | word: `text-amber-400/70 line-through decoration-amber-400/50`; timeline clip: `border-amber-400/30 bg-amber-950/40`; review action: `bg-amber-500/20 text-amber-300 hover:bg-amber-500/30` |
| Count badge        | `bg-gradient-to-br from-orange-500 to-amber-500 text-white` |

**Cut-color note:** cut styling now branches on `EDLSegment.reason` — `"silence"` and
`"manual"` stay red (the original cut color), `"retake"` is amber, so a glance at the
transcript or timeline tells you *why* something was cut. Added 2026-06-30 alongside
`src/lib/retake-detection.ts`.

**Active-word note:** the currently-playing word is a solid violet karaoke-style
highlight (filled bg + white text + ring), deliberately high-contrast so the user can
track playback position at a glance. It takes precedence over selection/search-match
backgrounds (those are gated with `!isActive`). The active-color branch lives in the
non-cut path so its `text-white` wins over the default `text-foreground/90` — Tailwind
resolves conflicts by stylesheet order, not class-string order, so mutually-exclusive
branches are required rather than appending an override.

---

## Panel / surface

File: `src/components/timeline-bar.tsx`, `src/components/transcript-panel.tsx`
Last updated: 2026-06-30

| Property      | Class |
| ------------- | ----- |
| Background    | `bg-foreground/[0.02]` (or `bg-background` for docked sections) |
| Border        | `border-foreground/5` (dividers), `border-t`/`border-l` for docked edges |
| Border radius | `rounded-xl` (floating cards) / none (full-bleed docked sections) |
| Spacing       | `p-3` / `p-4`; section padding `px-4 py-2` |
| Shadow        | none |

**Pattern notes:** Floating cards are `rounded-xl border border-foreground/5
bg-foreground/[0.02]`. Full-height docked regions (timeline, transcript) drop the
radius and use a single edge border (`border-t`/`border-l border-foreground/10`).

---

## Button — primary

File: `src/app/(app)/dashboard/[id]/page.tsx`
Last updated: 2026-06-30

| Property      | Class |
| ------------- | ----- |
| Background    | `bg-violet-600` |
| Text          | `text-white` |
| Border radius | `rounded-lg` (or `rounded-full` for the circular play button) |
| Spacing       | `px-4 py-1.5` (bar button) / `h-10 w-10` (circular) |
| Hover         | `hover:bg-violet-500` |
| Shadow        | `shadow-lg` only on the floating play overlay |

---

## Button — secondary / icon

File: `src/app/(app)/dashboard/[id]/page.tsx`
Last updated: 2026-06-30

| Property      | Class |
| ------------- | ----- |
| Background    | none (transparent) |
| Border        | `border border-foreground/10` (bordered variant) or none (ghost) |
| Text          | `text-foreground/60` / `text-foreground/70` |
| Border radius | `rounded-md` / `rounded-lg` |
| Spacing       | `h-7 w-7` / `h-8 w-8` / `h-9 w-9` icon, `px-2 py-1` text |
| Hover         | `hover:bg-foreground/10 hover:text-foreground/90` |

---

## Button — disabled "coming soon"

File: `src/app/(app)/dashboard/[id]/page.tsx`
Last updated: 2026-06-30

| Property      | Class |
| ------------- | ----- |
| Background    | `bg-foreground/10` (or `bg-violet-600/60` for the dimmed Export) |
| Text          | `text-foreground/40` (or `text-white/70`) |
| Border radius | `rounded-lg` |
| State         | `disabled` + `cursor-not-allowed` + `title="… (coming soon)"` |

**Pattern notes:** Every not-yet-built control uses this exact treatment plus a
`title` ending in "(coming soon)". Do not hide unbuilt controls in the editor —
show them disabled so the layout matches the target design.

---

## Input — search / text

File: `src/components/transcript-panel.tsx`
Last updated: 2026-06-30

| Property      | Class |
| ------------- | ----- |
| Background    | `bg-foreground/[0.03]` |
| Border        | `border border-foreground/10` |
| Text          | `text-foreground`, placeholder `placeholder:text-foreground/30` |
| Border radius | `rounded-lg` |
| Spacing       | `py-2 pl-9 pr-16` (with leading icon) |
| Focus         | `focus:border-violet-500/50 focus:outline-none` |

---

## Toggle button (active/inactive)

File: `src/components/timeline-bar.tsx` (Snap), tool rail (Select)
Last updated: 2026-06-30

| Property        | Class |
| --------------- | ----- |
| Active          | `bg-violet-500/15`–`/20 text-violet-300` |
| Inactive        | `text-foreground/50 hover:bg-foreground/10 hover:text-foreground/80` |
| Border radius   | `rounded-md` / `rounded-lg` |

---

## Suggestion / callout card

File: `src/components/transcript-panel.tsx`
Last updated: 2026-06-30

| Property      | Class |
| ------------- | ----- |
| Background    | `bg-violet-500/[0.07]` |
| Border        | `border border-violet-500/20` |
| Text          | title `text-foreground` (`text-sm font-semibold`), sub `text-foreground/50 text-xs` |
| Border radius | `rounded-xl` |
| Spacing       | `p-3`, inner `gap-3` |
| Icon chip     | `h-8 w-8 rounded-lg bg-violet-500/20 text-violet-300` |

---

## Modal overlay

File: `src/app/(app)/dashboard/[id]/page.tsx` (ShortcutsOverlay)
Last updated: 2026-06-30

| Property      | Class |
| ------------- | ----- |
| Backdrop      | `fixed inset-0 z-50 bg-black/60 backdrop-blur-sm` |
| Panel bg      | `bg-background` |
| Panel border  | `border border-foreground/10` |
| Border radius | `rounded-2xl` |
| Spacing       | `p-6` |
| Shadow        | `shadow-2xl` |
| Keycap (`kbd`)| `rounded-md border border-foreground/10 bg-foreground/5 px-2 py-0.5 font-mono text-xs text-foreground/80` |

**Pattern notes:** Click-backdrop-to-close; inner panel stops propagation. Esc and
the trigger key (`?`) also toggle it.

---

## Timeline clip

File: `src/components/timeline-bar.tsx`
Last updated: 2026-06-30

| Property      | Class |
| ------------- | ----- |
| Keep clip     | `border border-violet-400/40 bg-gradient-to-b from-violet-500/85 to-violet-600/85` |
| Cut clip      | `border border-foreground/10 bg-black/40` + diagonal hatch `repeating-linear-gradient(45deg, rgba(255,255,255,0.06) 0 6px, transparent 6px 12px)` |
| Border radius | `rounded-md` |
| Trim handle   | `w-0.5 bg-foreground/25 group-hover:bg-violet-400`, `cursor-col-resize` |
| Playhead      | `w-px bg-red-500` + rotated `bg-red-500` diamond head |

**Pattern notes:** Waveform fill is `rgba(167, 139, 250, 0.55)` (violet-400 @ 55%)
drawn to canvas — keep this in sync with the violet accent if the accent changes.
