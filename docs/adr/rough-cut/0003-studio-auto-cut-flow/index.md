# 0003. Studio auto cut flow

**Date**: 2026-07-11
**Status**: In Progress

## Summary

Today, opening the studio hands the user a fully uncut video and asks them to click twice: once to build the free mechanical rough cut, once more to pay for the AI polish pass. This decision removes both clicks. The mechanical cut now runs the moment the studio opens on a ready transcript, and the AI pass (if the user asked for it back at upload) chains right after, all behind one loader. Consent for the AI charge moves earlier too, to the upload screen, where the user already sees what things cost. The old paid re run and its run list UI go away in favor of one free "try again" (mechanical) and one paid attempt (AI, at most one, ever, per project) plus a free "restore" if the user drifts away from what the AI suggested. The exit toast becomes a real confirm dialog, and a browser level warning appears only while the AI pass is actually mid flight.

## Context

The studio (`apps/rough-cut/src/app/(app)/dashboard/[id]/page.tsx`) is a live, working feature, and everything this ADR touches is already shipped and billed for correctly. The gap is not correctness, it is friction and framing. A fresh, ready project opens with the entire, uncut video and a floating "Create your rough cut" card (`RoughCutHero`, page.tsx around line 1699) the user must click before seeing any value. AI Cut is a second, separate opt in, gated behind an always visible "Enhance with AI Cut" rail button and a card inside the transcript panel, charged fresh every successful run (ADR 0002-ai-cut-paid-rerun). Consent for that charge is implicit: the user only learns the price when they hover the button or read the toast, at the moment of spending, not at the moment they decided to upload the video in the first place.

Because AI Cut is deterministic over an unchanged transcript (fixed model, temperature zero, a static prompt, see `apps/rough-cut/src/lib/ai-rough-cut.ts`), a second paid run on the same project can never produce a meaningfully different result. ADR 0002 already built the machinery to let a user compare multiple paid attempts anyway (up to three stored `ai_cut_runs`, switch, rename, delete). The engineer's read, confirmed through this conversation, is that this machinery is more than the product now wants: a single automatic attempt, deterministic and already paid for once at upload time, covers the real use case, and the compare-multiple-versions feature is complexity the client does not want to carry or explain.

This is also where billing consent genuinely lives now. The two charges themselves (transcription, AI Cut) are not new and are not changing in mechanism: same ledger reason, same hold and claim machinery, same refund on failure. What moves is when the user agrees to the AI charge, from "at the moment of a mid session click" to "at the moment of upload, next to a combined price." That is a real, deliberate shift of the consent surface, not a new compliance question, since nothing about who gets charged, how much, or under what guard rails changes.

Not deciding this leaves both gates in place: a user still has to find and click "Create your rough cut," then separately find and click "Enhance with AI," each a chance to bounce off a paid product before ever seeing the value it produces.

## Structure

| Child | File | Covers | Decision it supports |
|---|---|---|---|
| 1 | [0001-auto-cut-pipeline.md](./0001-auto-cut-pipeline.md) | The upload time consent toggle and combined cost estimate, the `ai_polish_requested` column and its one shot flip, the auto chain on studio open (mechanical cut then AI pass), the unified loader, and failure or insufficient funds handling. | Automatic, no click rough cut, with AI polish requested and paid for at upload. |
| 2 | [0002-ai-rerun-removal.md](./0002-ai-rerun-removal.md) | Removing the always on AI button, the paid re run, and the run list UI (switch, rename, delete); the single conditional "Polish with AI" button; the free "Restore AI suggestions" action. | One paid AI attempt per project, ever; comparing versions is no longer a supported flow. |
| 3 | [0003-exit-confirm-dialog.md](./0003-exit-confirm-dialog.md) | The first shared Radix based dialog in `packages/ui`, replacing the exit toast on both Dashboard links with a real blocking confirm, plus a native browser warning while the AI pass runs. | A real confirm on exit, not a toast that fires and forgets. |

## Cross-child contracts

