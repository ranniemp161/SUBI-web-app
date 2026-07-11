# Child 1 — Auto Cut Pipeline

## Summary

This child moves AI polish consent to the moment of upload, where the user sees one combined price, and makes the studio do the mechanical cut (and, if requested, the AI polish) on its own the moment it opens on a ready transcript. No click starts either pass. The AI half can only ever fire automatically once per project; a stored flag flips itself off the instant that one attempt claims its slot, so a crash or a later reopen can never quietly charge twice.

**Covers**: AC-1, AC-2, AC-3, AC-4, AC-5, AC-9, AC-10.

## Context

Today, project creation happens at `POST /api/projects` (`apps/rough-cut/src/app/api/projects/route.ts`), which inserts the row from `fileName`, `durationMs`, `fileSize`, `fileType` and nothing about billing intent. `POST /api/transcribe/deepgram` runs later, only after that row already exists and the audio blob is already uploading; it kicks off Deepgram and has no concept of AI polish at all. The dashboard's `handleFileSelected` (`apps/rough-cut/src/app/(app)/dashboard/page.tsx:436-478`) fires straight from file selection to project creation, with only a silent, advisory `blockedByCredits` pre-flight check (no price shown unless funds are short).

Inside the studio, a fresh project with a ready transcript loads with every segment marked "keep" (`page.tsx:331-344`) and floats `RoughCutHero` (`page.tsx:1699-1766`) over the video until the user clicks "Create rough cut," which calls `reRunRoughCut` (`page.tsx:768-799`), a free, synchronous, client-side call into `reRoughCut` from `apps/rough-cut/src/lib/edl.ts`. AI Cut is a fully separate, always-available opt in: the "Enhance with AI" rail icon (`page.tsx:1304-1313`, wired to `runAiCut`) and a card inside `TranscriptPanel` (`apps/rough-cut/src/components/transcript-panel.tsx:676-689`). `runAiCut` (`page.tsx:934-1018`) POSTs `/api/projects/[id]/ai-cut`, which claims a slot (`claimAiCutSlot`, `apps/rough-cut/src/lib/projects.ts:90-106`), charges (`chargeAiCut`), runs Gemini (`runAiRoughCut`), stores the result as a new `ai_cut_runs` row, and returns it; on any failure after the charge it refunds via `refundAiCutQuietly` (`route.ts:26-38`).

## Requirements

Covers: AC-1, AC-2, AC-3, AC-4, AC-5, AC-9, AC-10.

## Decision

**Chosen option**: (umbrella-level options analysis; this child is Option 1's concrete build.)

**RECOMMEND 1 — where the flag rides and where the estimate renders.** The flag rides on `POST /api/projects` (project creation), not on `POST /api/transcribe/deepgram`. Project creation is where the row is first written, so this is the one place a billing-relevant choice can land in the same write as everything else the row already carries (`fileName`, `durationMs`, ...); riding it on the transcribe-kickoff route instead would mean the row briefly exists with the column at its default before a second write catches up, and a second write path to keep in sync for no reason. The estimate itself renders in the dashboard's upload flow (`apps/rough-cut/src/app/(app)/dashboard/page.tsx`), inserted as a confirm step between `FilePicker`'s file selection and the actual `POST /api/projects` call: `handleFileSelected` currently fires the creation request immediately on file selection (`page.tsx:436-478`); it changes to instead store the selected file and metadata as a pending upload, render a small confirm panel (duration, combined price, the AI polish toggle defaulted on), and only call `POST /api/projects` (now carrying `aiPolish`) once the user confirms. Runner-up: render the estimate inside `FilePicker` itself — rejected, `FilePicker` is a dumb, reusable file-selection primitive (it is also used, without any billing concept, on the video-reselect path) and mixing a cost/consent decision into it would couple an unrelated component to billing.

**RECOMMEND 2 — how the auto-fire attempt marks itself.** No request-level flag is needed. `claimAiCutSlot`'s existing atomic UPDATE (`apps/rough-cut/src/lib/projects.ts:90-106`) gains one more `SET`: `ai_polish_requested = false`, unconditionally, on every successful claim, whether the request came from the studio's auto chain or a later manual "Polish with AI" click. This is safe on a project where the flag is already false (setting false to false is a no-op) and correct on a project where it is true (the first successful claim, automatic or manual, consumes it). Runner-up: thread an explicit `auto: true` body flag from the studio's auto-chain call and gate the flip on that flag — rejected, it requires trusting the client to say "this is the automatic one," adds a parameter that does no real gating work (the claim itself is already the exactly-once guarantee), and if a manual click won the race before the automatic one ever fired, gating the flip on a caller-supplied flag would leave `ai_polish_requested` true and wrongly let a *later* studio open auto-fire a second, unwanted attempt.

**RECOMMEND 5 (partly here, wiring detail also lives in child 3) — where the AI phase's readiness comes from.** Because the auto-chain calls into the same AI-run logic `runAiCut` already implements, `runAiCut` (and `reRunRoughCut`'s cut-application step) must accept an explicit EDL to operate on, defaulting to the current `edl` state, rather than only ever closing over `edl` from the render that created the callback. See Key invariants below for why.

