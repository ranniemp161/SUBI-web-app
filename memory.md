# Memory — Editor Studio UX Safety (rough-cut): built, tested, hardened

Last updated: 2026-07-09

## What was built

Full pipeline run on the "Editor Studio UX Safety" feature (`apps/rough-cut`), governed by umbrella ADR `docs/adr/rough-cut/0001-editor-studio-ux-safety/index.md` (4 children). Went through `/develop` → `/verify` → `/test` → `/harden` → two harden-fix rounds → `/sync`, all in this session.

- **Child 1 (exit toast)**: `showExitReassuranceToast()` in `page.tsx`, wired to both the `StatusScreen` and `TopBar` dashboard links' `onClick` (no `preventDefault`).
- **Child 2 (AI Cut re-run guard)**: `ai-cut/route.ts` POST returns 409 `AI_CUT_ALREADY_RUN` before charging once `aiCuts.ranges.length > 0`; new `DELETE` handler clears `aiCuts` (no refund). Client shows an "already run" toast with a Clear action, and a confirm action-toast before the DELETE fires.
- **Child 3 (reselect verification)**: `FilePicker` takes an optional `expectedDurationMs` prop; blocks a reselect whose duration differs by more than 1500ms, resets the input on rejection.
- **Child 4 (frame accuracy)**: `normalizeDeepgram` snaps every word's start/end to a 1/30s grid; Deepgram request now includes `utterances: "true"`.
- **Hardening fix 1 — concurrency**: added `claimAiCutSlot`/`releaseAiCutClaim` to `apps/rough-cut/src/lib/projects.ts` — an atomic conditional-UPDATE claim (mirrors `reserveCredits`'s `hold_micros IS NULL` gate in `lib/credits.ts`) that closes a real TOCTOU double-charge race: two concurrent AI Cut POSTs could otherwise both pass the empty-`aiCuts` guard and both charge. Losing claim returns 409 `AI_CUT_IN_PROGRESS`. Claim is released on every failure path (insufficient credits, Gemini error, size guard, any exception) so a failed run never leaves the project stuck "pending"; a claim older than 6 minutes (`AI_CUT_CLAIM_STALE_MS`) is reclaimable.
- **Hardening fix 2 — dead option**: `utteranceEnds` (frame-snapped Deepgram utterance boundaries) now flows from `normalizeDeepgram` through `Transcript.utteranceEnds` (`edl.ts`) into `retake-detection.ts`'s `groupIntoSentences`, which uses real acoustic boundaries instead of a fixed-pause/punctuation heuristic when available (falls back to the old heuristic for older transcripts with no `utteranceEnds`). Threaded through `buildAutoLayer`/`buildInitialEDL`/`reRoughCut` and wired at the one call site, `page.tsx`'s `reRunRoughCut`.
- Full test suite: 27 files, 286 tests, all green. Typecheck clean. Also fixed 4 pre-existing type errors in the `/test`-written test files (vitest doesn't full-typecheck, so they'd slipped through).
- `docs/hardening/2026-07-09-uncommitted.md` — both should-harden items marked Fixed; posture is now Ship as-is.
- `apps/rough-cut/AGENTS.md` — `/sync` added one Conventions bullet documenting the atomic-holds/claims pattern (`reserveCredits` + the new `claimAiCutSlot`), so future charged operations follow the same shape.
- `docs/roadmap/rough-cut/roadmap.md` — feature 2 "Editor Studio UX Safety": Design, Build (+ all 4 milestones), and Test are ticked; **Verify is deliberately left unticked** (partial — see below).

## Decisions made

- The AI Cut claim marker is stored as a **valid `AiCuts` shape** (`{ranges: [], model: "__pending__", createdAt}`) rather than a different sentinel type — so every existing reader (`hasAiCuts`, `applyAiCuts`) sees "no cuts yet" instead of crashing on an unexpected shape. This was a deliberate compatibility choice made without asking, to avoid a second migration/schema thought.
- Did **not** touch the Gemini AI Cut prompt (`ai-rough-cut.ts`) to consume utterances — that's a carefully calibrated, real-footage-tuned prompt, and the ADR already said word-level timestamps remain its primary driver. Utterances only feed the deterministic retake-detection heuristic. If the user wants utterances in the Gemini pass too, that should be its own `/architect` decision, not bundled in here.
- Chose to fix both hardening items outright (user said "yes wire it needs to work" and "fix it please") rather than leave either as an accepted risk.

## Problems solved

- Confirmed via direct code reading (not just trusting the `/test` subagent's flag) that the concurrent double-charge race was real: the rate limiter is a fixed-window per-user limit (doesn't stop 2 simultaneous requests), and the Idempotency-Key lock doesn't help either since the client mints a fresh UUID per run (`page.tsx`), so two tabs never collide on the same key.
- The old pause-heuristic sentence grouping (`retake-detection.ts`) provably misses a fast re-take spoken with no pause and no terminal punctuation — proved this with a new test that fails the old way and passes once utterance boundaries are supplied.
- `/verify` for this feature could not exercise the real UI/session flows (no browser automation tool, no Clerk test credentials in this environment) — resolved by being explicit about what was verified via direct code/runtime checks (frame-snap math, auth-gate 401s, dev-server boot) versus what's blocked pending a manual signed-in pass.

## Current state

- All code changes are **uncommitted** in the working tree (branch `main`, not behind `origin/main`).
- Everything is built, typechecked, and tested green. Both hardening findings are fixed and verified by new tests.
- The roadmap's **Verify it** box is intentionally still unchecked — the earlier `/verify` pass was partial (blocked on browser/session flows: the exit toast rendering visibly, the real AI Cut charge/re-run against a live session, the real video-duration-mismatch UI flow). `verify.md` beside the ADR has the full manual checklist tagged by AC-N.
- Also still uncommitted from a prior session (2026-07-08, untouched this session): wallet app's auto-recharge UX fix + payment-system security-audit fixes (unrelated work, can be committed independently — see `docs/reviews/2026-07-08-payment-system-security-audit.md`).

## Next session starts with

- Run through `verify.md`'s manual steps once against a real signed-in session (sign in via Clerk, open a real project, try the exit toast, the AI Cut already-run flow, and a mismatched-video reselect), then re-run `/verify editor studio ux safety` to tick that box — which unlocks the feature moving to `done`.
- Separately, still pending: decide whether/how to commit this session's rough-cut changes, and independently the prior session's wallet security-audit fixes.

## Open questions

- Carried over: the Postgres-backed `ON CONFLICT` idempotency integration test (wallet, flagged 2026-07-08) remains an open gap if the user wants to invest in test-DB infra later.
- Whether the Gemini AI Cut prompt should eventually consume utterance boundaries too (deliberately deferred this session, see Decisions).
