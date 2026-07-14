# Child 1 — Upload Flow Simplification

## Summary

This child removes the upload confirm panel from the dashboard: no modal, no AI-polish toggle, no price shown before starting. Selecting a file now goes straight into extraction, Blob upload, and Deepgram transcription. AI polish is no longer a per-project choice; every new project gets it, decided server-side. The client's pre-flight funds check now prices the combined cost (transcription plus AI polish) instead of transcription alone, and shows an inline, non-modal message when funds are short instead of ever reaching the removed panel. A fresh, ready project's dashboard row is relabeled "Ready for step 2" so the user has a cue that a second, in-studio step is still owed.

**Covers**: AC-1, AC-2, AC-3, AC-4, AC-5.

## Context

Today, `apps/rough-cut/src/app/(app)/dashboard/page.tsx` holds a `pendingUpload` state (file plus metadata, set at line 210) and a `pendingAiPolish` state (line 214, defaulted `true`). `handleFileSelected` (lines 457-460) stores the selection into `pendingUpload` instead of starting anything. A confirm panel (JSX at lines 1097-1217) then renders the file name, duration, an AI-polish toggle (lines 1133-1161), and a combined price breakdown built from `chargeMicrosForSeconds`/`formatUsd` (from `@repo/ui`). Only when the user clicks "Start transcription" does `confirmPendingUpload` (lines 468-511) run: it calls `blockedByCredits(metadata.durationMs, { includeAiPolish: pendingAiPolish })` (lines 430-452, the pre-flight check), then `POST /api/projects` with `aiPolish: pendingAiPolish` in the body, then `kickOffTranscription`.

`POST /api/projects` (`apps/rough-cut/src/app/api/projects/route.ts`, lines 47-70) reads `aiPolish` out of the parsed, Zod-validated body (`createProjectSchema`, `apps/rough-cut/src/lib/validation.ts`, lines 56-66, where `aiPolish` is `z.boolean().optional().default(false)`) and writes it straight into `aiPolishRequested` on insert (line 68). The `projects.aiPolishRequested` column itself (`packages/db/src/schema.ts`, line 113) is `boolean("ai_polish_requested").notNull().default(false)`; it is read by the studio's auto-chain (ADR 0004 child 2) and flipped to `false` inside `claimAiCutSlot`'s atomic UPDATE the instant any AI Cut claim succeeds (`apps/rough-cut/src/lib/projects.ts`), a mechanism this child does not touch.

The dashboard's project list comes from `GET /api/projects` (same route file, lines 87-145). Its query (lines 118-131) explicitly selects only `id, fileName, durationMs, transcriptStatus, createdAt, updatedAt` — the comment at line 116-117 states this is deliberate, to skip the transcript and EDL jsonb columns since the list view doesn't render them. This means the list endpoint today has no way to tell whether a `"ready"` project has a saved edit list yet, which is exactly the signal needed to decide between "Ready" and "Ready for step 2." The `STATUS_META` label table (lines 29-52) currently gives `"ready"` the fixed label `"Ready"` with no further condition.

## Requirements

Covers: AC-1, AC-2, AC-3, AC-4, AC-5.

## Decision

