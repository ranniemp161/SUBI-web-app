# Memory — CI Fix, Repo Cleanup & Phase 2 rate_limits Drop

Last updated: 2026-07-08

## What was built

- **Fixed persistent CI failure:** typecheck error `TS18046` at `apps/rough-cut/src/proxy.test.ts:76` — narrowed `response` to `NextResponse` before reading `.status`. Vitest passes without typechecking, so it slipped locally while `tsc --noEmit` failed every push since 12:12. (commit `b12cc82`)
- **Untracked `.turbo` cache:** added `.turbo` to `.gitignore`, `git rm -r --cached` for 83 root + nested `.turbo` files. (commit `b12cc82`)
- **Removed stray artifacts:** deleted `diff.txt` (UTF-16) and `diff_utf8.txt` (UTF-8 twin) — accidental `git diff` dumps committed in `9e1fc30`, no secrets. (commit `b615ff1`)
- **Phase 2 migration:** removed `rateLimits` from `packages/db/src/schema.ts`, generated `packages/db/drizzle/0001_drop_rate_limits.sql` (`DROP TABLE "rate_limits" CASCADE`). (commit `9f9774d`)

## Decisions made

- `.turbo` cache/logs must never be tracked — regenerated per build, causes phantom diffs. Use Remote Caching (or Vercel's own) instead of git.
- Phase 2 drop was safe to generate/merge now; the two-phase "drain old containers" caution does NOT apply because the app has never been deployed — no live containers write to the table.

## Problems solved

- Root cause of 5 consecutive red CI runs = single unfixed typecheck error (earlier runs also had a `wallet#lint` failure, since fixed). Lint/test were green; only typecheck failed.
- `gh` is now authenticated (account `ranniemp161`), so CI logs are pullable via `gh run view --log-failed`.

## Current state

- All work committed and pushed to `main`; CI green on all pushes (runs `28904245144`, `28904688077`).
- **App has never been deployed to Vercel.** Green CI with no deploy is healthy and expected.
- Phase 2 migration is generated/merged but **NOT applied to any prod DB** — the `DROP TABLE` only runs when migrations are applied on deploy.

## Next session starts with

- When ready to deploy: work the Vercel deploy-readiness checklist (saved to persistent memory `project_vercel_deploy_readiness.md`). Key gate: provision + link Vercel KV stores (rate limiter crashes on startup without `KV_REST_API_*`); set cross-app URL vars (fail prerender if missing/localhost).

## Open questions

- Which migrate mechanism actually reaches prod Postgres: `packages/db` generate/migration-files vs rough-cut's `db:push` (schema-diff)? Confirm before applying the drop.
- Non-blocking: CI actions (`checkout@v4`, `setup-node@v4`) target deprecated Node 20 — bump to `@v5` eventually.