**Auto-fire condition ("fresh project").** The mechanical step (AC-2) fires whenever the studio loads a project with `transcriptStatus === "ready"` and no usable saved EDL, exactly the same condition `page.tsx:317-318` and the current `showRoughCutHero` (`page.tsx:753-757`) already compute, just acted on automatically instead of shown as a prompt. The AI step (AC-3) additionally requires `project.aiPolishRequested === true` and `project.aiCutRuns.length === 0`; the second clause is what makes AC-4's "existing AI runs never auto-fire" hold even in the unlikely case a run exists without a saved EDL.

## Feature design

**Data model sketch**:

`packages/db/src/schema.ts`, `projects` table: add one column.

```
ai_polish_requested: boolean("ai_polish_requested").notNull().default(false),
```

Migration (`packages/db/drizzle/0010_<name>.sql`, next after `0009_dizzy_human_fly.sql`): a single additive `ALTER TABLE projects ADD COLUMN ai_polish_requested boolean NOT NULL DEFAULT false`. No backfill needed, `DEFAULT false` covers every existing row correctly (a legacy project was never asked, so it must never auto-fire, which is exactly AC-4's and AC-10's legacy-safety requirement). This is the one migration the whole umbrella needs; see Migration plan below for why nothing more elaborate is warranted.

**State transitions**:
- `ai_polish_requested`: `false` on every row created before this ships, or created afterward with the toggle off. Set to the toggle's value (`true` when the user leaves it on, the default) at `POST /api/projects` insert time. Flips to `false` inside `claimAiCutSlot`'s atomic UPDATE the instant any AI Cut claim succeeds for that project (automatic or manual), regardless of whether the run that follows succeeds, fails, or is refunded. Never set anywhere else, never read anywhere except the studio's auto-fire condition on load.
- The studio's auto-chain: idle until the load effect determines "fresh, ready, no saved EDL"; runs the mechanical step synchronously (buildInitialEDL is a pure client-side function, no network); if `aiPolishRequested && aiCutRuns.length === 0`, immediately continues into the AI phase under the same loader; terminates either after the mechanical step alone, or after the AI phase resolves (success, failure, or 402), whichever applies. A `useRef` guard (`autoChainedRef`) ensures the effect body runs at most once per mounted studio instance; the server-side claim is the real, load-bearing guard against a double AI charge, the ref only prevents redundant mechanical re-runs within one page life.

**API surface**:

