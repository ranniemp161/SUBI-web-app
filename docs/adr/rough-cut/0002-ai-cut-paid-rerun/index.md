# 0002. AI Cut paid re run (versioned suggestion runs)

**Date**: 2026-07-09
**Status**: Accepted — superseded in part by [0003](../0003-studio-auto-cut-flow/index.md) (2026-07-11)

> Paid re runs and the run list UI (switch, rename, delete) decided here are superseded: the product now allows at most one AI attempt per project, automatic or manual, never both. The `ai_cut_runs` data model, the atomic claim machinery (`claimAiCutSlot`/`releaseAiCutClaim`), and the idempotency design decided here are retained and reused, unmodified, by 0003.

## Summary

Today a project can hold only one stored AI Cut result at a time, and running AI Cut again is blocked until the user destroys the current result with an explicit Clear action. This decision replaces that with versioned runs, a project can hold up to three stored AI Cut runs at once, each a separate paid Gemini pass, and the user can preview and switch which one is active without losing the others. It touches the `projects` table, adds a new `ai_cut_runs` table, and adds three endpoints (create, switch active, delete). Building it means a schema migration first, then the atomic claim and create path, then switch and delete, then client wiring.

## Context

The current AI Cut re run guard (see the linked child ADR) was a deliberate, narrow fix for a double charge bug: AI Cut is deterministic over the same transcript, so a second run on unchanged input produces the same suggestions, and the old code charged for it anyway. That ADR closed the hole by blocking any second run until the user destroyed the first one with a confirmed Clear action. It also flagged, in its own Follow up section, that a paid re run without discarding the current suggestions would need a versioned or additive shape and its own decision. This ADR is that decision.

The forcing function is real user behavior, not a hypothetical: Gemini's suggestions are not perfectly deterministic in practice (model updates, retries, and the transcript itself can change between runs), and a user who wants to compare two passes, or who is not happy with the first pass, is currently forced to throw away their only copy before they are allowed to try again. That is a bad trade for a paid action. At the same time, unlimited stored runs is its own hazard: it turns an open ended, ever growing JSON blob per project into an unbounded liability, and it removes any natural limit on how many times a user can spend money chasing a marginally different result.

The existing system already gives us the two mechanisms this decision needs to reuse rather than reinvent. Credits are charged through `chargeAiCut`, an idempotency keyed, CHECK constraint guarded ledger write in `lib/credits.ts`. Concurrency safety for "only one AI Cut run in flight per project" is an atomic conditional UPDATE, the same shape as `reserveCredits`' hold gate, currently implemented as `claimAiCutSlot` in `lib/projects.ts`, which today (before this change) overloads the single `ai_cuts` column itself as the claim marker. Both of those need to keep working exactly as they do, the difference is what the claim protects and how many results can exist afterward.

Not deciding this leaves the current all or nothing model in place: every re run destroys the prior result, which keeps pushing users toward a clear then rerun loop that feels punitive for a paid feature, and keeps deferring the versioned data model the earlier ADR already flagged as needed.

## Requirements

**User stories**:
- As a user who is not satisfied with the first AI Cut pass, I want to run it again without losing the first result, so I can compare and pick the better one.
- As a user who has hit the run limit, I want a clear message telling me to delete a stored run before I can pay for another, so I am not confused by a silent failure.
- As a user switching between stored runs, I want to be warned that my manual edits on the timeline will be discarded, so I am not surprised by lost work.

**Acceptance criteria**:
- **AC-1**: A user can run AI Cut again on a project that already has one or more stored suggestion runs, without first clearing them; this creates a new stored run alongside the existing one(s) and charges the same amount as any other run.
- **AC-2**: A project holds at most 3 stored AI Cut runs at once; attempting to create a 4th paid run is blocked with a clear 409 error until the user deletes one of the existing 3.
- **AC-3**: The user can switch which stored run is active; switching warns that the current manual timeline edits will be discarded, and on confirmation applies the newly active run's ranges as the fresh timeline.
- **AC-4**: The user can delete a non active stored run at no cost and with no refund; deleting the currently active run is blocked (409) until the user switches to a different run first.
- **AC-5**: Concurrent AI Cut run requests for the same project are serialized by an atomic claim, decoupled from the stored runs, so at most one charge/run happens at a time even under two simultaneous requests.
- **AC-6**: All three endpoints (create run, switch active, delete run) enforce auth and project ownership and share the same existing per user rate limiter already applied to AI Cut today.

