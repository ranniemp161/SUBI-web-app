# 0004. Reselect gated pipeline

**Date**: 2026-07-14
**Status**: In Progress

## Summary

This decision removes the upload confirm panel (the modal that shows a price and an AI-polish toggle before a video starts processing) and makes AI polish a mandatory part of every new project instead of an opt-in choice. Selecting a file now goes straight into extraction, upload, and transcription with zero clicks. In the studio, reselecting the source video (already required today so the player has something to show) becomes the real trigger for the mechanical cut and the AI polish pass, instead of those running the moment the transcript alone is ready. This closes a gap in today's flow, where the cut and the AI charge could start before the user ever reselected their video.

## Context

ADR 0003 ("Studio auto-cut flow", `docs/adr/rough-cut/0003-studio-auto-cut-flow/index.md`) shipped the current pipeline: an upload confirm panel with a combined price and an AI-polish toggle (defaulted on), then, once the studio opens on a ready transcript with no saved edit list, an automatic chain that builds the mechanical cut and, if polish was requested, follows it with the AI pass, all under one loader.

Two things about that shipped design are being changed now, both product decisions made directly by the engineer, not new problems discovered in the code.

First, the upfront modal is friction the product no longer wants. The engineer wants file selection to lead straight into processing, with no click in between, and wants AI polish to stop being a per-project choice: every project now gets it. The only place this changes user experience is when funds are short, which still needs to be caught, but with an inline message rather than a modal.

Second, and more structurally important: today's auto-chain fires off the transcript alone (`transcriptStatus === "ready"` and no saved edit list yet). It does not wait for the user to reselect their source video, because the mechanical cut only needs the transcript's words, not the video file. This means the mechanical cut, and potentially a real AI charge, can start in the background before the user has taken the action ("reselect my video") that they associate with resuming work on a project. The engineer wants reselecting the video to be the actual trigger: the moment reselect succeeds and passes its existing duration check, processing starts, under a loader that reads "A.I. is doing the rough cut in the background...". Not deciding this leaves the current, decoupled behavior in place, where cutting (and spending) can happen off-screen, disconnected from anything the user did.

Nothing about how money moves changes here. The hold, claim, charge, and refund machinery ADR 0003 built and this ADR reuses without modification; this ADR is entirely about when the upload starts and what gates the automatic pipeline once the studio opens.

## Structure

| Child | File | Covers | Decision it supports |
|---|---|---|---|
| 1 | [0001-upload-flow-simplification.md](./0001-upload-flow-simplification.md) | Removing the upload confirm panel, making `aiPolishRequested` unconditionally true for new projects, moving the insufficient-funds check to an inline pre-flight message, and relabeling a fresh dashboard row "Ready for step 2". | No-click upload, AI polish always requested, funds checked before any bytes move. |
| 2 | [0002-reselect-gated-processing.md](./0002-reselect-gated-processing.md) | Making the studio's reselect prompt the real gate for the auto-chain (mechanical cut, then AI polish), the loading copy change, and preserving every existing failure/legacy behavior. | Cutting (and any AI charge) only ever starts after the user has reselected their video. |

## Cross-child contracts

**The "fresh" condition stays one definition.** Both children read the same underlying fact: a project has `transcriptStatus === "ready"` and no usable saved edit list. Child 1 uses it to decide the dashboard row's label ("Ready for step 2" versus "Ready"); child 2 uses the identical condition, already computed in the studio today as `freshOnLoadRef`, as one clause of the auto-chain's firing condition. Neither child redefines "fresh" independently; child 2 does not invent a second notion of freshness for the studio side.

**What child 2 adds on top of "fresh."** Child 1's relabeling only needs the "fresh" condition. Child 2's auto-chain gate needs "fresh" AND "the source video has been reselected and passed duration verification." Child 1 never needs this second clause; it is entirely a child 2 concern, called out so nobody accidentally tries to gate the dashboard label on it too.

