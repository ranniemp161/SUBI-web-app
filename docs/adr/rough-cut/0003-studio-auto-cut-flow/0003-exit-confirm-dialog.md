# Child 3 — Exit Confirm Dialog

## Summary

Leaving the studio today fires a `sonner` toast that reassures the project is saved but never blocks the click, so it can be missed entirely if the user looks away. This child replaces it with a real, blocking confirm dialog, the first shared component `packages/ui` ships. It also adds a native browser warning, but only for the one moment leaving genuinely risks losing something: while the AI pass is actively running.

**Covers**: AC-8.

## Context

Both exit points fire the same toast today: `showExitReassuranceToast` (`page.tsx:96-101`), wired to the `StatusScreen` dashboard link (`page.tsx:1792-1798`) and the `TopBar` dashboard link (`page.tsx:1900-1906`). Neither link calls `preventDefault`, so the navigation always proceeds immediately regardless of whether the toast is seen. ADR 0001's child 1 deliberately chose this shape because, at the time, there was genuinely nothing at stake: the editor autosaves, and a blocking dialog for a decision with no real stakes was explicitly called "theater" (`docs/adr/rough-cut/0001-editor-studio-ux-safety/0001-exit-navigation-toast.md`).

That reasoning still holds for ordinary editing. It stops holding the moment child 1's auto chain (or a manual "Polish with AI" click) is mid-flight: a Gemini call is in progress, a credit hold exists, and navigating away, or closing the tab, mid-request is exactly the kind of moment a user benefits from a real pause, both to avoid abandoning a paid operation they may not realize is still running, and to avoid the confusing "did that charge go through?" experience of leaving before the claim resolves.

`apps/rough-cut` and `packages/ui` have no Dialog or AlertDialog primitive anywhere today (`packages/ui/src/` ships only `theme.css`, `index.ts`, and `money.ts`). Building this once, in `packages/ui`, means the wallet app inherits a working, themed confirm dialog for free the first time it needs one, rather than every app growing its own bespoke version.

## Requirements

Covers: AC-8.

## Decision

**Chosen option**: build a themed Radix AlertDialog wrapper in `packages/ui`, use it for both exit links; add a `beforeunload` listener scoped strictly to the AI-busy window.

**RECOMMEND 4 — the wrapper's API shape.** A single named component, controlled (no uncontrolled trigger), matching the confirm-dialog shape both call sites need:

```ts
export interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  confirmLabel: string;
  cancelLabel: string;
  onConfirm: () => void;
}

export function ConfirmDialog(props: ConfirmDialogProps) { /* ... */ }
```

Built on `@radix-ui/react-alert-dialog`'s `Root`, `Portal`, `Overlay`, `Content`, `Title`, `Description`, `Action`, `Cancel`, styled with the existing tokens in `packages/ui/src/styles/theme.css` (the same surface/border/foreground tokens the studio's own overlays already use, for example `AiCutOverlay`'s `bg-black/60 backdrop-blur-sm` treatment). `ConfirmDialog` is a named function component (not an anonymous arrow), consistent with the project's lint rule for component definitions. Runner-up: a bespoke, from-scratch dialog built from plain `div`s and a manual focus trap — rejected, Radix already solves focus trapping, ESC handling, and correct ARIA roles for this exact pattern, it is a proven, widely used library with strong docs, and it is the engineer's confirmed pick; writing that logic by hand would be reinventing a solved, boring problem.

**RECOMMEND 5 — `beforeunload` wiring.** A dedicated effect, scoped to the studio page's existing `aiBusy` state (already true for the whole duration of an AI phase, automatic or manual, per child 1 and child 2):

```ts
useEffect(() => {
  if (!aiBusy) return;
  const handler = (e: BeforeUnloadEvent) => {
    e.preventDefault();
    e.returnValue = "";
  };
  window.addEventListener("beforeunload", handler);
  return () => window.removeEventListener("beforeunload", handler);
}, [aiBusy]);
```

Attached only while `aiBusy` is true, detached the instant it flips false (success, failure, or 402), so a user editing normally never sees a browser-native "leave site?" prompt, only the in-app dialog. Runner-up: a single listener attached once at mount, guarded internally by reading a ref on every `beforeunload` event — rejected as unnecessary indirection; attaching and detaching via the effect's own dependency array is the standard React pattern here and costs nothing extra.