## Options considered

### Option 1: Separate `ai_cut_runs` table, an active run pointer, and a decoupled claim column
Each AI Cut run becomes its own row in a new `ai_cut_runs` table, keyed by project and a per project run number. The `projects` table keeps a nullable pointer, `active_ai_cut_run_id`, to whichever run is currently applied to the timeline, and a separate `ai_cut_claim_at` timestamp that exists purely to serialize concurrent run requests, independent of how many runs are stored.
Pros: the claim, the stored results, and "which one is active" become three independent concerns instead of one overloaded jsonb column doing all three jobs at once, which is exactly the confusion the current code has to work around with a sentinel `__pending__` marker. Deleting or switching a run is a simple row operation with a real foreign key, and the run cap is a plain count query. Cons: it is a real schema migration on a live column (`ai_cuts`), and it adds a second table and a join where before there was one column, more moving parts for a feature that, at its core, is "let me try again."

### Option 2: Keep the single run guard, add a one time "run again anyway, pay again, overwrite" flag
Leave `projects.ai_cuts` as the single stored result. Add a request flag (or a second confirmed endpoint) that skips the "already run" 409, charges again, and overwrites the existing result in place, no history kept.
Pros: no schema change at all, smallest possible diff, ships in a day.
Cons: this is the exact design the original re run guard ADR rejected in its own Option B, for the same reason: an override flag on a charging endpoint is precisely the kind of thing a buggy client or an over eager retry can set by accident, reopening the double charge hole the guard exists to close. It also does not satisfy the actual requirement here, the user explicitly wants to keep and compare multiple results, not silently overwrite the only copy. This option is the road not taken; it is faster to build but it does not solve the stated problem and it resurrects a risk the codebase already decided to avoid.

## Decision

**Chosen option**: Option 1, a separate `ai_cut_runs` table with an active run pointer on `projects` and a decoupled claim column.

## Rationale

The forcing constraint from Context is that concurrency safety and stored results must not be the same mechanism, because that coupling is exactly what makes the current single column design hard to reason about (a claim marker that has to impersonate a valid, empty result so every existing reader still works). Splitting the claim into its own column removes that impersonation entirely: `ai_cut_claim_at` means one thing, in flight or not, and nothing else reads or writes it except the claim and release functions.

The run cap and the delete/switch invariants also push toward a real table rather than a bigger jsonb blob. "At most 3, contiguous numbering, exactly one active once any exist, can't delete the active one" are relational constraints that are natural to express and enforce with a foreign key, a unique constraint, and a count, and are awkward to enforce correctly by hand inside an array living in one jsonb cell, especially under concurrent requests.

Option 2 was rejected not because it is slow to build, but because it reintroduces the specific risk the codebase already paid down once. A charging endpoint with an "ignore the guard" flag is a standing double charge hazard; the codebase has already chosen, in the linked child ADR, to keep charging endpoints free of override flags and to route "I want to pay again" through a distinct, explicit action instead. Versioned runs is that distinct, explicit action, done properly rather than as a flag.

## Feature design

**Data model sketch**:

`projects` table changes:
- Drop the `ai_cuts` jsonb column (its non empty contents are migrated into `ai_cut_runs` as part of the same migration, see Build plan task 1).
- Add `active_ai_cut_run_id` (uuid, nullable, foreign key to `ai_cut_runs.id`, `onDelete: "set null"`). Nullable because a brand new project, or a project whose last run was deleted, has no active run.
- Add `ai_cut_claim_at` (timestamp with time zone, nullable). Null means no run is in flight for this project. A non null value older than `AI_CUT_CLAIM_STALE_MS` (the existing 6 minute constant, unchanged) is treated as abandoned and can be reclaimed, exactly like the current stale claim logic, just against a real timestamp column instead of a marker parsed out of jsonb.

