# Child 2 — AI Cut Re-run Guard

> Superseded by [0003 child 1](../0003-studio-auto-cut-flow/0001-auto-cut-pipeline.md) and [0003 child 2](../0003-studio-auto-cut-flow/0002-ai-rerun-removal.md) (2026-07-11): the Clear-then-re-run mechanism described here is superseded, since the manual "Clear AI Cuts" action and the button it protected are both removed. The core principle this child established, never charge for an operation whose result cannot differ, is inherited and now enforced structurally: 0003 makes the single AI attempt automatic and one-shot (a server-side flip on the project row), rather than relying on a client-confirmed clear-then-rerun step to prevent a second charge.

## Summary

AI Cut charges credits on every POST, even though re-running it on the same transcript produces the same result. The only thing stopping a re-run today is a hidden button in the UI, which a direct API call ignores. We block the re-run on the server: once results exist, the route refuses with a 409 and charges nothing. To run a fresh paid pass, the user must first clear the existing results through an explicit, confirmed "Clear AI Cuts" action.

## Context

The AI Cut route (`apps/rough-cut/src/app/api/projects/[id]/ai-cut/route.ts:93-114`) always charges. After the transcript-ready check, it calls `chargeAiCut` (`route.ts:104`) unconditionally, then runs the Gemini pass and stores the result in `project.aiCuts`. There is no check against whether `project.aiCuts.ranges` already has entries.

The UI hides the "Enhance with AI Cut" button once `hasAiCuts` is true (`transcript-panel.tsx:654-668`, computed in `page.tsx:1009`). That is a UI-only guard. Anyone who calls the API directly, or whose client retries after the button was already hidden, gets charged again for a result that is byte-for-byte the same class of output.

An `Idempotency-Key` header path exists (`route.ts:61-76`) but it only protects a single retried request within a 24 hour window. It does not protect a fresh, deliberate second run days later, which is exactly the accidental re-charge case here.

The credits model (`apps/rough-cut/src/lib/credits.ts`) is hold/settle/refund, used only for the original transcription and AI-cut operations. It has no concept of refunding a client-side reset, and it should not gain one.

## Options considered

**Option A — Block server-side once results exist, add an explicit Clear action to reset (chosen).**
Reject the POST with 409 when `project.aiCuts.ranges.length > 0`, before any charge. Add a separate, confirmed "Clear AI Cuts" action that empties `project.aiCuts` and re-enables a fresh paid run.
Pros: closes the double-charge at the real trust boundary; the only way to pay again is a deliberate clear-then-rerun; no refund logic needed. Cons: a user who genuinely wants different suggestions must clear first, a two-step flow; clearing discards the current suggestions.

**Option B — Block server-side, but allow an override re-run with re-confirmation in the same request.**
Pros: one-step re-run for the rare "I really want to pay again" case. Cons: an override flag on a charging endpoint is exactly the kind of thing a buggy client or a retry can set by accident, which reopens the double-charge hole we are closing. The clear-then-rerun path already covers the legitimate case with a clearer intent signal. Rejected.

**Option C — Keep the UI-only guard, add nothing server-side.**
Pros: no backend change. Cons: it is not a guard. A direct API call or a client retry still charges. This is the status quo bug. Rejected.

## Decision

**Server guard.** In the AI Cut POST route, after loading the project and before the charge (`route.ts:103`), check `project.aiCuts?.ranges?.length`. If greater than zero, return 409 with a machine-readable code and no charge:

```json
{ "error": "AI Cut has already run for this project. Clear it first to run again.", "code": "AI_CUT_ALREADY_RUN" }
```

The client keys off `code: "AI_CUT_ALREADY_RUN"` to show the "already run" state rather than a generic error. (The route already returns 409 for other conflict states such as transcript-not-ready at `route.ts:94-98`, so 409 is the consistent status here.)

**Clear action.** Add `DELETE /api/projects/[id]/ai-cut`. It sets `project.aiCuts` to its empty shape and `updatedAt`, returns 200, and issues no credit refund. A DELETE on the same collection resource follows the app's REST-ish `/api/projects/[id]/...` convention and reads as "remove the AI cut results", which is exactly what it does. It is preferred over extending a generic PATCH because it is a single-purpose, self-documenting endpoint.

