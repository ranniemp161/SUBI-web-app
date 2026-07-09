# ADR 0001 — Editor Studio UX Safety

**Status**: Accepted

## Summary

The Rough Cut editor studio works, but four small gaps let a user lose confidence or lose money. This umbrella groups four related fixes: reassure the user on exit, stop AI Cut from charging twice for the same result, catch a wrong video on reselect, and tighten transcript and frame timing. Each fix is a thin vertical slice built end to end. They ship together because they all touch the same editor page and share the same UI toolkit.

## Context

The editor studio (`apps/rough-cut/src/app/(app)/dashboard/[id]/page.tsx`) is a live, working feature. Users upload a video, its audio is transcribed by Deepgram, the transcript drives an editable timeline, and export runs client side. The video is never stored on the server, so reopening a project means reselecting the same source file.

The four gaps here are not new features. Each is a safety or accuracy hole in behavior that already exists:

1. Leaving the editor gives no signal that work is saved, even though everything autosaves.
2. AI Cut charges credits on every POST, even when the result cannot change, and the only guard is a hidden button in the UI.
3. Reselecting the source video on reopen accepts any file, so the original transcript's timestamps can be applied to a completely different video.
4. Transcript word boundaries and seek positions carry raw sub-frame floats with no frame alignment.

Shared context, stated once here so the children do not repeat it:

- **One page, four touch points.** Children 1, 2, and 3 all wire into `page.tsx`. Child 4 changes the transcription pipeline (`src/lib/deepgram.ts` and the Deepgram request options) that feeds that page.
- **Toolkit today.** The app uses `sonner` toasts for user messaging (there is an existing undo-toast around `page.tsx:839`). There is no Dialog or AlertDialog primitive anywhere in `apps/rough-cut`. Any child that needs a confirm step must account for that: reuse toasts where a toast is honest, and only child 2's "Clear AI Cuts" needs a real deliberate confirm.
- **Server is the only trust boundary.** A guard that lives only in the client is not a guard. Child 2 depends on this principle directly.
- **No new schema.** Child 3 reuses `durationMs` (`packages/db/src/schema.ts:81`), already stored. No child needs a migration.

> ⚠️ Premise note: Child 1 (exit toast) is genuinely small — it is one toast wired to two links, with no state and no data model. It sits at the floor of what warrants an ADR entry. It stays in the umbrella anyway because it belongs to the same "editor studio UX safety" theme and the engineer chose the umbrella-of-four shape deliberately; its child file is kept short and its Options section is honest but brief. No cross-child prerequisite is unresolved: child 2's server guard needs only the already-stored `aiCuts` field, child 3 needs only the already-stored `durationMs`, and children 1 and 4 depend on nothing new. The four can be built in any order.

## Structure

| Child | File | Covers | Decision it supports |
|---|---|---|---|
| 1 | [0001-exit-navigation-toast.md](./0001-exit-navigation-toast.md) | A non-blocking `sonner` toast on every navigation from the editor to the dashboard, reassuring that work is saved and reopening needs the same source file. | Reassure on exit without a blocking dialog. |
| 2 | [0002-ai-cut-rerun-guard.md](./0002-ai-cut-rerun-guard.md) | A server-side 409 guard that refuses a second AI Cut run once results exist, plus an explicit confirmed "Clear AI Cuts" action to reset and allow a fresh paid run. | Never charge twice for a result that cannot change. |
| 3 | [0003-video-reselect-verification.md](./0003-video-reselect-verification.md) | A duration match check on reselect against the stored `durationMs`, blocking a mismatched file outright and resetting the picker. | Stop the wrong video from silently corrupting the timeline. |
| 4 | [0004-transcript-frame-accuracy.md](./0004-transcript-frame-accuracy.md) | Add `utterances: true` to the Deepgram request, and snap word timestamps to a 1/30s grid inside `normalizeDeepgram` so every downstream consumer sees frame-aligned values. | Improve recognition grouping and seek/cut precision. |