**No new server state.** Neither child adds a column, an enum value, or a new API field to represent "fresh" or "reselected." Both are derived client-side from data the API already returns (or, for child 1's dashboard label, a small addition to what the list endpoint returns — see child 1's Feature design for exactly what's missing and why).

## Requirements

**User stories**:
- As a user with a new video, I want to pick the file and have everything start immediately, so I don't have to click through a price screen before work begins.
- As a user who is short on funds, I want to be told before anything uploads, so I don't waste time on a video I can't afford to process.
- As a user returning to a project whose transcript is ready, I want the cutting and AI polish to start only once I've reselected my video, so nothing spends my money or does work off-screen before I've resumed the project myself.
- As a user whose AI polish pass failed or was skipped, I want the same manual "Polish with AI" retry button I have today, so I'm never stuck without a way to get the polished result.

**Acceptance criteria** (the contract, each IDed and independently checkable):
- **AC-1**: Selecting a file in the dashboard's file picker goes straight into extraction, Blob upload, and Deepgram transcription with no intermediate confirm panel and no click required after selection (funds permitting).
- **AC-2**: Every project created through `POST /api/projects` has `aiPolishRequested` set to `true` unconditionally, decided server-side; the client sends no `aiPolish` field, and `createProjectSchema` no longer accepts one.
- **AC-3**: Before extraction or upload starts, a client pre-flight check prices the combined cost of transcription plus AI polish (not transcription alone) against the user's balance; on insufficient balance, an inline, non-modal message appears near the file picker, and neither `POST /api/projects` nor extraction is ever called.
- **AC-4**: The server remains the authoritative gate exactly as it does today: blob-token issuance re-checks affordable seconds, and the AI-cut charge route re-checks the balance and can 402. No server-side check is weakened or removed by this ADR.
- **AC-5**: A dashboard project row whose `transcriptStatus` is `"ready"` and which has no saved edit list yet reads "Ready for step 2" instead of "Ready". A project with a saved edit list, or an existing AI Cut run, keeps the current "Ready" label and current behavior, completely unaffected.
- **AC-6**: Clicking a "Ready for step 2" row navigates to the existing studio route, `/dashboard/[id]`; no new route is introduced.
- **AC-7**: On a fresh project (ready, no saved edit list), the studio's first visible state is the existing video reselect prompt (the existing `FilePicker`, with its existing duration-verification props and behavior, completely unchanged).
- **AC-8**: The studio's automatic chain (mechanical cut, then AI polish if requested) does not fire until the source video has been reselected and has passed duration verification, in addition to the existing "ready, no saved edit list" condition. The chain never fires on transcript-readiness alone.
- **AC-9**: The moment reselect succeeds, a full-screen loading state appears with the exact copy "A.I. is doing the rough cut in the background..." and spans both the mechanical cut phase and, when it runs, the AI polish phase, reusing the existing `AiCutOverlay` component and its `aiBusy || autoCutBusy` boolean.
- **AC-10**: AI-polish failure or a 402 (insufficient funds at claim time) is handled exactly as it is today: the mechanical result stays applied and visible, the existing error toast and (for 402) add-funds deep link appear, the charge is refunded via the existing `refundAiCutQuietly` behavior, and the manual "Polish with AI ($X)" button appears and remains the retry path, visible only when no successful AI run exists yet for the project.
- **AC-11**: A project that already has a saved edit list, or an existing AI Cut run, is completely unaffected by this ADR: opening its studio page loads straight into the editor as it does today, with no reselect-prompt-as-gate behavior applied.

## Options considered

### Option 1: Strangler — reuse ADR 0003's machinery, change sequencing, gating, and UI only (chosen)

Keep every piece of billing and cutting logic ADR 0003 built (the hold, the claim, `chargeAiCut`, `refundAiCutQuietly`, `buildInitialEDL`, `runAiCut`) completely unchanged in mechanism. Remove the upload confirm panel and its state, hardcode `aiPolishRequested` to `true` server-side, and add one more clause to the studio's existing auto-chain firing condition (source file reselected and verified) alongside the two it already has. Derive "fresh" and the dashboard label from data already available or a small, additive read, with no new column or status value.

Pros: every charge-moving code path (claim, charge, refund) is untouched, so this ADR's risk is entirely in client sequencing and UI, not in money movement. No migration is needed. The change is small enough to review clause-by-clause against the existing auto-chain effect.

Cons: "fresh" and "reselected" remain client-derived facts rather than a single, persisted, authoritative status; a future change that wants a server-side view of "is this project past the reselect gate" would still need to compute it from the same signals this ADR already reads (transcript status, saved edit list, source file presence), not from one column.

### Option 2: A persisted pipeline-stage status and a dedicated reselect route

Add a status value (e.g. `"needs_reselect"`) to `projects.transcriptStatus`, or a parallel column, that the server flips once a transcript is ready, and build a separate `/dashboard/[id]/resume` route dedicated to the reselect-then-process flow, keeping `/dashboard/[id]` for the editor only.

Pros: the pipeline's stage becomes a first-class, server-visible fact instead of something re-derived on every studio load; a dedicated route keeps the editor page's effect list shorter.

Cons: a schema change and a migration for a fact the client can already derive correctly and cheaply from data it already fetches; a second route means the studio's existing reselect UI, duration-verification props, and navigation would need to be duplicated or awkwardly shared across two pages, for no behavior the single-page approach can't already provide. Rejected because it is meaningfully more code and one more migration for no acceptance criterion here that actually requires it.

## Decision

**Chosen option**: Option 1. Reuse ADR 0003's billing and cutting machinery unchanged; change only when the upload starts, when the auto-chain fires, and what the loading and dashboard-label copy says.

## Rationale

The forcing constraint from Context is the same one ADR 0003 established and this ADR inherits: the charge-moving code (hold, claim, charge, refund) is already correct, so any change here should touch sequencing and UI, not rebuild money movement. Option 1 does exactly that, adding one more clause to an existing effect's firing condition and removing a UI step, rather than introducing new server state to represent something the client can already tell correctly from data it already has (transcript status, saved edit list presence, and whether a file has been reselected in this session).

Option 2 was rejected because nothing in this ADR's acceptance criteria needs a persisted pipeline-stage value or a second route to be satisfied. The studio page already owns the reselect prompt and the auto-chain logic from ADR 0003; splitting either across a new route or a new status column adds a migration and a second surface to keep in sync, for a fact this ADR can express correctly as one more boolean-shaped clause in an effect that already exists.

## Consequences

**Positive**: a new upload requires one action (pick the file) instead of two (pick the file, then confirm a price screen), and every project gets AI polish without the user having to remember to opt in. Reselecting a video becomes a meaningful, visible trigger for real work and (when applicable) real spend, closing the gap where cutting and charging could previously happen before the user had taken any action tied to that project in the current session.

**Negative / tradeoffs**: the studio page's auto-chain effect gains one more condition to get exactly right; getting it wrong in either direction (too permissive, and it fires before reselect again; too strict, and it never fires) is the single highest-risk part of this ADR, which is why child 2 calls it out as its own build task and test scenario. The inline insufficient-funds message is a smaller, less discoverable disclosure than the modal it replaces; a user who is short on funds finds out from a line of text near the file picker rather than a dedicated screen.

**Neutral**: the `ai_cut_runs` table, its claim machinery, and its route surface are untouched, exactly as ADR 0003 left them; this ADR adds no new billing surface and no new cross-app call beyond the existing deep-link-to-wallet pattern already used for 402s.

## Follow-up

- Prune any leftover `aiPolish`/`pendingAiPolish` references in tests or analytics event names once both children ship.
- Revisit the inline insufficient-funds copy once real usage shows whether users notice it reliably next to the file picker; if not, a small toast or banner treatment (still non-modal) could replace the plain inline text.
- The server-side pre-flight at blob-token issuance (`apps/rough-cut/src/app/api/transcribe/blob-token/route.ts`) still sizes its cap against transcription cost alone, not the combined transcription-plus-polish cost the client now shows; this is unchanged behavior, not a regression, since AI polish was never billed at that step, but is worth a look if a future ADR wants server-side pricing to match the client's combined estimate exactly.
