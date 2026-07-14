# Memory — Studio auto-cut flow (ADR 0003, merged) + server-shared extraction (in progress)

Last updated: 2026-07-12

## What was built

### ADR 0003 Studio auto-cut flow — done, merged (prior session)
- Full `/develop` → `/verify` → `/test` → `/debug` → `/sync` → merge cycle for **ADR 0003, Studio auto-cut flow** (`docs/adr/rough-cut/0003-studio-auto-cut-flow/`), roadmap feature 7 in `docs/roadmap/rough-cut/roadmap.md`. `done`, merged to `client-preview`.
- **Child 1 (auto-cut pipeline)**: `packages/db/src/schema.ts` + migration `0010_watery_vision.sql` add `projects.ai_polish_requested` (now applied to **both dev and prod** — see Current state). `apps/rough-cut/src/lib/validation.ts` (`createProjectSchema.aiPolish`), `src/app/api/projects/route.ts` (persists it), `src/lib/projects.ts` (`claimAiCutSlot` flips the flag false atomically in the same UPDATE as the claim). `src/app/(app)/dashboard/page.tsx` — upload now holds the file selection and shows a confirm panel (combined price, AI-polish toggle default-on) before creating the project. `src/app/(app)/dashboard/[id]/page.tsx` — new `runAutoChain`/auto-chain effect chaining `buildInitialEDL` into `runAiCut(sourceEdl)` under one loader. Removed `RoughCutHero` and the old "all keep" placeholder.
- **Child 2 (AI re-run removal + free restore)**: removed the always-on "AI Cut" rail button and run-list UI (`AiCutRunDisplay`, switch/rename/delete wiring) from the studio page. `src/components/transcript-panel.tsx` shows exactly one of: "Polish with AI", free "Restore AI suggestions" (via `applyAiCuts` divergence check), or neither.
- **Child 3 (exit confirm dialog)**: `packages/ui/src/confirm-dialog.tsx` — new `ConfirmDialog`, first shared component in `@repo/ui` (Radix `@radix-ui/react-alert-dialog`). Replaces the old exit toast; `beforeunload` only attaches while `aiBusy`.
- Tests: new/extended across dashboard page, projects lib, projects route, confirm-dialog (+ `packages/ui/vitest.config.ts`), studio page, transcript-panel. 377 rough-cut / 17 ui tests passing at merge.
- **Merged**: PR #15, `feat/studio-auto-cut` → `client-preview` (merge commit `4c6f652`). Both branches deleted.

### `@repo/server-shared` extraction — uncommitted, in progress (this session)
- New workspace package `packages/server-shared/` (`@repo/server-shared`, added as a dependency to both `apps/rough-cut/package.json` and `apps/wallet/package.json`). Exports `reportError` (from `./observability`) and `rateLimit`/`RateLimitResult` (from `./rate-limit`) via `src/index.ts`, plus subpath exports `@repo/server-shared/observability` and `@repo/server-shared/rate-limit`.
- Deduplicates what used to be near-identical `src/lib/rate-limit.ts` (Upstash fixed-window limiter, `failClosed` option) and `src/lib/observability.ts` (`Sentry.captureException` wrapper) copies in both apps. Each app's local `src/lib/rate-limit.ts` / `observability.ts` is now a thin re-export, with only the app-specific named limiters (e.g. rough-cut's `readRateLimit`, new `aiCutRateLimit` at 10/hour shared across all AI Cut routes per ADR 0002) staying local.
- Old `apps/rough-cut/src/lib/rate-limit.test.ts` and `apps/wallet/src/lib/rate-limit.test.ts` deleted (their coverage moves to `packages/server-shared/src/rate-limit.test.ts`).
- Along the way, also pulled `deleteBlobQuietly` (rough-cut `src/lib/blob.ts`) and `settleHoldQuietly` (rough-cut `src/lib/credits.ts`) out of `transcribe/callback/route.ts` into their owning modules as named exports — same behavior, just de-duplicated from being route-local helpers.
- **Not yet committed.** No commit made this session; `git status` still shows all these files as modified/untracked.

## Decisions made

- Auto-chain (ADR 0003) fires only when `transcriptStatus === "ready" && !savedEdl` — deliberately conjunctive so legacy/manually-edited/already-run projects are provably inert (AC-4, AC-10).
- Kept ADR 0002's `ai_cut_runs` table, claim machinery, and switch/rename/delete routes in place unmodified (the "strangler seam") — only the client stopped calling them. Tracked as deliberate debt in ADR 0003's Follow-up, not pruned this round.
- `verify.md` is the durable, AC-tagged checklist beside each ADR; `/verify` and `/test` both read/write it rather than re-deriving criteria each time.
- `server-shared` keeps the `failClosed` semantics from the original rate-limiter untouched (fail-open for ordinary abuse caps, fail-closed for money-moving paths like the AI Cut idempotency lock) — this is preserved behavior, not a design change.

## Problems solved

- **Real production bug, found via manual testing, root-caused via `/debug`**: studio showed "Rough cut done — 0 silences removed" with an empty timeline, chained AI pass then failed. Root cause: the "processing → ready" poll effect calls `checkStatus()` from both a 4s interval **and** `visibilitychange`/`focus` listeners with no dedup guard — overlapping detections could each bump `reloadNonce`, causing a redundant reload that clobbered the auto-chain's just-applied cut before the 800ms debounced autosave landed. Fixed with a `settled` guard local to each poll-effect instance, a `hasEditedRef.current` skip in reload's EDL-seeding, and an `if (!applyEdl(...)) return;` consistency check in `runAutoChain`. Regression test added.
- **CI-only lint failure, not visible locally**: `react-hooks/set-state-in-effect` on the auto-chain effect — never caught locally because turbo's lint cache was stale. Fixed by deferring the kickoff via `queueMicrotask()`.
- Migration `0010` was tracked as applied by drizzle-kit but the DDL didn't execute against the live dev DB (known drift mode) — applied the column directly via a one-off script, re-ran `db:verify` to confirm.

## Current state

- ADR 0003 is `done` on the roadmap, ADR 0003 index Status is `Accepted`, `verify.md` fully checked. Merged and live on `client-preview`.
- **Prod migration `0010_watery_vision.sql` (`ai_polish_requested` column) has now been applied to prod** (done this session) — the previous session's open item is resolved. Both dev and prod Neon branches are current.
- The `@repo/server-shared` refactor is a real, working but **uncommitted** change on top of that — `git status` shows it as the entire outstanding diff (rate-limit/observability consolidation, blob/credits quiet-helper extraction, new `packages/server-shared/`, package.json + package-lock.json updates).

## Next session starts with

- Decide whether to run the `server-shared` package's tests (`packages/server-shared` has its own `vitest.config.ts` and `rate-limit.test.ts`) plus the full rough-cut/wallet suites, then commit the extraction — it's functionally a pure refactor (no behavior change intended) but hasn't been verified or committed yet this session.
- ADR 0003's Follow-up section still has two queued cleanup items once auto-cut has been live a while: prune the dead run-list routes (`PATCH .../ai-cut/active`, `DELETE .../ai-cut/runs/[runId]`, rename) and consider shrinking `AI_CUT_RUN_LIMIT` (currently 3) — not urgent.

## Open questions

- Is the `server-shared` extraction meant to be its own PR, or folded into whatever the next feature branch is? Not yet decided this session.
- General open items from the broader project (member monthly grant final form, overall prod deploy readiness) are unchanged and tracked in auto-memory, not repeated here.