New `ai_cut_runs` table:
- `id` (uuid, primary key, default random).
- `project_id` (uuid, not null, foreign key to `projects.id`, `onDelete: "cascade"`, so a deleted project's runs are cleaned up automatically).
- `run_number` (integer, not null). Per project, starts at 1, stays contiguous, is renumbered on delete so there is never a gap.
- `ranges` (jsonb, not null). The same `AiCutRange[]` shape already produced by `runAiRoughCut` and validated by `sanitizeAiRanges`, unchanged.
- `model` (text, not null). The model identifier, same field that exists on the current `AiCuts` shape today.
- `created_at` (timestamp with time zone, not null, default now).
- A unique constraint on `(project_id, run_number)`, so two concurrent creates can never both claim the same run number for a project.

Cardinality: one project to many `ai_cut_runs`; one project to at most one active run, nullable.

**State transitions**:
- `ai_cut_claim_at`: null (idle) becomes a timestamp (claimed) via the atomic claim UPDATE at the start of POST; becomes null again (released) on any failure path after the claim, or implicitly stays claimed only for the duration of a successful run, cleared right after the new row and the active pointer are written. A claim older than the stale threshold is treated as idle by the claim query itself, the same reclaim logic the current code already has, just pointed at a real timestamp.
- `active_ai_cut_run_id`: null on a project with zero runs; set to the newly created run's id on every successful POST (a new run is always made active immediately, matching how the client applies POST's result today); set to the requested run's id on a successful PATCH switch; set back to null only if the currently active run is deleted, which can only happen if it was already the last remaining run (deleting the active run while other runs exist is blocked, see Key invariants), so "active becomes null" and "zero runs remain" always happen together.

**API surface**:

| Endpoint | Method | Key inputs | Key outputs | Auth | Key errors |
|---|---|---|---|---|---|
| `/api/projects/[id]/ai-cut` | POST | none (project id in path, optional `Idempotency-Key` header, unchanged) | the new run's `{ id, runNumber, ranges, model, createdAt }`, same shape the client already applies today plus the new `id`/`runNumber` | Clerk auth + ownership | 409 `AI_CUT_IN_PROGRESS` (claim held), 409 `AI_CUT_RUN_LIMIT_REACHED` (3 runs already stored), 402 `INSUFFICIENT_CREDITS`, 422 transcript too long, 429 rate limited |
| `/api/projects/[id]/ai-cut/active` | PATCH | body `{ runId }` | `{ id, runNumber, ranges, model, createdAt }` for the run that is now active, same shape as POST's output so the client applies it the same way | Clerk auth + ownership | 404 `AI_CUT_RUN_NOT_FOUND` (runId not found or not this project's), 429 rate limited |
| `/api/projects/[id]/ai-cut/runs/[runId]` | DELETE | none (ids in path) | `{ ok: true }` | Clerk auth + ownership | 409 `AI_CUT_RUN_IS_ACTIVE` (attempted delete of the active run), 404 `AI_CUT_RUN_NOT_FOUND`, 429 rate limited |

All three error bodies follow the existing convention already used by the POST route today, a human readable `error` string plus a machine readable `code`, for example `{ "error": "You already have 3 saved AI Cut runs. Delete one to run again.", "code": "AI_CUT_RUN_LIMIT_REACHED" }`. This keeps the same shape the client already branches on for `AI_CUT_ALREADY_RUN` and `AI_CUT_IN_PROGRESS` today, just with two new codes for the two new conflict cases, and reuses `AI_CUT_IN_PROGRESS` unchanged for the claim case rather than inventing a new name for the same condition.

On the client, PATCH's response carries the full newly active run (id, ranges, model, createdAt), the same shape POST already returns and the client already knows how to apply (`applyAiCuts(edl, aiCuts, words)` after a fresh `buildInitialEDL`, discarding the current manual edits, consistent with how a fresh POST result is applied today). This avoids a second round trip to re fetch the project after switching, and keeps "apply a run's ranges to the timeline" a single code path shared by POST and PATCH on the client, rather than two different flows.

