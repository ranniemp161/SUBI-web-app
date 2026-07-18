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
- Currency is US dollars stored as `micros` (1,000,000 micros = $1) — a universal unit multiple future apps can spend against a shared ledger in `@repo/db`.
- The Wallet app (`apps/wallet`) is the sole authority on Stripe billing; other apps never process payments directly, they deep-link to Wallet.
- **Lint & Mocking**: When mocking components with `forwardRef` in tests, avoid anonymous arrow functions. Always use a named function expression (e.g., `forwardRef(function MyStub() { ... })`) to prevent `react/display-name` ESLint errors. Omit unused parameters in mock implementations (like `props`, `ref`, `url`, `init`) to avoid `@typescript-eslint/no-unused-vars` warnings/errors.
- **Next.js 16 Middleware**: In Next.js 16, the global routing interception file has been renamed from `middleware.ts` to `proxy.ts`. Do not flag `proxy.ts` as an error or attempt to rename it to `middleware.ts`.
- **IP Rate Limiting**: The `getClientIp` function in `ip-rate-limit.ts` trusts the first entry of the `X-Forwarded-For` header. The application must be deployed on Vercel Edge or a provider that properly sanitizes the `X-Forwarded-For` header to prevent IP spoofing.
- **Vercel Hobby plan caps cron jobs at once per day.** `vercel.json`'s `/api/cron/autorecharge` runs `0 5 * * *` (not every few minutes as originally built) because the client-preview deploy is on Hobby. This is an intentional, documented tradeoff (see `docs/adr/_root/0002-usd-wallet/0002-auto-recharge.md` Follow-up) — not a bug. Restore a tighter cadence once the project is on a plan without the daily cap.
- **A server secret set in Vercel is not automatically visible to the build.** `turbo.json`'s `build` task only forwards env vars it lists by name (see the `env` array). A secret missing from that list reads as `undefined` during `next build` even though it is set in the Vercel project, with no error. `PUSHER_APP_ID`/`PUSHER_SECRET` were added there after hitting this; add any new server secret the build step needs to the same list.

## Git workflow
`main` is branch-protected: direct pushes are blocked (including for admins), and a PR can only merge once the `check` CI job (lint + typecheck + test) is green. Every change — AI-made or human-made — goes through a branch and a PR. No exceptions, no `--no-verify`.

**Steps for every change:**
1. Sync first: `git checkout main && git pull`
2. Branch off main: `git checkout -b <type>/<short-description>` (naming convention below)
3. Make the change, committing as you go. Keep fixing mistakes on the *same* branch — don't open a new branch for a correction to work that hasn't merged yet.
4. Before pushing, run the same checks CI runs: `npm run lint && npm run typecheck && npm run test`
5. Push and open a PR: `git push -u origin <branch-name>` then `gh pr create`
6. Wait for the `check` CI job to go green on the PR.
7. Merge the PR (`gh pr merge` or the GitHub UI). No second reviewer is required (solo project), but CI must be green — this is enforced server-side, not optional.
8. After merge: `git checkout main && git pull`, then delete the local branch (`git branch -d <branch-name>`).

**Branch naming convention** — `<type>/<kebab-case-description>`:
| Type | Use for |
|---|---|
| `feat/` | New functionality (e.g. `feat/transcript-search`) |
| `fix/` | Bug fixes (e.g. `fix/deepgram-retry-loop`) |
| `chore/` | Tooling, deps, config, CI (e.g. `chore/bump-turbo`) |
| `refactor/` | Restructuring with no behavior change |
| `test/` | Test-only additions/changes |
| `docs/` | Documentation-only changes |

One branch per logical unit of work — if the change needs a sentence to describe ("add transcript search," not "update code"), that's one branch. Don't branch per commit or per file; do branch per independent feature/fix so each PR is reviewable and revertable on its own.

## ADRs
Stored in `docs/adr/`. Format: `docs/adr/NNNN-title.md`.
- [docs/adr/_root/0001-monorepo-wallet-architecture.md](./docs/adr/_root/0001-monorepo-wallet-architecture.md) — monorepo restructuring, shared `packages/db`, universal currency, Clerk SSO, Stripe-in-Wallet
- [docs/adr/_root/0002-usd-wallet/index.md](./docs/adr/_root/0002-usd-wallet/index.md) — USD-denominated wallet, money ledger in micros, auto-recharge, and premium UI

## Context files
- [apps/rough-cut/AGENTS.md](./apps/rough-cut/AGENTS.md) — video transcription + AI cutting product app
- [apps/wallet/AGENTS.md](./apps/wallet/AGENTS.md) — centralized billing/credits app
- [packages/db/AGENTS.md](./packages/db/AGENTS.md) — shared Drizzle schema, migrations, DB connection
- [packages/ui/AGENTS.md](./packages/ui/AGENTS.md) — thin shared design tokens + cn() helper
- [packages/server-shared/AGENTS.md](./packages/server-shared/AGENTS.md) — shared rate limiting and error reporting