## Feature design

**Data model sketch**: none.

**State transitions**:
- Clicking either Dashboard link no longer navigates immediately: it opens the `ConfirmDialog` (`open: true`) instead of calling `showExitReassuranceToast`. "Leave" confirms and performs the navigation (`router.push("/dashboard")` or an equivalent programmatic navigation, since the link's default click-through is now intercepted). "Keep editing" or dismissing (ESC, overlay click, per Radix's default AlertDialog behavior) closes the dialog and does nothing else.
- `beforeunload`: attached exactly while `aiBusy` is true (covers both child 1's automatic AI phase and child 2's manual "Polish with AI" click, since both set the same `aiBusy` state), detached the instant it resolves.

**API surface**: none (client-only).

**Key invariants**:
- The confirm dialog's copy still carries the one genuinely useful fact from the old toast (autosave is real, reopening needs the same source file), it just requires an explicit "Leave" click instead of firing and forgetting.
- The `beforeunload` warning is never shown outside the AI-busy window; ordinary editing, exporting, or navigating away from a fully idle studio triggers no native browser prompt, only the in-app dialog described above.
- Both exit points (`StatusScreen`, `TopBar`) render the same `ConfirmDialog` instance/copy, sharing one small trigger function, the same way the current toast is a single shared `showExitReassuranceToast` call wired to both links.

**Security model**: unchanged; this is a UI-only change with no new server surface.

**Configuration required**: none. `@radix-ui/react-alert-dialog` is a new dependency of `packages/ui` (a small, well-known Radix primitives package, consistent with the project's existing dependency profile), not a new environment variable or service.

**Critical test scenarios**:
- Happy path, leave: click a Dashboard link, verify the dialog opens and no navigation has happened yet; click "Leave," verify navigation proceeds, verifies **AC-8**.
- Happy path, keep editing: click a Dashboard link, verify the dialog opens; click "Keep editing" (or dismiss), verify no navigation happens and the studio stays interactive, verifies **AC-8**.
- `beforeunload` scoping: with `aiBusy` true, verify a `beforeunload` handler is attached (its `preventDefault` fires on a simulated event); once `aiBusy` flips false, verify the handler is removed, verifies **AC-8**.
- Regression, ordinary editing: with `aiBusy` false throughout, verify no `beforeunload` handler is ever attached during normal editing and exporting, verifies **AC-8**.

## Build plan

1. Add `@radix-ui/react-alert-dialog` as a dependency of `packages/ui`; build `ConfirmDialog` (the API shape above) in a new `packages/ui/src/confirm-dialog.tsx`, styled with the existing theme tokens; export it from `packages/ui/src/index.ts`. (AC-8)
2. Replace `showExitReassuranceToast` (`page.tsx:96-101`) and its two call sites (`StatusScreen`, `page.tsx:1792-1798`; `TopBar`, `page.tsx:1900-1906`) with a shared `open`/`onOpenChange` state and a single `ConfirmDialog` instance rendered once in the studio page, wired to both links (intercepting the default navigation and performing it only from "Leave"). (AC-8)
3. Add the `beforeunload` effect scoped to `aiBusy`, as specified above. (AC-8)
4. Tests (co-located `*.test.ts(x)`, Vitest + Testing Library): the dialog's open/confirm/cancel flow from both exit points, and the `beforeunload` attach/detach behavior keyed on `aiBusy`. (AC-8)

## Consequences

**Positive**: leaving the studio now requires a real, impossible-to-miss decision, and the one moment that genuinely has something at stake (an in-flight, paid AI pass) gets the stronger native browser warning on top, without over-warning during ordinary editing. `packages/ui` gains its first real component, immediately reusable by `apps/wallet`.

**Negative / tradeoffs**: leaving the studio is now one click slower in the common case (a deliberate trade for AC-8, not an oversight); a user who exits dozens of times a session will click "Leave" every time, the same repetition tradeoff ADR 0001's child 1 already accepted for the toast, now paid as an explicit click instead of an ignorable notification.

**Neutral**: `sonner` remains in use everywhere else in the app (autosave failures, undo, cut confirmations); this child does not replace toasts generally, only the one exit-specific case that now needs a real blocking decision.
