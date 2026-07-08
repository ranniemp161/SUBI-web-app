# @repo/ui

## Overview
Thin shared UI package for the SUBI ecosystem (ADR `0001`, revised decision 6).
Holds the design-system tokens shared by every app plus a `cn()` class helper.
Deliberately **not** a component library — Tailwind is v4 (CSS-first, no config
module to share) and no reusable primitives exist yet; a component library is
deferred until a second app actually needs a shared primitive.

## Key files
| File | Owns |
|---|---|
| `src/styles/theme.css` | Shared design tokens: base palette (`--background`/`--foreground`), fonts, dark mode, and the keyboard focus-visible ring. Single source of truth for the theme. |
| `src/index.ts` | `cn()` — merges class names (clsx) and de-conflicts Tailwind utilities (tailwind-merge). |

## Conventions
- **Consumed via CSS import**, after `@import "tailwindcss";` in each app's
  `globals.css`: `@import "@repo/ui/styles/theme.css";`. Verified to resolve
  through the Tailwind v4 PostCSS plugin.
- **Only ecosystem-wide tokens live here.** App-specific theme extensions
  (e.g. rough-cut's `--color-surface`, animations, scrollbars) stay in that
  app's own `globals.css`, not in this package.
- No build step — apps import the `.ts`/`.css` source directly (workspace
  package, transpiled by each app's Next build).

## Gotchas
- Changing a token here changes both apps at once — that's the point, but treat
  edits as a design-system change, not a local tweak.

## Related ADRs
- `docs/adr/_root/0001-monorepo-wallet-architecture.md` (decision 6, revised)
