# Memory — AI Cut paid re-run (versioned suggestions): built

Last updated: 2026-07-09

## What was built

Ran `/develop ai cut paid re-run` end to end (schema → migration → backend → client → tests) against ADR `docs/adr/rough-cut/0002-ai-cut-paid-rerun/index.md`. This replaces the old single-slot AI Cut result (destroy-to-rerun) with up to 3 stored, versioned runs per project that the user can compare and switch between.

- **Schema** (`packages/db/src/schema.ts`): dropped `projects.ai_cuts` jsonb; added `projects.active_ai_cut_run_id` (FK → new table, `set null`) and `projects.ai_cut_claim_at` (decoupled claim, replaces the old pending-sentinel-in-jsonb trick); added `ai_cut_runs` table (`project_id` FK cascade, `run_number`, `ranges`, `model`, `created_at`, unique on `(project_id, run_number)`).
- **Migration**: `packages/db/drizzle/0005_ai_cut_runs.sql` — hand-written (not via `drizzle-kit generate`, see Problems solved), backfills any non-empty existing `ai_cuts` into `ai_cut_runs` run 1 + sets it active, then drops the old column. **Applied and confirmed live** on the dev DB (backfilled 7 existing rows).
- **`lib/projects.ts`**: rewrote `claimAiCutSlot`/`releaseAiCutClaim` against `ai_cut_claim_at`; added `countAiCutRuns`, `createAiCutRun` (atomic insert + set-active + clear-claim in one SQL statement), `listAiCutRuns`, `getAiCutRun`, `setActiveAiCutRun`, `deleteAiCutRunAndRenumber`.
- **Routes**: `ai-cut/route.ts` POST rewritten (cap check before claim, claim, charge, run Gemini, `createAiCutRun`, return the run — old whole-project DELETE removed); new `ai-cut/active/route.ts` PATCH (switch active run); new `ai-cut/runs/[runId]/route.ts` DELETE (blocks deleting the active run, renumbers on delete); `api/projects/[id]/route.ts` GET now also returns `aiCutRuns` (full list).
- **Client** (`page.tsx`): `Project` type now carries `activeAiCutRunId` + `aiCutRuns[]` instead of `aiCuts`; status bar shows a run-number chip list (click to switch with a discard-manual-edits confirm toast, eraser to delete a non-active run with its own confirm toast); `runAiCut` success now appends the new run and sets it active; new 409 codes `AI_CUT_RUN_LIMIT_REACHED`/`AI_CUT_RUN_IS_ACTIVE` surfaced with their own toasts (old `AI_CUT_ALREADY_RUN` handling removed since re-runs are now always allowed under the cap).
- **Tests**: rewrote `ai-cut/route.test.ts` for the new POST shape; added `ai-cut/active/route.test.ts` and `ai-cut/runs/[runId]/route.test.ts`; updated `api/projects/[id]/route.test.ts` (mock `listAiCutRuns`) and `page.test.tsx` (new run-list UI, switch/delete confirm flows). Full suite: **292 tests green**, typecheck clean.
- Roadmap (`docs/roadmap/rough-cut/roadmap.md`) feature 3: Design + Build (+ all 4 milestones) ticked, code pointer filled; **Verify/Test deliberately left unticked**. ADR `Status` line: `Proposed` → `In Progress`. `verify.md` written beside the ADR (promoted `0002-ai-cut-paid-rerun.md` → `0002-ai-cut-paid-rerun/index.md` + `verify.md`; roadmap's ADR link repointed).

## Decisions made

- Migration was **hand-written**, not from `drizzle-kit generate` — see Problems solved. Manually kept `drizzle/meta/0005_snapshot.json` and `_journal.json` in sync so a later `db:generate` sees no drift (verified this after writing it).
- Kept the atomic-claim discipline this codebase already uses (`reserveCredits`, the old `claimAiCutSlot`) but **decoupled the claim from the stored result** entirely (own `ai_cut_claim_at` column) instead of the old "valid-shaped pending sentinel in jsonb" trick — this was the ADR's explicit rationale, not a choice made here.
- `createAiCutRun` does the next-run-number computation + insert + set-active + claim-clear as **one SQL statement** (CTE chain) rather than multiple round trips, matching the Neon HTTP driver's no-transaction/single-statement-atomicity convention documented in `apps/rough-cut/AGENTS.md`.
- Client UI for the run list is a minimal inline chip row (no new Dialog primitive — this app deliberately has none, confirm/cancel via sonner action-toasts like every other destructive action here).

## Problems solved

- `npm run db:generate` requires an interactive TTY prompt (Drizzle's rename-vs-drop/add disambiguation) and this shell environment has no TTY — `winpty` couldn't attach either (`npm.cmd`/`npm-cli.js` both failed with "stdin is not a tty"). Worked around by hand-writing the migration SQL **and** hand-writing the matching `meta/0005_snapshot.json` + `_journal.json` entry in the exact format Drizzle expects (copied the format from `0004_snapshot.json`), then verified with `db:generate` afterward that it reports "No schema changes, nothing to migrate" — confirming the hand-written snapshot exactly matches what `schema.ts` would have produced.
- Circular FK (`projects.active_ai_cut_run_id` → `ai_cut_runs.id`, `ai_cut_runs.project_id` → `projects.id`) resolved in Drizzle via a lazy arrow-function reference (`.references((): AnyPgColumn => aiCutRuns.id, ...)`) since `aiCutRuns` is declared later in the file — standard Drizzle pattern for circular table refs.

## Current state

- All code is **uncommitted** in the working tree (branch `main`), including the untracked ADR that was already present when this session started (`docs/adr/rough-cut/0002-ai-cut-paid-rerun.md`, now moved to `.../0002-ai-cut-paid-rerun/index.md` plus a new `verify.md`) and modified `docs/roadmap/index.md` / `docs/roadmap/rough-cut/roadmap.md`.
- Migration **is applied to the dev DB** already (not just generated) — `ai_cuts` column is gone, `ai_cut_runs` table is live with 7 backfilled rows. Prod is not yet deployed (per earlier project memory), so no prod migration step is pending yet.
- Build, typecheck, and full test suite are green. `/verify` and `/test` have **not** been run this session — roadmap intentionally shows the feature still `in-progress` (Build ticked, Verify/Test not).

## Next session starts with

- Run `/verify ai cut paid re-run` — use the manual checklist in `docs/adr/rough-cut/0002-ai-cut-paid-rerun/verify.md` (signed-in session: run AI Cut 3x, hit the 4th-run cap, switch/delete runs, confirm renumbering).
- Then `/test ai cut paid re-run` to lock it in and flip the feature to `done` (which also mirrors the ADR `Status` `In Progress` → `Accepted`).
- Separately still pending from before this session: deciding whether/how to commit the *previous* session's Editor Studio UX Safety changes and the wallet auto-recharge/security-audit fixes (both still uncommitted, unrelated to this feature).

## Open questions

- Whether prod needs a first-deploy baseline step before this migration can ever be applied there — not urgent since prod isn't deployed yet (per `project_vercel_deploy_readiness` memory), but flag it when deploy planning starts.
- Carried over, still open: the Postgres-backed `ON CONFLICT` idempotency integration test (wallet) and whether the Gemini AI Cut prompt should eventually consume utterance boundaries — both deferred in the prior session, untouched here.