**Key invariants**:
- A project holds at most 3 stored `ai_cut_runs` rows at any time.
- `run_number` is contiguous starting at 1 for each project, no gaps, enforced by renumbering on delete (task in Build plan).
- Once any run exists for a project, exactly one of them is active (`active_ai_cut_run_id` is non null); if zero runs exist, `active_ai_cut_run_id` is null. There is no state with runs but no active run.
- The active run can never be deleted directly; the DELETE endpoint checks this and returns 409 before touching the row.
- The claim (`ai_cut_claim_at`) is independent of how many runs are stored or which one is active; POST's cap check (AC 2) and the claim (AC 5) are two separate guards checked in the same request, cap first (cheap read, no side effect), claim second (the actual concurrency gate), so a request that is going to be rejected for being at the cap never takes the claim in the first place.

**Security model**: unchanged from the existing route: Clerk `auth()` for identity, `getOwnedProject` (or an equivalent ownership check keyed on `runId` plus the path project id for the two new endpoints) so a user can never act on another user's project or runs, and the same per user rate limiter (`lib/rate-limit.ts`, the existing `ai-cut:${clerkId}` bucket) applied to all three endpoints, not just POST, since PATCH and DELETE are also worth bounding even though they carry no charge, an unbounded PATCH or DELETE loop is still unwanted request volume against the database.

**Configuration required**: none. No new environment variables; the run cap of 3 and the claim staleness window are both code level constants, consistent with how `AI_CUT_CLAIM_STALE_MS` is defined today.

