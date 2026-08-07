# @repo/ui

## Overview
Thin shared UI package for the SUBI ecosystem (ADR `0001`, revised decision 6).
Holds the design-system tokens shared by every app, a `cn()` class helper, and
the shared components: `ConfirmDialog` (a Radix AlertDialog wrapper built for
ADR 0003 child 3) and `Tooltip` (a Radix tooltip wrapper), both reusable across
apps.

**Money helpers are not here anymore.** `MICROS_PER_USD`,
`RETAIL_MICROS_PER_MINUTE`, `chargeMicrosForSeconds`, and `formatUsd` moved to
`@repo/billing/pricing`, so the rate the server charges at and the rate the
client displays are one constant. Import that subpath directly from a client
component; never the `@repo/billing` barrel, which reaches the database.

## Key files
| File | Owns |
|---|---|
| `src/styles/theme.css` | Shared design tokens: base palette (`--background`/`--foreground`), fonts, dark mode, and the keyboard focus-visible ring. Single source of truth for the theme. |
| `src/index.ts` | `cn()` — merges class names (clsx) and de-conflicts Tailwind utilities (tailwind-merge). Exports `ConfirmDialog` component. |
| `src/confirm-dialog.tsx` | Radix AlertDialog wrapper — controlled blocking confirm dialog for the ecosystem. Built for exit-flow confirmations (ADR 0003 child 3), styled with shared tokens only, reusable by any app without app-specific token pull-in. |
| `src/tooltip.tsx` | Radix tooltip wrapper, 300ms open delay. Wrap a toolbar in one `TooltipProvider` so the group opens instantly once warm. |

## Conventions
- **Consumed via CSS import**, after `@import "tailwindcss";` in each app's
  `globals.css`: `@import "@repo/ui/styles/theme.css";`. Verified to resolve
  through the Tailwind v4 PostCSS plugin.
- **Only ecosystem-wide tokens live here.** App-specific theme extensions
  (e.g. rough-cut's `--color-surface`, animations, scrollbars) stay in that
  app's own `globals.css`, not in this package.
- **Shared components** (`ConfirmDialog`, `Tooltip`) are styled using only the ecosystem tokens in `theme.css` so they render correctly in any app without app-specific token imports. Each component re-exports via `src/index.ts`.
- **Dependencies**: `@radix-ui/react-alert-dialog` (for `ConfirmDialog`), `@radix-ui/react-tooltip` (for `Tooltip`), `clsx`, and `tailwind-merge`. Radix primitives handle accessibility (focus trap, ESC key, ARIA roles); Tailwind merge ensures class deconflicting in consuming apps.
- No build step — apps import the `.ts`/`.css` source directly (workspace
  package, transpiled by each app's Next build).

## Gotchas
- Changing a token here changes both apps at once — that's the point, but treat
  edits as a design-system change, not a local tweak.

## Related ADRs
- `docs/adr/_root/0001-monorepo-wallet-architecture.md` (decision 6, revised)
