# 0001: Monorepo & Centralized Wallet Architecture

**Date**: 2026-07-06
**Status**: Proposed
**Scope**: Repo-wide (All apps)

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

### 3. Universal Currency: Tokens
We will migrate the database schema from `credit_seconds` to a universal `tokens` currency. 
- **Why**: A time-based currency ("seconds") cannot be used to purchase static assets like images or infographics. A universal "token" allows each app to define its own exchange rate (e.g., 100 tokens = 1 min video, 50 tokens = 1 image).

### 4. Authentication: Clerk Multi-Domain SSO
We will configure Clerk for Multi-Domain SSO. 
- **Why**: Allows users to log into the Wallet app to top up, and seamlessly access the Rough Cut app without needing to log in again.

### 5. Stripe Billing: Migrated to Wallet App
The Stripe Checkout and Webhook endpoints currently in the Rough Cut app will be moved entirely to the Wallet app.
- **Why**: The Wallet app is the centralized billing portal and should be the sole authority on processing payments and updating the user's token balance.

### 6. UI System: `packages/ui`
Tailwind configurations and Shadcn UI components will be extracted into a shared `packages/ui` folder.
- **Why**: Guarantees a cohesive design system across all products. A button updated in the UI package instantly updates in all apps.

## Build Plan (Implementation Steps)

1. **Turborepo Scaffolding:** Initialize `turbo.json`, `package.json` workspaces, and move the existing app into `apps/rough-cut`.
2. **Shared Packages Extraction:** Create `packages/db` (move Drizzle schema), `packages/config-typescript`, and `packages/ui` (move Tailwind/Shadcn). Update import paths in `apps/rough-cut`.
3. **Database Migration:** Rename `credit_seconds` to `tokens` in `packages/db` and run the Drizzle migration. Update logic in `apps/rough-cut` to consume tokens instead of seconds.
4. **Wallet App Initialization:** Run `create-next-app` inside `apps/wallet`. Install Clerk and configure SSO.
5. **Stripe Migration:** Move `/api/billing/checkout` and `/api/webhooks/stripe` from `apps/rough-cut` to `apps/wallet`.
6. **Wallet UI Construction:** Build the dashboard, balance display, and top-up cards in `apps/wallet`.