**API surface:**

| Method | Path | Behavior |
|---|---|---|
| POST | `/api/projects/[id]/ai-cut` | Run AI Cut. **New**: 409 `AI_CUT_ALREADY_RUN` if results exist, before any charge. |
| DELETE | `/api/projects/[id]/ai-cut` | Clear AI Cut results. No charge, no refund. Re-enables a fresh POST. |

**Clear confirm (UI).** The Clear action is a deliberate secondary control (for example inside a menu or a secondary control near the AI Cut section, not a stray button beside the main action). Because clearing discards existing suggestions, it requires its own confirm before firing. Since the app has no Dialog primitive, the confirm is a `sonner` action-toast (the same action-toast pattern already used for undo), with an explicit "Clear" action button the user must press:

> **Clear AI Cut suggestions?** This removes the current AI suggestions. Running AI Cut again will use credits. [Clear] [Cancel]

## Rationale

The core principle: never charge money or credits for an operation whose result cannot differ from the last charged run. AI Cut is deterministic over the same transcript, so a second run bills for nothing new.

The server is the only real trust boundary. The current UI-only guard is bypassed by any direct call or client retry, so moving the check into the route is the actual fix, not a nicety. Placing the 409 before `chargeAiCut` guarantees no hold is ever taken for a blocked run, so there is nothing to refund and no window where a charge exists for a rejected request.

Clearing is a reset of derived data, not a billing event, so it issues no refund, consistent with the existing credits model which only refunds failed original operations. Requiring an explicit confirmed clear before a paid re-run means every charge maps to a deliberate user intent.

## Requirements

- **AC-1**: A POST to `/api/projects/[id]/ai-cut` when `project.aiCuts.ranges.length > 0` returns 409 with `code: "AI_CUT_ALREADY_RUN"` and calls neither `chargeAiCut` nor the Gemini pass.
- **AC-2**: A POST when no AI cut results exist runs and charges exactly as today.
- **AC-3**: A DELETE to `/api/projects/[id]/ai-cut` empties `project.aiCuts`, returns 200, issues no refund, and a subsequent POST is allowed and charges.
- **AC-4**: The DELETE route enforces the same auth and project-ownership checks as the POST route.
- **AC-5**: The Clear UI control shows a confirm (action-toast) and only calls DELETE when the user presses the explicit Clear action; Cancel or dismiss does nothing.
- **AC-6**: The client, on receiving `AI_CUT_ALREADY_RUN`, shows the already-run state rather than a generic failure message.

## Build plan

1. Add the `aiCuts` non-empty check in the POST route before `chargeAiCut` (`route.ts:103`); return 409 `AI_CUT_ALREADY_RUN`. (AC-1, AC-2)
2. Add the `DELETE` handler in the same route file, reusing `getOwnedProject` and the auth guard, setting `aiCuts` to empty and `updatedAt`. (AC-3, AC-4)
3. Add the confirmed "Clear AI Cuts" control in the AI Cut UI section, wired to DELETE via a `sonner` action-toast confirm. (AC-5)
4. Handle the `AI_CUT_ALREADY_RUN` code on the client to render the already-run state. (AC-6)

## Consequences

**Positive**: The double-charge hole is closed at the trust boundary. Every AI Cut charge now maps to a deliberate run. The Clear action gives an intentional, confirmed path to a fresh pass.

**Negative / tradeoffs**: A user who wants different suggestions must clear first, a two-step flow. Clearing is destructive to the current suggestions and the original charge is not refunded, so a user who clears expecting a free re-run will be surprised; the confirm copy states the credit cost to reduce that. The action-toast confirm is less emphatic than a modal, an accepted limit given no Dialog primitive exists.

**Neutral**: No migration and no schema change; `aiCuts` already exists on the project. Fully revertable in one commit.

## Follow-up

- If the engineer later wants a paid re-run without discarding the current suggestions (for example to compare two AI passes), that is a genuinely new billing case and should be its own decision. It would need a versioned or additive `aiCuts` shape and an explicit, non-accidental "run again and charge me" intent, deliberately out of scope here.
- Consider surfacing when AI Cut was last run (a timestamp) so the already-run state can tell the user the results are current rather than stale.