**Critical test scenarios**:
- Happy path, two runs: POST on an empty project creates run 1 and makes it active (AC-1); POST again creates run 2, makes it active, and run 1 still exists and is fetchable (AC-1). PATCH back to run 1's id makes it active again and returns run 1's ranges (AC-3).
- Failure case, cap reached: with 3 runs already stored, POST returns 409 `AI_CUT_RUN_LIMIT_REACHED` and neither charges credits nor calls Gemini (AC-2).
- Failure case, delete the active run: DELETE on the currently active run's id returns 409 `AI_CUT_RUN_IS_ACTIVE` and the run still exists afterward (AC-4).
- Concurrency case: two POSTs fired at once for the same project, only one succeeds in claiming (`ai_cut_claim_at`), the other receives 409 `AI_CUT_IN_PROGRESS` and is never charged (AC-5).
- Auth and permission case: a PATCH or DELETE with a `runId` that belongs to a different project (or a different user's project) returns 404 `AI_CUT_RUN_NOT_FOUND`, never a silent success and never leaking whether the run id exists elsewhere (AC-6).

## Build plan

1. [x] **Migration** (AC-1, AC-2, AC-4): add `ai_cut_runs` table, add `projects.active_ai_cut_run_id` and `projects.ai_cut_claim_at` as nullable columns, backfill any project with a non empty `ai_cuts` into `ai_cut_runs` as `run_number` 1 with `active_ai_cut_run_id` pointed at it, then drop `projects.ai_cuts`. See the note below on why this ships as one migration rather than a phased strangler sequence.
2. [x] **Claim + create path, end to end** (AC-1, AC-5, AC-6): replace `claimAiCutSlot`/`releaseAiCutClaim` in `lib/projects.ts` with versions that read and write `ai_cut_claim_at` instead of the `ai_cuts` sentinel; update the POST handler to check the run count cap before claiming, claim, charge, run Gemini, insert the new `ai_cut_runs` row with the next `run_number`, set it active, release the claim, and return the new run. Keep the existing idempotency key behavior on `chargeAiCut` unchanged.
3. [x] **Switch active endpoint** (AC-3, AC-6): add `PATCH /api/projects/[id]/ai-cut/active`, validate the `runId` belongs to the project, update `active_ai_cut_run_id`, return the run.
4. [x] **Delete run endpoint** (AC-4, AC-6): add `DELETE /api/projects/[id]/ai-cut/runs/[runId]`, block if it is the active run, delete it, renumber the remaining runs for that project to close any gap.
5. [x] **Client wiring**: update the AI Cut section to list stored runs, add the switch action with the existing confirm toast pattern (discard manual edits warning) wired to PATCH, add per run delete wired to DELETE, apply PATCH's returned ranges through the same `buildInitialEDL` plus `applyAiCuts` flow the POST success handler already uses, and surface the two new 409 codes (`AI_CUT_RUN_LIMIT_REACHED`, `AI_CUT_RUN_IS_ACTIVE`) with their own messages instead of the generic error toast.
6. [x] **Tests** (all AC): route tests for POST's new cap check and run creation, PATCH, and DELETE (including the renumbering and the active delete block), a concurrency test for the decoupled claim, and client tests for the switch confirm and the new error code handling.

A note on migration sequencing: this is a pre launch, low data volume system (the wallet architecture ADR and the current state both describe a small, single digit number of projects with any AI Cut results in the dev database, and the app is not yet deployed to production per the current Vercel deploy readiness state). Given that, a full phased strangler sequence (add nullable, dual write, backfill, add constraint, drop old column, each as its own deploy) is more process than this data volume needs. The right call here is a direct cutover in one migration: add the two new nullable columns and the new table, backfill the handful of existing non empty `ai_cuts` values into `ai_cut_runs` as part of the same migration script, then drop `ai_cuts`, all in one deployable unit. The discipline that does still apply, even at this scale, is not skipping the nullable first step: both new `projects` columns are added nullable with no default required, exactly as the pattern calls for, because a project can validly have zero runs and no active run. If this table ever needs a genuine zero downtime migration later, at real production scale with concurrent traffic, that is a new decision at that time, not a reason to over engineer this one now.

On idempotency and audit: the POST endpoint's existing `Idempotency-Key` header behavior on `chargeAiCut` is unchanged, a retried POST still cannot double charge. The credit ledger (`credit_ledger`, written by `chargeAiCut`) already records every charge with its reason, project, and cost, which is the audit trail this feature needs; no new audit mechanism is required, since PATCH and DELETE never touch money.

## Consequences

**Positive**: users can compare AI Cut passes instead of being forced to destroy a result to try again, closing the gap the original re run guard ADR flagged as future work. The claim, the stored results, and the active pointer become three independently understandable pieces instead of one overloaded column. The run cap gives the database a hard, known upper bound on stored suggestion data per project.

**Negative / tradeoffs**: the migration touches a live column (`ai_cuts`) and requires a backfill step inside the same deploy, so it needs to be tested against a copy of real data before it runs against the actual database, even though that data set is currently small. The run cap introduces a new kind of stuck state the UI has to explain clearly, a user who wants a 4th attempt but has 3 runs stored must be told plainly to delete one first, otherwise it reads as a bug rather than a limit. Because every run costs the same regardless of how many the user already has, a user doing side by side comparison shopping across all 3 slots pays full price 3 times, which needs clear pricing framing in the UI (for example, showing the cost before each run) so it does not feel like a surprise or a money grab.

**Neutral**: the switch action (PATCH) and the delete action (DELETE, on a non active run) carry no charge and no refund, consistent with how the existing Clear action already works today. The rate limiter bucket and window are unchanged, all three endpoints share the same `ai-cut:${clerkId}` bucket rather than getting separate limits.

## Follow-up

- Whether a stored run should be nameable or labelable by the user (for example "run 2, longer intro kept") for their own reference when comparing, deferred, not needed for the first version where run number and creation time are enough to tell runs apart.
- Whether the 3 run cap should become a configurable value later (per plan tier, for example) rather than a fixed constant, deferred until there is a pricing tier that would actually use it.
- The empty state after a project's only run is deleted: this is not left open, it is answered directly by the Key invariants above. Deleting the active run is blocked outright, so the only way to reach zero runs is deleting the sole remaining run while it happens to not be active, which cannot occur either, since with exactly one run it is always the active one. In practice a project can only ever go from 1 run to 0 by first creating a 2nd run, switching active to the 2nd, then deleting the 1st, at which point it is not the last run at time of deletion. A project with zero runs ever (never ran AI Cut) simply shows the existing "run AI Cut" entry point with `active_ai_cut_run_id` null, no special casing needed beyond what already exists today for a project that has never been run.
- Whether the stale claim window (`AI_CUT_CLAIM_STALE_MS`, unchanged at 6 minutes) needs to move now that it lives on a plain timestamp column instead of jsonb, deferred, the value itself does not need to change for this decision, only its storage location.
