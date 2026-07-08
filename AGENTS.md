<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# SUBI

## Stack
Turborepo monorepo (npm workspaces: `apps/*`, `packages/*`). Node 22, TypeScript, Next.js 16 across all apps, Drizzle ORM + Neon Postgres (HTTP driver) shared via `packages/db`, Clerk (multi-domain SSO), Stripe (Wallet app only), Upstash Redis / Vercel KV for rate limiting, Sentry for error tracking (env-gated).

## Commands
```bash
npm run dev         # turbo dev — runs all apps (rough-cut :3000, wallet :3001)
npm run build       # turbo build
npm run lint        # turbo lint
npm run typecheck   # turbo typecheck
npm run test        # turbo test
```
Scope any command to one workspace with `-w`, e.g. `npm run dev -w @repo/rough-cut` or `npm run dev -w wallet`.

## Build approach
Tracer Bullet — vertical slices; each feature built end-to-end through every layer, working. (Set by `/roadmap`; see `docs/roadmap/rough-cut/roadmap.md`.)

## Rules
- Ports are pinned: rough-cut = 3000, wallet = 3001. Cross-app URLs must go through each app's `src/lib/env.ts`, never a raw `process.env.NEXT_PUBLIC_*` read.
- Schema changes go through `packages/db` only (`db:generate` + `db:migrate`, prod-safe); `db:push` is dev-only, never prod. See `packages/db/AGENTS.md`.
- Currency is `tokens` (not `credit_seconds` / time-based) — a universal unit multiple future apps can spend against a shared ledger in `@repo/db`.
- The Wallet app (`apps/wallet`) is the sole authority on Stripe billing; other apps never process payments directly, they deep-link to Wallet.

## ADRs
Stored in `docs/adr/`. Format: `docs/adr/NNNN-title.md`.
- [docs/adr/_root/0001-monorepo-wallet-architecture.md](./docs/adr/_root/0001-monorepo-wallet-architecture.md) — monorepo restructuring, shared `packages/db`, universal tokens currency, Clerk SSO, Stripe-in-Wallet

## Context files
- [apps/rough-cut/AGENTS.md](./apps/rough-cut/AGENTS.md) — video transcription + AI cutting product app
- [apps/wallet/AGENTS.md](./apps/wallet/AGENTS.md) — centralized billing/credits app
- [packages/db/AGENTS.md](./packages/db/AGENTS.md) — shared Drizzle schema, migrations, DB connection
- [packages/ui/AGENTS.md](./packages/ui/AGENTS.md) — thin shared design tokens + cn() helper
