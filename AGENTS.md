<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# SUBI

## Stack
Turborepo monorepo (npm workspaces: `apps/*`, `packages/*`). Node 22, TypeScript, Next.js 16 across all apps, Drizzle ORM + Neon Postgres (HTTP driver) shared via `packages/db`, Clerk (multi-domain SSO), Stripe (Wallet app only), Upstash Redis / Vercel KV for rate limiting, Sentry for error tracking (env-gated).

## Commands
```bash
npm run dev         # turbo dev — runs all apps (rough-cut :3000, wallet :3001, founders-frame :3002, broll :3003)
npm run build       # turbo build
npm run lint        # turbo lint
npm run typecheck   # turbo typecheck
npm run test        # turbo test
```
Scope any command to one workspace with `-w`, e.g. `npm run dev -w @repo/rough-cut` or `npm run dev -w wallet`.

## Build approach
Tracer Bullet — vertical slices; each feature built end-to-end through every layer, working. (Set by `/scope`; see `docs/scope/index.md` and the `**Build approach:**` line on each workspace scope.)

## Rules
- Ports are pinned: rough-cut = 3000, wallet = 3001, founders-frame = 3002, broll = 3003. Cross-app URLs must go through each app's `src/lib/env.ts`, never a raw `process.env.NEXT_PUBLIC_*` read.
- Production domains: rough-cut = `myfirstcut.app`, wallet = `myframecredits.app`; founders-frame is the marketing site. How a missing URL env var is handled differs per app: rough-cut and wallet throw at import time, founders-frame falls back to the production domain in a production build and to `localhost` otherwise.
- Schema changes go through `packages/db` only (`db:generate` + `db:migrate`, prod-safe); `db:push` is dev-only, never prod. See `packages/db/AGENTS.md`.
- **Time-to-frame conversion has exactly one implementation, in `@repo/transcript`.** Every app converts through it, so two apps can never round the same timecode differently — the guarantee that a clip labelled 2:35 really sits at 2:35. `apps/rough-cut/src/lib/frame-math.ts` and `src/lib/export/timebase.ts` survive only as one line re-export shims; never reimplement the arithmetic behind them.
- Currency is US dollars stored as `micros` (1,000,000 micros = $1) — a universal unit multiple future apps can spend against a shared ledger in `@repo/db`. The retail rate and the micros-to-dollars conversions have one home too, `@repo/billing/pricing`; a client component imports that subpath (it is pure), never the `@repo/billing` barrel, which reaches the database.
- **Balance mutations have exactly one implementation, in `@repo/billing`.** Every app charges, holds, settles, refunds, and deposits through it; no app may re-implement a ledger statement locally. This rule exists because the logic used to live twice, once per app, and the copies drifted in silence — rough-cut's `chargeAiCut` gained `ON CONFLICT` idempotency while wallet's kept an unguarded `UPDATE`, and wallet's whole copy was dead code no test covered. Two copies of a money invariant do not stay in sync.
- The Wallet app (`apps/wallet`) is the sole authority on Stripe billing; other apps never process payments directly, they deep-link to Wallet.
- **Lint & Mocking**: When mocking components with `forwardRef` in tests, avoid anonymous arrow functions. Always use a named function expression (e.g., `forwardRef(function MyStub() { ... })`) to prevent `react/display-name` ESLint errors. Omit unused parameters in mock implementations (like `props`, `ref`, `url`, `init`) to avoid `@typescript-eslint/no-unused-vars` warnings/errors.
- **Next.js 16 Middleware**: In Next.js 16, the global routing interception file has been renamed from `middleware.ts` to `proxy.ts`. Do not flag `proxy.ts` as an error or attempt to rename it to `middleware.ts`.
- **IP Rate Limiting**: The `getClientIp` function in `ip-rate-limit.ts` trusts the first entry of the `X-Forwarded-For` header. The application must be deployed on Vercel Edge or a provider that properly sanitizes the `X-Forwarded-For` header to prevent IP spoofing.
- **Vercel Hobby plan caps cron jobs at once per day.** `vercel.json`'s `/api/cron/autorecharge` runs `0 5 * * *` (not every few minutes as originally built) because the deploy is on Hobby. This is an intentional, documented tradeoff (see `docs/adr/_root/0002-usd-wallet/0002-auto-recharge.md` Follow-up) — not a bug. Restore a tighter cadence once the project is on a plan without the daily cap.
- **A server secret set in Vercel is not automatically visible to the build.** `turbo.json`'s `build` task only forwards env vars it lists by name (see the `env` array). A secret missing from that list reads as `undefined` during `next build` even though it is set in the Vercel project, with no error. `PUSHER_APP_ID`/`PUSHER_SECRET` were added there after hitting this; add any new server secret the build step needs to the same list.
- **A `"use server"` module may export nothing but async functions. Not even a type.** TypeScript erases `export type { X }` and so does webpack, but Turbopack's server actions transform does not: it reads the name as one more runtime export and emits `registerServerReference(X, ...)` against an identifier that exists only in the type system. The module then throws `ReferenceError: X is not defined` the moment it is evaluated, so every call to every action in it answers 500. No gate catches this. `lint`, `typecheck` and `test` never evaluate a built server chunk, `next build` compiles it happily, and the e2e suite is unauthenticated so it never calls an action. It cost a live production outage on the dashboard (PR #122), and it was invisible locally because Rough Cut's `dev` script still passed `next dev --webpack` while production built with Turbopack — that flag is gone (PR #124), so all three apps now develop on the bundler they ship with. **Keep it that way**: a dev server on a different bundler than the build is how this class of bug hides. `apps/rough-cut/src/app/actions.test.ts` now guards every `"use server"` module against it; keep shared types in the module they belong to (here `src/lib/projects.ts`) and import them from there.
- **`tsconfig.base.json` must stay in step with the apps' `tsconfig.json`, and `target` is the dangerous field.** Every `packages/*` workspace has a `tsconfig.json` extending the root `tsconfig.base.json`, plus a `typecheck` script, so each package is checked on its own. That checking config does not build anything: a shared package is still consumed as raw TypeScript and compiled by **each consuming app** under that app's config. So if the base is ever looser than an app's config, a package passes its own typecheck and then fails inside the app, which is worse than not checking it at all. `target` is `ES2017`, below ES2020, which is why `BigInt` cannot be used inside a shared package (see `packages/transcript/AGENTS.md`). Before loosening anything here, change the apps first. All five packages also have a `test` script, and both gates run through the `check` job on `main`. Packages have no ESLint config, so `lint` still covers the three apps only, which `lint-staged.config.mjs` documents.

## Git workflow
`main` is branch-protected: direct pushes are blocked (including for admins), and a PR can only merge once every required status check is green. Five are required today — `check` (the CI job: lint + typecheck + test), the three Vercel production builds (`Vercel – subi-web-app-rough-cut`, `-wallet`, `-founders-frame`; note the en dash), and `GitGuardian Security Checks`. The Vercel builds gate because `main` auto-deploys to Production, so a build that fails after merge is a broken production deploy. The list lives in GitHub's branch protection settings, not in this repo; read it from the API rather than trusting this line (`gh api repos/:owner/:repo/branches/main/protection --jq '.required_status_checks.contexts'`). Every change — AI-made or human-made — goes through a branch and a PR. No exceptions, no `--no-verify`.

**Steps for every change:**
1. Sync first: `git checkout main && git pull`
2. Branch off main: `git checkout -b <type>/<short-description>` (naming convention below)
3. Make the change, committing as you go. Keep fixing mistakes on the *same* branch — don't open a new branch for a correction to work that hasn't merged yet.
4. Before pushing, run the same checks CI runs: `npm run lint && npm run typecheck && npm run test`
5. Push and open a PR: `git push -u origin <branch-name>` then `gh pr create`
6. Wait for **every required status check** to go green on the PR, not just `check` — the Vercel production builds and the secret scan are gates too. `gh pr view <n> --json statusCheckRollup` lists what reported; the branch-protection API (above) says which of those actually block the merge.
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
- [apps/founders-frame/AGENTS.md](./apps/founders-frame/AGENTS.md) — static marketing site (no accounts, no DB)
- [apps/broll/AGENTS.md](./apps/broll/AGENTS.md) — B-roll generator: transcript plus photo to a folder of timecode-named clips (port 3003)
- [packages/billing/AGENTS.md](./packages/billing/AGENTS.md) — the only implementation of the money invariant: rates, metering, and every ledger statement
- [packages/db/AGENTS.md](./packages/db/AGENTS.md) — shared Drizzle schema, migrations, DB connection
- [packages/transcript/AGENTS.md](./packages/transcript/AGENTS.md) — the cross-app transcript document contract and the repo's only frame arithmetic
- [packages/ui/AGENTS.md](./packages/ui/AGENTS.md) — thin shared design tokens + cn() helper
- [packages/server-shared/AGENTS.md](./packages/server-shared/AGENTS.md) — shared rate limiting and error reporting

## Agent skills
The workflow skills this repo assumes, all from `JavaScript-Mastery-Pro/skills` (pinned in the tracked [skills-lock.json](./skills-lock.json)). The files themselves are **machine-local**: they live in `.agents/skills/<name>/`, which is gitignored, and `.claude/skills/<name>` is a symlink to it. A fresh clone has none of them — reinstall from the lock file. An installer that writes to `.claude/skills/<name>/SKILL.md` follows that symlink and overwrites the real file, which is how the AI Blueprint overlay silently replaced `check` and `audit` on 2026-08-11; both were restored from source on 2026-08-12.
- [.agents/skills/scope/](./.agents/skills/scope/) — the live plan in `docs/scope/`; seeds *what* to build
- [.agents/skills/architect/](./.agents/skills/architect/) — settles a load-bearing decision, writes the spec to `docs/specs/`
- [.agents/skills/develop/](./.agents/skills/develop/) — builds from an approved spec, advances the scope
- [.agents/skills/check/](./.agents/skills/check/) — `verify` drives the real app against the spec; `review` is a fresh-model code review
- [.agents/skills/test/](./.agents/skills/test/) — writes the suite for what was just built
- [.agents/skills/debug/](./.agents/skills/debug/) — root-cause loop plus a regression test
- [.agents/skills/audit/](./.agents/skills/audit/) — bootstraps and maintains the `AGENTS.md` files every other skill reads
- [.agents/skills/sync/](./.agents/skills/sync/) — post-merge reconciliation of `AGENTS.md`, scope, and spec statuses
- [.agents/skills/document/](./.agents/skills/document/) — PR text, changelogs, release notes

Declined: next, react, typescript, turborepo, drizzle, neon, clerk, stripe, upstash-redis, vercel-kv, sentry, vitest, playwright, tailwind — the stack is settled and documented above, so skill/MCP discovery should not re-offer these on a dependency bump. Ask before adding a genuinely new tool.

**Do not install a workflow overlay that brings its own plan files.** `docs/scope/` is the single live plan (see [docs/scope/index.md](./docs/scope/index.md)); a second plan tree is the hand-mirroring problem that retired `docs/roadmap/`.