**The one shot flip.** `projects.ai_polish_requested` (child 1's migration) is set true or false at upload from the toggle, and is the only thing that decides whether the studio's automatic AI attempt fires on open. Whichever request wins the AI Cut claim (`claimAiCutSlot`, `apps/rough-cut/src/lib/projects.ts`) flips it to `false` inside that same atomic UPDATE, unconditionally, whether the claim came from the automatic chain or a manual click. Child 2's manual "Polish with AI" button therefore also consumes this flip when it succeeds; nothing else needs to read or write this column.

**Who owns the loader.** The studio page component (`page.tsx`) owns a single boolean that spans both the mechanical step and, when requested, the AI step. Child 1 introduces it as the auto chain's own state; the existing `AiCutOverlay` (page.tsx around line 1668) is the visual the loader reuses for both phases, not a second, separate spinner. Child 2's manual "Polish with AI" click reuses this exact state, since it runs the same AI phase logic the auto chain does.

**The dialog primitive's home.** The Radix AlertDialog wrapper is built once, in `packages/ui`, by child 3, and is the first real component that package ships (it currently only ships design tokens and the `cn()` helper). No other child needs a dialog, but the wrapper is written generically enough that the wallet app can reuse it later without a rewrite.

**What child 1 hands to child 2.** Child 1's auto chain is the only thing that ever creates an `ai_cut_runs` row automatically; every row after this ADR ships is either that one automatic attempt or one later manual "Polish with AI" click, never both, never more than one live row's worth of paid attempts per project in practice. Child 2's button visibility and Restore logic (`project.aiCutRuns.length`, the active run's stored ranges) read exactly the data child 1 writes; nothing new is added to the run's shape.

**What is retained, not deleted.** ADR 0002's `ai_cut_runs` table, its claim and idempotency machinery (`claimAiCutSlot`, `releaseAiCutClaim`, `createAiCutRun`, `AI_CUT_RUN_LIMIT`), and its route surface (`PATCH .../ai-cut/active`, `DELETE .../ai-cut/runs/[runId]`, rename) all stay in the codebase, unmodified in shape, after this ADR. Child 1 reuses the claim and create machinery as is. Child 2 stops calling the switch, delete, and rename routes from the client, but does not remove the routes or the table. This is the strangler seam: the old paid, versioned re run design is superseded in its user facing behavior, not in its storage or its concurrency guarantees, so nothing here is a destructive migration.

## Requirements

**User stories**:
- As a user uploading a video, I want to see one combined price and one clear choice about AI polish before I pay for anything, so I am never surprised by a charge later.
- As a user opening a project whose transcript is ready, I want to see my rough cut (and, if I asked for it, the AI polished cut) without hunting for a button, so the studio shows me value immediately.
- As a user who manually diverged from what the AI suggested, I want a free way to get back to the AI's suggestions without paying again, so experimenting never costs me money.

**Acceptance criteria** (the contract, each IDed and independently checkable):
- **AC-1**: The upload flow shows a combined cost estimate (transcription plus AI polish) with an AI polish toggle defaulted ON, and the user's choice is persisted on the project row (`ai_polish_requested`).
- **AC-2**: Opening the studio on a fresh project with a ready transcript automatically runs the mechanical rough cut at balanced sensitivity, with no user click, behind a single unified loader.
- **AC-3**: When AI polish was requested at upload, the AI pass runs automatically right after the mechanical cut under the same loader, charges exactly as a manual AI Cut does today (same ledger reason, claim, idempotency key, run limit), and lands the user on the polished result.
- **AC-4**: Exactly one automatic AI attempt can ever fire per project: `ai_polish_requested` flips to false atomically when the automatic attempt takes its claim, so a failed attempt never silently re-charges on a later open; existing projects (flag defaults false) and projects with saved manual edits or existing AI runs never auto-fire.
- **AC-5**: If the AI pass fails, or funds are insufficient (402), the user lands on the mechanical result with a clear message (for 402, an add-funds prompt deep-linking the wallet), the failed charge is refunded (existing `refundAiCutQuietly` behavior), and a manual "Polish with AI ($X)" button appears.
- **AC-6**: The manual "Polish with AI ($X)" button is visible only when no successful AI run exists for the project and disappears permanently after a successful run. The always-on "Enhance with AI" button, paid re-runs, and the run list UI (switch, rename, delete) are removed.
- **AC-7**: A free "Restore AI suggestions" action re-applies the stored run's ranges client-side, with no Gemini call and no charge, available when the user has manually diverged from the AI suggestions.
- **AC-8**: Leaving the studio via an in-app Dashboard link opens a blocking confirm dialog (reassures the project is saved, offers Leave and Keep editing), replacing the current fire-and-forget toast. A native browser-leave warning (beforeunload) fires only while the AI pass is actively running.
- **AC-9**: The mechanical sensitivity picker (light / balanced / aggressive) moves to the status bar's existing "Re-run rough cut" control (free, instant re-runs at any strength, preserving current manual-edit semantics); the RoughCutHero overlay is removed.
- **AC-10**: All existing safety behavior is preserved: no double charge (claim + idempotency + per-project run cap), spend gating at $0 balance, refund on AI failure, and legacy/pre-existing projects are completely untouched by the new automatic behavior.

## Options considered