**Chosen option**: (umbrella-level options analysis; this child is Option 1's concrete build for the upload side.)

**RECOMMEND 1 — keep the `aiPolishRequested` column, hardcode the insert, remove client control.** `packages/db/src/schema.ts`'s `aiPolishRequested` column stays exactly as it is (same name, same default, same nullability). `POST /api/projects` stops reading `aiPolish` from the request body and instead writes `aiPolishRequested: true` unconditionally on every insert. `createProjectSchema` drops the `aiPolish` field entirely (a `z.strictObject`, so a client that still sends it gets a 400, not a silently ignored field). The dashboard drops `pendingAiPolish` and the toggle UI along with the rest of the panel. Runner-up considered: since the value is now always `true`, drop the column and hardcode `true` everywhere it's read instead. Rejected because `claimAiCutSlot`'s existing one-shot-flip guarantee (AC-4 of ADR 0003) depends on this exact column to stop a crash-and-reopen from silently firing a second automatic AI charge; removing the column would mean re-deriving that safety mechanism (most likely by adding some other per-project "has an automatic attempt already been consumed" signal) for zero benefit, since the column already does this correctly and cheaply.

**RECOMMEND 4 — price the combined cost inline, no modal of any kind.** `blockedByCredits` (`dashboard/page.tsx`, lines 430-452) already accepts an `includeAiPolish` option; today only `confirmPendingUpload` passes `includeAiPolish: pendingAiPolish` (a value the user controlled via the toggle). Once the toggle is gone, every new-upload call site calls `blockedByCredits(durationMs, { includeAiPolish: true })` unconditionally, since AI polish is now always requested. On a blocked check, instead of `blockedByCredits`'s current side effect (a toast, per lines 443-448), file selection renders a small inline message near the `FilePicker` component (not a toast, not a modal) stating the shortfall and offering the existing "Add funds" deep link to `WALLET_DASHBOARD_URL`; neither `POST /api/projects` nor `kickOffTranscription` is ever called. Runner-up considered: keep a lightweight modal that only shows the price, with no toggle, as a pure disclosure step. Rejected because the engineer was explicit that no modal of any kind should remain in the upload flow — the point of removing the panel was to make selection go straight into work, and a price-only modal still reintroduces exactly the click this change is meant to remove.

**Dashboard label decision.** `GET /api/projects` gains one more selected column, a computed `hasEdl` boolean (`sql\`${projects.edl} IS NOT NULL\`` or equivalent), since the list query already deliberately omits the EDL jsonb itself for size reasons and must keep doing so — only presence, not content, is needed here. `STATUS_META`'s fixed `"Ready"` label for `"ready"` becomes conditional per-row: `"ready" && !hasEdl` renders "Ready for step 2"; `"ready" && hasEdl` renders the existing "Ready" label, unchanged. This is the smallest possible read-side addition: one boolean projected alongside the columns already selected, no new endpoint, no new round trip.

## Feature design

**Data model**: No schema change. `aiPolishRequested` keeps its existing type, default, and nullability; only the value written at `POST /api/projects` insert time changes (from client-supplied to hardcoded `true`), and client control over that value is removed. No migration is needed.

**State transitions**:
- `aiPolishRequested`: was `true` when the toggle was left on (the default) or `false` when the user turned it off; becomes always `true` for every project created after this ships. Existing rows are untouched — a project created before this change keeps whatever value it already has. The flip-to-`false`-on-claim behavior inside `claimAiCutSlot` is unchanged.
- Dashboard `pendingUpload`/`pendingAiPolish` state and the confirm-panel JSX are deleted outright. `handleFileSelected` no longer stores a pending selection; it becomes the entry point that runs the pre-flight check and, if it passes, calls `POST /api/projects` and `kickOffTranscription` directly, the way `confirmPendingUpload` does today minus the toggle and the wait for a click.

**API surface**:

| Endpoint | Method | Key inputs | Key outputs | Auth | Key errors |
|---|---|---|---|---|---|
| `/api/projects` | POST | `fileName`, `durationMs`, `fileSize`, `fileType` only — `aiPolish` removed from `createProjectSchema` and from the client request body | the created project row, `aiPolishRequested` always `true` | Clerk auth (unchanged) | unchanged (401, 429, 400 on schema mismatch — a client that still sends `aiPolish` now gets 400, since `createProjectSchema` is a `strictObject`) |
| `/api/projects` | GET | none | project list rows, now including a computed `hasEdl` boolean alongside the existing fields | Clerk auth (unchanged) | unchanged (401, 429) |

**Key invariants**:
- Every project created through `POST /api/projects` after this ships has `aiPolishRequested === true`; no request body field can override this. The only way `aiPolishRequested` is ever `false` again is the existing atomic flip inside `claimAiCutSlot` once an AI Cut claim succeeds, exactly as ADR 0003 built it.
- The client-side funds pre-flight is UX-only. It never becomes the sole gate: the server-side re-checks this ADR does not touch (blob-token issuance's affordable-seconds cap, the AI-cut route's charge-time balance check and 402) remain fully authoritative, so a user who somehow bypasses the inline message (e.g. a stale credits read) is still correctly stopped or refunded server-side.
- `hasEdl` reflects presence only, never content; the list query still never selects the EDL jsonb itself, preserving the original reason that column was excluded from the list query (payload size).
- A project with a saved edit list, or an existing AI Cut run, always reads "Ready" (never "Ready for step 2") and this child does not change any behavior for it beyond the label computation itself.

**Security model**: Unchanged. `POST /api/projects` keeps its existing Clerk auth and rate limit (`CREATE_LIMIT`/`CREATE_WINDOW_SECONDS`); removing a client-controlled field narrows, rather than widens, what the client can influence. `GET /api/projects` keeps its existing auth and rate limit; the added `hasEdl` column is derived server-side from data already scoped to the authenticated user's own rows.

**Critical test scenarios**:
- Selecting a file with sufficient funds goes straight to `POST /api/projects` (no `aiPolish` field sent) and `kickOffTranscription` fires with no intervening click or panel, verifies **AC-1**.
- The created project's `aiPolishRequested` is `true` regardless of any request body content (including a request that tries to send `aiPolish: false`, which should 400 under the strict schema), verifies **AC-2**.
- A user whose balance is below the combined transcription-plus-polish estimate sees the inline message on file selection and neither `POST /api/projects` nor `kickOffTranscription` is called; a user whose balance covers the combined estimate but not transcription-plus-polish-doubled is not incorrectly blocked, verifies **AC-3**.
- Blob-token issuance and the AI-cut charge route's own checks still independently reject an under-funded request even if the client pre-flight was somehow bypassed, verifies **AC-4**.
- A project with `transcriptStatus === "ready"` and no saved EDL renders "Ready for step 2" on the dashboard; a project with `transcriptStatus === "ready"` and a saved EDL, or an existing AI Cut run, renders "Ready" exactly as today, verifies **AC-5**.

## Build plan

Tracer-bullet ordered: the first slice gets a file selected and flowing straight through to a "Ready for step 2" row, end to end, before refining pre-flight messaging or cleaning up dead state.

1. **Server: mandatory AI polish + schema tightening.** Remove `aiPolish` from `createProjectSchema` (`apps/rough-cut/src/lib/validation.ts`); change `POST /api/projects` (`apps/rough-cut/src/app/api/projects/route.ts`) to insert `aiPolishRequested: true` unconditionally, no longer reading it from `parsed.data`. (AC-2) — done
2. **Client: file selection flows straight through.** Change `handleFileSelected` (`dashboard/page.tsx`, currently lines 457-460) to run the pre-flight check and, on success, call `POST /api/projects` (now without `aiPolish`) and `kickOffTranscription` directly — the logic `confirmPendingUpload` has today, minus the toggle and the wait for a confirm click. Delete `pendingUpload`, `pendingAiPolish`, `confirmPendingUpload`, `cancelPendingUpload`, and the Escape-key handler that closed the panel. At this point selection-to-transcribing works end to end with no modal. (AC-1) — done
3. **Client: combined-cost pre-flight + inline message.** Update every call site of `blockedByCredits` for a new upload (file selection, drag-and-drop) to pass `{ includeAiPolish: true }` unconditionally; add the inline, non-modal insufficient-funds message near `FilePicker`, replacing the toast `blockedByCredits` shows today for this call site (the toast-based behavior can stay for the retry-flow call site, which does not gain a polish cost). (AC-3, AC-4) — done
4. **Delete the confirm panel JSX.** Remove the panel's markup (currently lines 1097-1217) now that nothing references its state. (AC-1) — done
5. **Dashboard label: `hasEdl` on the list endpoint.** Add the computed `hasEdl` boolean to `GET /api/projects`'s selected columns (`apps/rough-cut/src/app/api/projects/route.ts`); extend the `Project` interface and `STATUS_META` usage in `dashboard/page.tsx` so a `"ready"` row with `hasEdl === false` renders "Ready for step 2" and a `"ready"` row with `hasEdl === true` renders "Ready" unchanged. (AC-5) — done
6. **Tests** (co-located `*.test.ts(x)`, Vitest): route test for `POST /api/projects` always writing `aiPolishRequested: true` and rejecting a request body containing `aiPolish`; route test for `GET /api/projects` returning correct `hasEdl` values; client tests for file-selection-to-transcribing with no panel, the inline insufficient-funds path, and the "Ready for step 2" versus "Ready" label logic. (all ACs in this child) — done

## Consequences

**Positive**: a user with sufficient funds goes from file picker to transcribing in one action; every project gets AI polish without needing to remember an opt-in; a fresh, ready project's row now visibly signals that a second step is still owed, rather than reading identically to a fully finished project.

**Negative / tradeoffs**: the inline insufficient-funds message is less prominent than the modal it replaces — a user might miss a small line of text near the file picker where a full-screen dialog was hard to miss. This is a deliberate tradeoff the engineer chose over any modal, not an oversight.

**Neutral**: `chargeMicrosForSeconds` and `formatUsd` (`@repo/ui`) are reused unchanged for the combined-cost pre-flight math; no new pricing logic is introduced by this child.