| Endpoint | Method | Key inputs | Key outputs | Auth | Key errors |
|---|---|---|---|---|---|
| `/api/projects` | POST | adds `aiPolish: boolean` (required; the dashboard's confirm panel always sends it) to the existing `fileName`, `durationMs`, `fileSize`, `fileType` body | the created project row, now including `aiPolishRequested` | Clerk auth (unchanged) | unchanged (401, 429, 400 on schema mismatch) |
| `/api/projects/[id]/ai-cut` | POST | unchanged (project id in path, optional `Idempotency-Key` header) — called both by the studio's auto chain and by child 2's manual "Polish with AI" button, with no request-level distinction between them | unchanged: the new `ai_cut_runs` row | Clerk auth + ownership (unchanged) | unchanged (401, 409 `AI_CUT_ALREADY_RUN`-class codes, 402 `INSUFFICIENT_CREDITS`, 422, 429, 502); the only change is that a successful claim now also flips `ai_polish_requested` to false as a side effect, invisible to the response shape |

**Key invariants**:
- Exactly one automatic AI attempt can ever fire per project (AC-4): guaranteed by the claim (only one caller ever wins it) composed with the flip (the winner always clears the flag in the same statement that grants it the claim), so even a claim that is won and then fails downstream (Gemini error, 402, size guard) leaves the flag cleared and the project ineligible for another automatic attempt on a later open.
- The AI phase must operate on the just-built mechanical EDL, not a stale one. Because `applyEdl`'s `setEdl(...)` is an asynchronous state update, a `runAiCut` that only ever reads the `edl` value closed over at render time would, if called synchronously right after the mechanical step in the same auto-chain function, still see the pre-mechanical-cut EDL. `runAiCut` and the cut-application half of `reRunRoughCut` therefore take an optional EDL parameter, defaulting to the current state, so the auto chain can pass the freshly built mechanical EDL straight through in the same tick. This is the one real "stale closure" risk in this design and is called out explicitly so it is not missed during implementation.
- A legacy project (created before this ships, `ai_polish_requested` defaults false) or any project with a saved EDL or an existing `ai_cut_runs` row is completely inert under the new auto-fire logic: it opens exactly as it does today, mechanical-cut prompt gone (see child 1's build task on `RoughCutHero` removal) but nothing auto-runs, since the "fresh" condition (no saved EDL) is false for it. This is AC-10's legacy guarantee, and it costs nothing extra beyond the auto-fire condition already stated above being correctly conjunctive, not disjunctive.
- The unified loader (AC-2, AC-3) is a single boolean the studio page owns, true from the moment the auto chain starts until the whole chain (mechanical, and AI if applicable) settles; it reuses the existing `AiCutOverlay` component (`page.tsx:1668-1692`) for its visual rather than introducing a second spinner.
- 402 and generic-failure handling reuse `runAiCut`'s existing branches unmodified (`page.tsx:950-985`): the mechanical result is already applied and saved by the time the AI phase runs, so a failed or declined AI attempt simply leaves the user on that mechanical result with the existing error toast (and, for 402, the existing "Add funds" deep link to `WALLET_DASHBOARD_URL`) — no new failure-handling code is needed here, only the sequencing that puts the mechanical result in place first.

**Security model**: unchanged. `POST /api/projects` keeps its existing Clerk auth and rate limit; `aiPolish` is just one more field in an already-authenticated, already-owned write. `POST /api/projects/[id]/ai-cut` keeps its existing auth, ownership, rate limit, and claim guard exactly as ADR 0002 built them; this child adds no new trust boundary.

**Critical test scenarios**:
- Happy path, polish requested: upload with the toggle on, open the studio once the transcript is ready, observe the mechanical cut apply, the AI phase start under the same loader, and the polished result land with `ai_polish_requested` now false and one `ai_cut_runs` row, verifies **AC-1, AC-2, AC-3, AC-4**.
- Happy path, polish declined: upload with the toggle off, open the studio, observe only the mechanical cut apply, no AI call is ever made, verifies **AC-1, AC-2**.
- Failure case, Gemini error mid-chain: force `runAiRoughCut` to throw during an automatic attempt, verify the charge is refunded, the mechanical result remains on screen, `ai_polish_requested` is false afterward (no second automatic attempt on reopen), and the manual button appears, verifies **AC-4, AC-5**.
- Failure case, 402 at auto-polish: force `chargeAiCut` to return `insufficient` during an automatic attempt, verify the mechanical result remains, an add-funds prompt deep-links the wallet, and reopening the project (after a top-up) does not auto-fire a second time, verifies **AC-4, AC-5**.
- Concurrency case: two tabs open the same fresh, ready, polish-requested project at once; verify only one claims the AI slot and charges, the other's attempt is rejected by the existing claim guard, verifies **AC-4, AC-10**.
- Legacy/untouched case: a project created before this ships (or one with a saved EDL, or one with an existing `ai_cut_runs` row) opens with no automatic mechanical or AI behavior at all, verifies **AC-10**.

## Migration plan

No migration plan needed beyond task 1's additive migration: one nullable-safe, `NOT NULL DEFAULT false` boolean column, no backfill, no phased rollout, safe in a single deploy given the current client-preview data volume (small, no concurrent-traffic hazard, consistent with how ADR 0002's own migration was reasoned about).

## Build plan

1. **Migration**: add `projects.ai_polish_requested boolean NOT NULL DEFAULT false` via `packages/db` (`db:generate` then `db:migrate`), following the runbook in `packages/db/MIGRATIONS.md`. (AC-1, AC-4, AC-10)
2. **Schema + validation**: add `aiPolishRequested` to the Drizzle `projects` table; add `aiPolish: z.boolean()` to `createProjectSchema` (`apps/rough-cut/src/lib/validation.ts`); insert it in `POST /api/projects` (`apps/rough-cut/src/app/api/projects/route.ts`). (AC-1)
3. **Upload confirm panel**: change `handleFileSelected` (`apps/rough-cut/src/app/(app)/dashboard/page.tsx:436-478`) to hold the selected file and metadata as a pending upload instead of firing immediately; render a confirm panel showing the combined price (`chargeMicrosForSeconds` for transcription, doubled or itemized when the toggle is on, using the existing `formatUsd`/`chargeMicrosForSeconds` from `@repo/ui`) and the AI polish toggle, defaulted on; only call `POST /api/projects` (now with `aiPolish`) and `kickOffTranscription` once confirmed. (AC-1)
4. **Server-side flip**: extend `claimAiCutSlot`'s `UPDATE` (`apps/rough-cut/src/lib/projects.ts:90-106`) with `ai_polish_requested = false` in the same `SET` clause. (AC-3, AC-4)
5. **Threadable EDL parameter**: give `runAiCut` and the cut-application step of `reRunRoughCut` (`page.tsx:768-799`, `934-1018`) an optional source-EDL parameter, defaulting to the current `edl` state, so a caller can pass a freshly computed EDL synchronously. (AC-3, key invariant on stale closures)
6. **Remove the fresh-project placeholder and `RoughCutHero`**: delete the "all keep" placeholder branch in the load effect (`page.tsx:331-344`) and the `RoughCutHero` component, its render call, and `showRoughCutHero`/`heroDismissed` state (`page.tsx:753-757`, `1426-1433`, `1699-1766`); the status bar's existing sensitivity picker and "Re-run rough cut" control (`page.tsx:1576-1604`) become the sole place to change sensitivity or force a fresh mechanical pass. (AC-9)
7. **Auto-chain effect**: add the load-time effect that detects a fresh, ready project (no saved EDL), runs the mechanical step via `buildInitialEDL`/`reRoughCut` at `SENSITIVITY_PRESETS.balanced`, applies it, and — when `project.aiPolishRequested && project.aiCutRuns.length === 0` — immediately continues into the AI phase (calling the now-parameterized `runAiCut` with the freshly built EDL) under one unified loader boolean; reuse `AiCutOverlay` for the loader's visual for both phases. (AC-2, AC-3, AC-4, AC-10)
8. **Legacy/edge-case guards**: verify the auto-chain effect's condition is conjunctive (ready transcript AND no saved EDL AND, for the AI half, `aiPolishRequested` AND zero existing runs) so legacy rows, manually-edited projects, and projects with an existing run are provably inert; add the corresponding tests. (AC-4, AC-10)
9. **Tests** (co-located `*.test.ts(x)`, Vitest): route test for the claim's new flip behavior; client tests for the confirm panel's toggle and price display, the auto-chain's mechanical-only path, the auto-chain's mechanical-then-AI path (success, Gemini failure, 402), and the legacy/no-auto-fire cases from task 8. (all ACs in this child)

## Consequences

**Positive**: a user who wants AI polish sees its price before they commit to uploading, and gets it without any further action once the transcript is ready. The mechanical cut is no longer gated behind a click either, so every ready project shows real, already-cut footage the instant the studio opens.

**Negative / tradeoffs**: the studio page gains a new, non-trivial effect (the auto chain) with a genuine correctness subtlety (the stale-EDL-closure risk called out above); getting the sequencing wrong there is the single highest-risk part of this whole ADR and is why it is called out as its own Build plan task and test scenario rather than left implicit. The upload flow gains one more step (the confirm panel) between file selection and the upload actually starting, a small amount of added friction traded for real, up-front consent.

**Neutral**: `RoughCutHero` and its sensitivity picker are deleted as dead code once the status bar's existing controls (unchanged in this child) become the sole entry point; no visual regression, since the status bar controls already existed side by side with the hero.
