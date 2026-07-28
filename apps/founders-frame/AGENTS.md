<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Founder's Frame (apps/founders-frame)

## Overview

The public marketing site for the SUBI ecosystem: it tells the brand story and
sends visitors into the products (Ruff Cut, the Wallet) and into a mentorship
booking flow. Unlike the other two apps it has no accounts, no database, and no
API — it is a **fully static export** (`output: 'export'` in `next.config.ts`),
so every page is prerendered HTML served as files. Runs on port 3002 in dev.

## Key files

| File | Owns |
|---|---|
| `next.config.ts` | `output: 'export'` (static site, no server at runtime), `images.unoptimized: true` (Next's image optimizer needs a server), and `typescript.ignoreBuildErrors: true` |
| `src/lib/env.ts` | The two cross-app URLs (`NEXT_PUBLIC_ROUGH_CUT_APP_URL`, `NEXT_PUBLIC_WALLET_APP_URL`) and their production fallbacks (`myfirstcut.app`, `myframecredits.app`). The only place in this app allowed to read `process.env` |
| `src/app/globals.css` | Imports `@repo/ui/styles/theme.css`, then adds this app's own theme layer: `--color-brand` (bright yellow), `--color-surface`, the float/breathe/liquid keyframe animations, and the `glass-panel` / `glow-panel` / `bg-grid-pattern` utility classes |
| `src/app/page.tsx` | The landing page: hero, product showcase, and the calls to action that deep-link into Ruff Cut |
| `src/app/mentorship/page.tsx`, `src/app/mentorship/apply/page.tsx` | The mentorship pitch and the booking page that mounts the Calendly widget |
| `src/app/mentorship/form/page.tsx` | A redirect only, kept so the older `/mentorship/form` link still lands on `/mentorship/apply` |
| `src/components/CalendlyWidget.tsx`, `src/components/WistiaPlayer.tsx` | The two third party embeds. Each injects its vendor script tag into `document.body` on mount, guarding against a duplicate insert by checking for the existing `script[src=...]` |
| `src/components/FadeIn.tsx`, `src/components/SpotlightCard.tsx`, `src/components/HeroHeadline.tsx`, `src/components/ChapterTimeline.tsx` | The motion pieces, all built on `framer-motion` |
| `src/app/not-found.tsx` | The custom 404, part of the landing page acceptance criteria |

## Commands

```bash
npm run dev -w @repo/founders-frame        # next dev -p 3002 (port pinned)
npm run build -w @repo/founders-frame      # next build -> static files in out/
npm run typecheck -w @repo/founders-frame
```

There is no test script in this workspace, so the root `npm run test` runs
nothing here.

## Conventions

- **Static export, so nothing server side works.** No route handlers, no
  `proxy.ts` middleware, no server actions, no dynamic `params` that are not
  prerendered, no `next/image` optimization. A feature that needs any of those
  belongs in `apps/rough-cut` or `apps/wallet`, not here.
- **No accounts and no data.** This app does not depend on `@repo/db`,
  `@repo/server-shared`, or Clerk, and it should stay that way: it is excluded
  from `.github/workflows/db-verify.yml` for exactly that reason. Anything that
  needs a signed-in user deep-links into another app instead.
- **Cross-app links always go through `src/lib/env.ts`**, matching the
  ecosystem rule in the root `AGENTS.md`. Note the difference from the other two
  apps though: their `env.ts` throws at import time when a URL is missing, while
  this one silently falls back to the production domain, because a static export
  has no server to fail loudly on.
- **Shared theme tokens come from `@repo/ui`, shared components do not.** The app
  imports `@repo/ui/styles/theme.css` in `globals.css` and layers its own brand
  tokens on top. It is a marketing site with its own visual language, so it does
  not use `ConfirmDialog` or `Tooltip`.
- **Motion is `framer-motion`**, not CSS transitions, for anything that animates
  on scroll. `FadeIn` is the standard wrapper: it uses `whileInView` with
  `viewport={{ once: true }}` so an element animates in a single time.

- **`next build` type checks this app for real**, same as the other two. It used
  to carry `typescript.ignoreBuildErrors: true`, which meant a type error could
  ship; that escape hatch is gone and must not come back. `tsc --noEmit` (the
  `typecheck` script) and the build check slightly different sets, since only the
  build sees the generated route types under `.next/types`, so both are worth
  running.

## Gotchas

- **`FadeIn.tsx` defines its own local copy of `cn()`** instead of importing the
  one from `@repo/ui`. The app depends on `@repo/ui` but currently pulls only
  the CSS from it. Prefer the shared `cn()` in new components.
- **Neither embed is loaded through `next/script`.** Both widgets append a raw
  `<script>` tag in a `useEffect`, which is why they are `"use client"` and why
  the duplicate check matters: a second mount without it would load the vendor
  script twice.
- The Calendly booking URL is a **default parameter value inside
  `CalendlyWidget.tsx`**, not an environment variable. Changing who the booking
  goes to is a code change.

## Related specs

- `docs/specs/founders-frame/0001-founders-frame-landing-page.md`
- `docs/specs/founders-frame/0002-founders-frame-landing-page-design-and-copy.md`

_Drafted by /audit from the repo, worth a quick human pass. Edit freely: once a line stops matching this draft, later runs treat it as curated and will flag rather than overwrite it._
