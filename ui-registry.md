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
the rest of the app (dashboard list, auth, app-nav logo) still uses **blue**
(`bg-blue-600`, `text-blue-400`), and as of 2026-07-04 the **landing page** uses
its own fixed marketing palette with a custom blue (`#4D8DFF` — see "Marketing /
landing surface" below). The app currently has three accent treatments. Until
resolved: **new editor components → violet; new dashboard/auth components →
Tailwind blue; new marketing/landing components → the `#4D8DFF` system below.**

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
| Active word (playback tracker) | `bg-violet-600 text-white shadow-sm shadow-violet-500/40 ring-1 ring-violet-300/60` |
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
track playback position at a glance. Uses the `bg-violet-600` solid-accent token (not
`violet-500`) so white text clears WCAG AA (~4.6:1); no font-weight change, to avoid
per-word width jitter as the highlight advances. It takes precedence over
selection/search-match backgrounds (those are gated with `!isActive`). The active-color branch lives in the
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

## Toolbar action button (enabled vs coming-soon)

File: `src/components/timeline-bar.tsx`
Last updated: 2026-06-30

| State        | Class |
| ------------ | ----- |
| Enabled (`actionBtn`) | `flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium text-foreground/70 transition-colors hover:bg-foreground/10 hover:text-foreground/90` |
| Disabled / coming-soon (`toolBtn`) | same shape but `text-foreground/40 cursor-not-allowed` (no hover) |

Icon + label, `h-3.5 w-3.5` icon. Disabled placeholders carry a `title="… (coming
soon)"`; enabled actions put the keyboard hint in the title (e.g. `Cut left of
playhead (Q)`).

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

---

## Marketing / landing surface — Established 2026-07-04

File: `src/app/page.tsx`
Last updated: 2026-07-04

The landing page follows a **fixed dark marketing palette** (from the Figma/HTML
design), deliberately NOT the `background`/`foreground` theme tokens — it is
dark-only and self-contained. These values apply to marketing/landing surfaces
only; do not carry them into the editor or dashboard.

### Palette

| Role                  | Value |
| --------------------- | ----- |
| Page background       | `bg-[#070B12]` |
| Card surface          | `bg-[#0B1220]` |
| Raised surface        | `bg-[#0C1322]` |
| Recessed surface      | `bg-[#0A101C]` |
| Window-chrome bar     | `bg-[#0D1424]` |
| Text — primary        | `text-[#E8EDF6]` |
| Text — secondary      | `text-[#8A97AC]` |
| Text — dim label      | `text-[#5D6B82]` |
| Text — faint/footer   | `text-[#3D4A5F]` |
| Accent solid          | `bg-[#4D8DFF]`, hover `hover:bg-[#7EB2FF]`, text-on-accent `text-[#06101F]` |
| Accent text           | `text-[#7EB2FF]` (light) / `text-[#4D8DFF]` (labels) |
| Accent tint           | `bg-[rgba(77,141,255,0.08)]` (pill) – `0.16` (chip) |
| Border — hairline     | `border-[rgba(148,180,255,0.08)]` (nav/footer) |
| Border — card         | `border-[rgba(148,180,255,0.12)]`, inner dividers `0.1`, list items `0.14` |
| Border — accent       | `border-[rgba(77,141,255,0.2)]`–`0.35` (highlighted/open states) |
| Destructive (marketing) | strikethrough `decoration-[rgba(248,113,113,0.7)]`, text `#F0A0A0`, tint `rgba(248,113,113,0.08)` |

### Typography

| Role        | Class |
| ----------- | ----- |
| Display / headings | `font-[family-name:var(--font-bricolage)]` (Bricolage Grotesque 600/700/800), tracking `-0.02em`–`-0.03em` |
| Body        | `font-[family-name:var(--font-instrument)]` (Instrument Sans) on the page root |
| Labels / eyebrows / timecodes | `font-[family-name:var(--font-plex-mono)]` (IBM Plex Mono), `text-xs`–`text-[13px]`, `uppercase`, `tracking-[0.04em]`–`[0.08em]` |

Fonts load via `next/font` **inside `page.tsx`** (not the root layout) so they
only ship on the landing route. Reuse the `display` / `mono` class consts.

### Components

| Component | Pattern |
| --------- | ------- |
| Button — primary | `rounded-xl bg-[#4D8DFF] px-7 py-3.5 text-[15px] font-semibold text-[#06101F] shadow-[0_4px_24px_rgba(77,141,255,0.35)] hover:bg-[#7EB2FF]` (nav variant: `rounded-[10px] px-[18px] py-[9px] text-sm`, no shadow) |
| Button — secondary | `rounded-xl border border-[rgba(148,180,255,0.18)] text-[#E8EDF6] hover:border-[rgba(148,180,255,0.4)]` (same padding as primary) |
| Feature card | `rounded-2xl border border-[rgba(148,180,255,0.12)] bg-gradient-to-b from-[rgba(20,30,52,0.5)] to-[rgba(11,18,32,0.5)] p-7 hover:border-[rgba(77,141,255,0.4)]` |
| Icon tile | `h-10 w-10 rounded-[11px] border border-[rgba(77,141,255,0.25)] bg-[rgba(77,141,255,0.12)]`, stroke `#7EB2FF` inline SVG |
| Eyebrow pill | mono uppercase, `rounded-full border border-[rgba(77,141,255,0.3)] bg-[rgba(77,141,255,0.08)] text-[#7EB2FF]` + 6px `bg-[#4D8DFF]` dot |
| Highlight chip (headline) | `rounded-[10px] bg-[rgba(77,141,255,0.16)] px-3 text-[#7EB2FF] shadow-[inset_0_0_0_1px_rgba(77,141,255,0.25)]` |
| FAQ item | `<details name="…">` (zero-JS exclusive accordion), `rounded-[14px] border-[rgba(148,180,255,0.12)] bg-[#0A101C]`, open: `open:border-[rgba(77,141,255,0.35)] open:bg-[#0C1322]`; `+` icon `group-open:rotate-45 group-open:text-[#7EB2FF]` |
| Big showcase card (privacy) | `rounded-[20px] border-[rgba(77,141,255,0.2)] bg-[#0B1220]` + radial glow bg image, `p-8 sm:p-14` |
| Nav | `sticky top-0 z-50 bg-[rgba(7,11,18,0.8)] backdrop-blur-xl border-b` hairline |
| Ambient glow | absolutely-positioned `bg-[radial-gradient(…,rgba(56,110,220,0.14–0.22),transparent_70%)]`, always `pointer-events-none` + `aria-hidden` |

**Pattern notes:** section content max-width is `max-w-[1060px]` (760px for the
FAQ column); anchor targets use `scroll-mt-20` to clear the sticky nav. The page
stays a server component — no client JS (FAQ uses native `<details name>`).
Decorative mockup/diagram blocks are `aria-hidden`. The old landing accent
(`bg-blue-600` + blue/cyan gradient text) is retired on this surface.
