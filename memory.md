# Memory — Buy Credits Redirect Fix, Env Hardening & Code Review

Last updated: 2026-07-07 (evening)

## What was built

All uncommitted on `main` (plus two untracked new files):

- **Port pinning**: `apps/rough-cut/package.json` dev script → `next dev --webpack -p 3000`; `apps/wallet/package.json` dev script → `next dev -p 3001`.
- **Env validation modules** (new, untracked): `apps/rough-cut/src/lib/env.ts` (exports `WALLET_URL`) and `apps/wallet/src/lib/env.ts` (exports `ROUGH_CUT_URL`). Each has a `requiredUrl()` that: dev → localhost fallback; production → throws on missing var; Vercel builds → throws if value contains "localhost".
- **Six call sites migrated** off direct `process.env` reads: rough-cut `credits-panel.tsx`, `dashboard/page.tsx` (2 toast actions), `dashboard/[id]/page.tsx` (1 toast action); wallet `layout.tsx` ("Back to Rough Cut" link), `page.tsx` (home redirect). A grep confirms no direct `NEXT_PUBLIC_*_URL` reads remain outside the env modules.
- Verified: typecheck passes both apps; all 201 rough-cut vitest tests pass.
- A PR description was drafted (title: "fix: pin dev ports to prevent cross-app link mismatches") — in chat only, not yet used; changes are uncommitted.

## Decisions made

- **Intended port layout is locked: rough-cut = 3000, wallet = 3001.** Both apps' `.env.local` files and all code fallbacks now agree with this.
- **Silent env fallbacks are banned as a pattern** — cross-app URLs must go through the per-app `src/lib/env.ts` modules. Per-app duplication of the helper is intentional: it matches the repo's established pattern (`observability.ts`, `rate-limit.ts`, `authz.ts` are byte-identical across apps).
- The localhost-rejection check is gated on `process.env.VERCEL` deliberately so local `next build` (which loads `.env.local`) still succeeds — but see open questions: the review found this gate unreliable.

## Problems solved

- **"Buy credits" opened rough-cut's own dashboard instead of wallet.** Root cause was NOT the env var or the fallback constant: it was a dev port race. Neither dev script pinned a port, both default to 3000, `turbo dev` start order decided who got bumped to 3001 — when wallet won 3000, every cross-app URL pointed at the wrong app. Proven live via curl (wallet was on 3000, rough-cut on 3001). Fixed by pinning `-p` in both dev scripts. **Dev servers must be restarted for the fix to take effect — user had not yet confirmed the restart.**
- Also fixed en route: `credits-panel.tsx` fallback said 3000 (wrong) vs the three toast actions' 3001; wallet's `layout.tsx`/`page.tsx` fallbacks said 3001 (pointing at wallet itself) — all aligned now.
- `gh` CLI is installed but NOT authenticated (`gh auth login` needed before Claude can create PRs).

## Current state

- Git: local `main` is **ahead 1 (e1d6457), behind 2** vs `origin/main` — still needs `git pull` then push. This session's fix (7 modified files + 2 untracked env.ts) is uncommitted on top.
- A high-effort `/code-review` of the working tree reported **10 findings** (8-angle multi-agent review). Top 3, unfixed:
  1. **The `VERCEL`-gated localhost guard in both env.ts files likely never fires where it matters** — not inlined into client bundles, possibly stripped by Turborepo strict env mode (turbo.json declares no env/globalEnv), absent on non-Vercel hosts, and dynamic routes skip build-time evaluation. Recommended fix: validate in `next.config.ts` instead.
  2. **`apps/wallet/src/app/api/billing/checkout/route.ts:83-90` (Stripe money path) still uses unvalidated `PUBLIC_APP_URL`, which is NOT set in wallet/.env.local — dev checkout returns 500 "Server configuration error" right now.** Should consume the validated `ROUGH_CUT_URL` or a server-side sibling.
  3. **Wallet root layout imports env.ts at module scope with no error.tsx/global-error.tsx anywhere** — a missing var in a dynamic-render context 500s every wallet route including sign-in.
  Remaining findings: rough-cut `.env.example` missing `NEXT_PUBLIC_WALLET_URL` (now build-required), wallet has no `.env.example` at all; `next dev` auto-increments when a pinned port is busy (race not fully dead); localhost check is substring-only (misses 127.0.0.1); `docs/roadmap/rough-cut/roadmap.md:18` says wallet is at localhost:3000 (now wrong); wallet `README.md:17` says open localhost:3000 (wrong); wallet "/" is not in proxy.ts isPublicRoute so the home redirect is unreachable signed-out; `${WALLET_URL}/dashboard` duplicated at 4 sites (export a `WALLET_DASHBOARD_URL`).

## Next session starts with

1. Ask the user whether "Buy credits" now works after restarting dev servers (rough-cut on 3000, wallet on 3001) — the fix was never runtime-verified.
2. Fix the top code-review findings: move localhost/missing-var validation into each app's `next.config.ts`; migrate the checkout route off `PUBLIC_APP_URL` (and set it or kill it in dev); add error boundary or move the wallet layout import; update `.env.example` files, README, roadmap line.
3. Then commit: `git pull` first (behind 2), then commit the fix (PR body already drafted in the prior session's chat — regenerate with /document if lost).

## Open questions

- Does dev "Buy credits" actually work post-restart? (Not yet confirmed by user.)
- Is `PUBLIC_APP_URL` set on the wallet Vercel project? Are `NEXT_PUBLIC_WALLET_URL` / `NEXT_PUBLIC_ROUGH_CUT_URL` set on the respective Vercel projects? A missing one will now fail the build (by design) — verify before next deploy.
- Whether to adopt `new URL()` parsing + hostname denylist (127.0.0.1, ::1, etc.) instead of the substring localhost check — zod is already a dependency of both apps.
- Prior session's still-open items: verify bundle pricing math against the tokens=seconds unit (partially confirmed: `apps/rough-cut/src/lib/credits.ts` doc says 1 credit = 1 second, columns all match live schema — pricing math itself unchecked); wallet e2e checkout flow untested.
