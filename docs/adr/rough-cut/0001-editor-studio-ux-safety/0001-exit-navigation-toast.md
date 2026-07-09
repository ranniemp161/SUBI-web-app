# Child 1 — Exit Navigation Reassurance Toast

## Summary

When a user leaves the editor and returns to the dashboard, nothing tells them their work is safe. Everything already autosaves, so there is nothing to confirm, only something to reassure. We fire a short `sonner` toast on every exit navigation that says the project is saved and reopening it just needs the same source video. No blocking dialog, no state tracking.

## Context

The editor autosaves. There is no unsaved state at exit and no irreversible action being taken by navigating away. The one real thing a user might not know is that the source video is never stored server side, so reopening the project requires reselecting the same file.

Exit points in code today:

- A `next/link` back to the dashboard in the `StatusScreen` component (`page.tsx:1488-1493`).
- A `next/link` back to the dashboard in `TopBar` (`page.tsx:1595-1600`).

The app already uses `sonner` for toasts, including an undo-toast near `page.tsx:839`, so the pattern and the import already exist. There is no Dialog primitive in the app.

## Options considered

**Option A — Non-blocking toast on every exit navigation (chosen).**
Fire a `sonner` toast on click, do not block the navigation.
Pros: trivial, no state, reuses an existing pattern, honest (it reassures rather than pretends there is a decision to make). Cons: fires every time, which a power user may find slightly repetitive; a toast can be missed if the user looks away.

**Option B — Blocking confirm dialog on exit.**
Intercept navigation and ask "are you sure you want to leave?".
Pros: impossible to miss. Cons: it is theater. Nothing is unsaved, so the dialog asks a question with no real stakes, trains users to click through dialogs, and requires building a Dialog primitive the app does not have. Rejected.

**Option C — Toast only once per session, gated on dirty or in-flight state.**
Pros: less repetitive. Cons: requires tracking session state and in-flight state that does not otherwise need to exist, adding complexity for a message that is cheap to show. The reassurance is most valuable exactly when the user is unsure, and we cannot know when that is, so showing it every time is the simpler correct default. Rejected.

## Decision

Fire a non-blocking `sonner` toast on click of both exit links (`page.tsx:1488-1493` and `page.tsx:1595-1600`). The toast fires on every exit navigation. It does not block or delay the navigation. No new state is introduced.

Toast copy:

> **Project saved.** Your edits are stored automatically. To reopen this project, just reselect the same source video.

## Rationale

Toasts are the right tool for reassurance; blocking dialogs are for real irreversible risk. This app has no irreversible risk at exit because autosave is real, so a blocking dialog would be theater, not safety. Firing on every navigation avoids any state tracking, which is the simplest thing that reliably delivers the reassurance. The copy names the one non-obvious fact (reselect the same source file) that a user genuinely needs on reopen.

## Requirements

- **AC-1**: Clicking the dashboard link in `StatusScreen` (`page.tsx:1488-1493`) shows a `sonner` toast and still navigates to the dashboard.
- **AC-2**: Clicking the dashboard link in `TopBar` (`page.tsx:1595-1600`) shows a `sonner` toast and still navigates to the dashboard.
- **AC-3**: The toast text states both that the project is saved and that reopening requires reselecting the same source video.
- **AC-4**: The toast never blocks, delays, or cancels the navigation, and no new component (Dialog/AlertDialog) is added.

## Build plan

1. Add an `onClick` handler to the `StatusScreen` exit link that calls `toast(...)` with the copy above, without `preventDefault`. (AC-1, AC-3, AC-4)
2. Add the same `onClick` handler to the `TopBar` exit link. Extract the toast call into a small shared function so the copy lives in one place. (AC-2, AC-3, AC-4)

## Consequences

**Positive**: Users get clear reassurance on exit with near-zero code and no new dependency. Reuses an established pattern.

**Negative / tradeoffs**: The toast fires on every exit, which a frequent user may find mildly repetitive. A toast can be missed if the user is not looking. Both are acceptable given the message is low stakes and purely reassuring.

**Neutral**: No migration, no schema change, no new component. Fully revertable in one commit.
