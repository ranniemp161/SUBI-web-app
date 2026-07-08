# 0001: Monorepo & Centralized Wallet Architecture

**Date**: 2026-07-06
**Updated**: 2026-07-08
**Status**: Accepted
**Scope**: Repo-wide (All apps)

## Implementation status (2026-07-08)

Decisions 1 to 5 are built and in the codebase. Decision 6 was revised on
2026-07-08 to match what Tailwind v4 and the real code actually allow (see the
revised decision below) and is the one remaining piece to build.

| Decision | Status |
|---|---|
| 1. Turborepo monorepo | Built (`turbo.json`, npm workspaces `apps/*`, `packages/*`) |
| 2. Shared `packages/db` | Built (Drizzle schema/connection shared via `@repo/db`) |
| 3. Universal `tokens` currency | Built, then **superseded by [0002](0002-usd-wallet/index.md)** — balance is being redenominated from `tokens` to USD (micros) |
| 4. Clerk multi-domain SSO | Built (both apps on Clerk) |
| 5. Stripe billing in Wallet | Built (checkout + webhook live in `apps/wallet`) |
| 6. `packages/ui` shared UI | Revised (thin shared theme, see below) — not yet built |

Note: `packages/config-typescript` (mentioned in the build plan) was not created;
each app keeps its own `tsconfig`. Not planned unless duplication becomes a problem.

## Context
The client envisions a multi-product ecosystem containing Rough Cut, Thumbnails, and Infographics tools. To facilitate this, a centralized "Wallet" application is required to act as the universal billing portal. The current infrastructure is a single Next.js monolith (`SUBI-web-app`) tracking `credit_seconds`. 

This ADR defines the foundational architecture for restructuring the codebase to support multiple applications sharing a single billing and database backend.

## Requirements
- The Wallet app must serve as the central hub for purchasing and viewing credits.
- The Rough Cut app (and future apps) must be able to deduct credits from the user's balance.
- The UI, Database, and Authentication must be perfectly synchronized across all applications without copy-pasting code.
- The infrastructure must remain cost-effective on Vercel/Neon free tiers.

## Decisions

### 1. Monorepo Build System: Turborepo
We will restructure the `SUBI-web-app` repository into a Turborepo. 
- **Why**: It is the industry standard for Next.js monorepos, providing fast build caching and native support on Vercel.

### 2. Database Sharing: `packages/db`
The Drizzle ORM schema, migrations, and database connection logic will be extracted from the main app into a shared internal package (`packages/db`).
- **Why**: Prevents schema duplication. Both apps can import `@repo/db` and be guaranteed to read/write the exact same data structure.

### 3. Universal Currency: Tokens — SUPERSEDED by [0002](0002-usd-wallet/index.md) (2026-07-08)
We will migrate the database schema from `credit_seconds` to a universal `tokens` currency. 
- **Why**: A time-based currency ("seconds") cannot be used to purchase static assets like images or infographics. A universal "token" allows each app to define its own exchange rate (e.g., 100 tokens = 1 min video, 50 tokens = 1 image).
- **Superseded**: The balance is being redenominated directly in **US dollars** (stored as integer USD micros). Money is more universal than a token and still lets each app price its own service, so the token abstraction is collapsed into money. See [0002 USD-denominated Wallet](0002-usd-wallet/index.md). Decisions 1, 2, 4, 5, 6 of this ADR are unaffected.

### 4. Authentication: Clerk Multi-Domain SSO
We will configure Clerk for Multi-Domain SSO. 
- **Why**: Allows users to log into the Wallet app to top up, and seamlessly access the Rough Cut app without needing to log in again.

### 5. Stripe Billing: Migrated to Wallet App
The Stripe Checkout and Webhook endpoints currently in the Rough Cut app will be moved entirely to the Wallet app.
- **Why**: The Wallet app is the centralized billing portal and should be the sole authority on processing payments and updating the user's token balance.

### 6. UI System: `packages/ui` — thin shared theme (revised 2026-07-08)
This decision originally called for extracting Tailwind config and Shadcn UI components into `packages/ui`. On build, three facts made that premise wrong:
- **Tailwind is v4 (CSS-first).** There is no `tailwind.config.js` to share as a JS module; config lives in each app's `globals.css` via `@import "tailwindcss"` + `@theme inline`. "Share the Tailwind config" now means sharing a CSS theme block, not a config file.
- **No Shadcn is installed** (no `components.json`, no Radix, no `cva`/`tailwind-merge`), and the existing components in `apps/rough-cut/src/components` are video-editor domain UI (timeline, transcript panel, video player), not reusable primitives. `apps/wallet` has no shared components at all.
- **The only real duplication** is a ~20-line base theme block (light/dark `--background`/`--foreground`, fonts, `body` reset) copied between the two `globals.css` files.

**Revised decision**: `packages/ui` ships a **thin shared theme now** — a `src/styles/theme.css` holding the common design tokens (colors, fonts, dark mode, focus-visible ring), imported by both apps' `globals.css`, plus a small `cn()` helper (clsx + tailwind-merge). A shared **component library is deferred** until a second app actually needs a shared primitive (extract on demand).
- **Why**: Keeps the one real design-system source of truth (the tokens) in sync across apps — satisfying the cohesion goal — without building a speculative component library for components that do not exist yet (YAGNI). When a shared primitive is genuinely needed, it is added to this package then.

## Build Plan (Implementation Steps)

1. **Turborepo Scaffolding:** Initialize `turbo.json`, `package.json` workspaces, and move the existing app into `apps/rough-cut`.
2. **Shared Packages Extraction:** Create `packages/db` (move Drizzle schema) [done]. `packages/ui` is a **thin shared-theme package** (`src/styles/theme.css` tokens + a `cn()` helper), not a Tailwind/Shadcn component extraction — see revised decision 6; component extraction deferred. `packages/config-typescript` was not created (each app keeps its own `tsconfig`).
3. **Database Migration:** Rename `credit_seconds` to `tokens` in `packages/db` and run the Drizzle migration. Update logic in `apps/rough-cut` to consume tokens instead of seconds.
4. **Wallet App Initialization:** Run `create-next-app` inside `apps/wallet`. Install Clerk and configure SSO.
5. **Stripe Migration:** Move `/api/billing/checkout` and `/api/webhooks/stripe` from `apps/rough-cut` to `apps/wallet`.
6. **Wallet UI Construction:** Build the dashboard, balance display, and top-up cards in `apps/wallet`.