### Option 1: Fix in place — additive column, client-side chain, UI removal, tables retained (chosen)
Add one nullable-safe boolean column to `projects`, chain the existing free mechanical cut function and the existing paid AI Cut route together on the client the moment the studio opens on a fresh, ready project, and strip the now-redundant manual gates and run-list UI out of the page. The `ai_cut_runs` table, its claim machinery, and its now-unused switch/delete/rename routes stay exactly as ADR 0002 built them.
Pros: every piece of billing logic (the hold, the claim, the idempotency key, the refund) is reused completely unchanged, so the actual charging code path gets no new risk. The migration is a single additive column, safe on a deployed, currently-empty-of-real-traffic database. Nothing is deleted, so there is no destructive migration and no data loss risk. Cons: the retained `ai_cut_runs` table, its three-run cap, and its dead switch/rename/delete routes are now over-built for what the product actually uses (one attempt, ever), a known and accepted debt tracked in Follow-up.

### Option 2: Server-side auto-run at the transcription callback
Instead of chaining on studio open, run the AI pass automatically the moment Deepgram's callback lands the transcript, before the user has even opened the studio.
Pros: the studio always opens on an already-polished project, no loader needed at all. Cons: charges a real credit hold with no user present to see it happen or to catch a problem in real time; the callback route today is deliberately a thin "write the transcript, set status ready" handler (`apps/rough-cut/src/app/api/transcribe/callback/route.ts:107-141`) and turning it into a Gemini-calling, credit-charging endpoint makes a webhook (unauthenticated except for a per-project token) responsible for spending the user's money, a materially heavier trust and failure surface than a route the signed-in user's own browser calls. Rejected by the engineer for exactly this reason.

### Option 3: Full removal of the run machinery, including a destructive migration
Drop `ai_cut_runs`, `active_ai_cut_run_id`, and `ai_cut_claim_at` entirely and replace them with a single-result shape closer to what existed before ADR 0002.
Pros: the data model matches the new, simpler product behavior exactly, no dormant table or dead route left behind. Cons: a destructive migration against a table that already holds real rows on the deployed client-preview environment, for a decision whose main goal is UX simplification, not data model correctness; the claim and idempotency guarantees ADR 0002 built are still exactly what this ADR needs and would have to be rebuilt from scratch. Rejected: this is churn for its own sake, not a requirement of anything in scope here.

## Decision

**Chosen option**: Option 1. Add `projects.ai_polish_requested`, chain the existing mechanical and AI Cut logic on studio open, remove the now-redundant manual UI, keep ADR 0002's storage and concurrency machinery in place as the strangler seam.

## Rationale

The forcing constraint from Context is that the two charges (transcription, AI Cut) and their safety machinery are already correct and already shipped; this decision is entirely about when the user is asked and when the pipeline fires, not about rebuilding how money moves. Reusing `claimAiCutSlot`, `chargeAiCut`, and `refundAiCutQuietly` unchanged means the auto chain inherits every guarantee those already have (idempotency, atomic claim, refund on failure) for free, instead of re-deriving them for a "new" automatic code path that would really just be the same operation triggered differently.

Option 2 was rejected because it moves the trust boundary in the wrong direction: an unauthenticated (token-gated) webhook is the wrong place to hold the authority to spend a user's credits, and the callback route's whole design principle today is to stay thin. Option 3 was rejected because a destructive migration against live rows buys nothing this ADR's acceptance criteria actually require; every AC here is satisfiable by changing behavior on top of the existing storage, which is the textbook shape of a strangler fix, not a rebuild.

## Consequences

**Positive**: a fresh upload with AI polish requested goes from "two manual gates, a charge with no visible up-front price" to "one visible combined price, then automatic delivery of the finished result." Every billing guarantee is inherited, not rebuilt, so the risk profile of this change is almost entirely in the client sequencing and UI, not in money movement.

**Negative / tradeoffs**: the `ai_cut_runs` table, its three-run cap, and its switch/rename/delete routes become dead capability the moment this ships (the product now only ever produces at most one row per project), a deliberate, tracked debt rather than a hidden one. The studio page's auto-chain effect is new client logic with a real correctness subtlety (the AI phase must operate on the just-built mechanical EDL, not a stale pre-mechanical-cut value from the previous render), called out explicitly in child 1's Build plan so it isn't missed during implementation.

**Neutral**: no other billing surface changes; the wallet app remains the sole Stripe authority and this ADR adds no new cross-app calls beyond the existing deep-link-to-wallet pattern already used for 402s.

## Follow-up

- [ ] Prune the dead run-list routes (`PATCH .../ai-cut/active`, `DELETE .../ai-cut/runs/[runId]`, rename) and consider collapsing `ai_cut_runs` toward a single-row-per-project shape, once this ADR has been live long enough to confirm no multi-run use case resurfaces.
- [ ] Revisit the `AI_CUT_RUN_LIMIT` constant (currently 3) now that the product never intentionally creates more than one run per project; it can likely drop to a smaller safety cap or be removed once the routes above are pruned.
