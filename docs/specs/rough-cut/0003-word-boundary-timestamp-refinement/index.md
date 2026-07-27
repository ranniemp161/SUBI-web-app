# 0003. Word boundary timestamp refinement

**Date**: 2026-07-21
**Status**: Accepted

## Summary

Deepgram's word timestamps are a good estimate, not an exact measurement, so a word can appear "kept" in the transcript while the actual cut on the timeline lands a little early or late, and the reverse. This spec adds a second, lightweight pass that tightens each word's start and end time against the real audio, entirely in the browser, using the same decoding the app already does for the timeline's waveform. No new vendor, no new cost, and the audio never leaves the user's device. It runs once per project, quietly, after the source video is reselected.

## Requirements

**User stories**:
- As an editor, I want a word I cut to be removed exactly, and a word I did not cut to stay fully intact, so the transcript and the timeline agree about what got cut.
- As an editor, I want this to just work without doing anything extra, so precision improves without a new step in my workflow.

**Acceptance criteria**:
- **AC-1**: After a project's source video is reselected (a fresh project or a returning one), a background pass refines each word's `start`/`end` using a local search of the real decoded audio near Deepgram's reported timestamp, running once per project.
- **AC-2**: A word whose true boundary cannot be confidently found within the search window keeps its original Deepgram timestamp unchanged; refinement never makes a timestamp worse or removes a usable one.
- **AC-3**: Once the pass completes, the refined timestamps are visible immediately in the open editor (transcript highlighting, cut precision) without a reload, and are persisted so they survive one.
- **AC-4**: The pass never re runs for a project once it has completed, on this or a later reselect.
- **AC-5**: A manual cut made after refinement completes (word select cut, Cut left/right, trim drag) lands on the refined boundary, closing the bug class already found in the transcript/timeline sync work.
- **AC-6**: The refinement pass introduces no new third party vendor, and the audio is never sent off the user's device.
- **AC-7**: If the browser cannot decode the needed audio for this pass (an unsupported codec, a decode error, the tab closing mid pass), the project is left exactly as it was before the pass (no flag flipped, no timestamps changed) and no error is shown to the user; the pass is simply retried on the next reselect.
- **AC-8**: The pass does not block or measurably delay the editor becoming usable after reselect; it runs the same way the existing waveform decode already does, quietly, in the background.

## Decision

**Chosen option**: Client side energy threshold boundary snap.

A new client side module computes a fine grained audio energy envelope from the reselected source file in one streaming pass, then refines each word's `start`/`end` by searching a small window around Deepgram's reported timestamp for the nearest real speech boundary in that envelope. The pass runs once per project, in the background, triggered the same way the existing waveform decode already is.

## Rationale

Reasoning and options considered: see [rationale.md](rationale.md).

## Feature design

**Data model sketch**:
- `projects` table: new column `wordsAligned boolean not null default false`. Set true once the refinement pass completes for a project (successfully or with some words falling back to their raw timestamp); gates AC-4 (never re run).
- `TranscriptWord` (the existing `word`/`start`/`end`/`confidence` shape, stored in the `projects.transcript` jsonb column): new optional field `aligned?: boolean`, true when that word's timestamp was refined, absent or false when it fell back to Deepgram's original value. Refined values overwrite `start`/`end` in place; there is no separate "raw" copy kept.

**State transitions**:
`wordsAligned`: `false` (every project starts here, including ones transcribed before this spec ships) to `true` (set once, client side, the first time the refinement pass completes after a reselect; never reverts).

**API surface**:
| Endpoint | Method | Key inputs | Key outputs | Auth | Key errors |
|---|---|---|---|---|---|
| /api/projects/:id | PATCH (existing route, extended) | `transcript` (with refined `words[]`) AND `wordsAligned` (new, explicit) | `{ success: true, updatedAt }` | existing project ownership gate (`authz.ts`) | unchanged from today's PATCH behavior |

No new endpoint, but two explicit additions are required (cross checked: the route does not persist a field just because the column exists): `patchProjectSchema` (`lib/validation.ts`) gains a top level `wordsAligned: z.boolean().optional()` field, alongside `transcriptWordSchema` gaining `aligned: z.boolean().optional()`; and the PATCH route handler (`api/projects/[id]/route.ts`) gains `if (wordsAligned !== undefined) updateData.wordsAligned = wordsAligned;` next to its existing `transcript`/`edl` field checks. Without both, the flag is silently never saved and AC-4 fails (the pass would re-run forever).

This PATCH bumps `updatedAt` unconditionally like any other write. If it lands between two EDL autosaves, the autosave hook's cached `baseUpdatedAt` goes stale and its next save gets one 409, which its existing retry path already self-heals (re-diffs against the returned current state, see `lib/edl-autosave.ts`). No new handling needed, noted here so it isn't rediscovered as a surprise.

**Value sourcing**:
| Action | Value produced or displayed | Source |
|---|---|---|
| Refine one word's boundary | The search window to scan | Deepgram's own reported `start`/`end` for that word, widened by `SEARCH_WINDOW_SECONDS = 0.15` (150 milliseconds each direction, matching the constant already used for the timeline's own playhead cut snap, spec 0002) |
| Refine one word's boundary | The audio signal searched | A fresh, one time, one pass streaming decode of the reselected source file (`mediabunny`), folded into a fixed 5 millisecond resolution energy envelope, held in memory only for the duration of the pass |
| Refine one word's boundary | Whether refinement succeeded (`aligned`) | The envelope's first crossing, inside the search window, that stays above (the window's own local minimum plus 30% of that window's own minimum to maximum range) for at least 15 milliseconds continuously (a minimum hold, not a single sample crossing; a threshold relative to that word's own local audio, never a fixed global amplitude, since recording loudness varies project to project); no such crossing found means no refinement, not a guess |
| Mark a project's pass complete | `wordsAligned` | Set by the client once every word in the transcript has been searched (successfully or not), then persisted via the PATCH above |
| Trigger the pass | When it runs | `sourceFile` becoming non-null (the existing reselect signal) AND `project.wordsAligned === false` AND `transcriptStatus === "ready"`, independent of ADR 0004's fresh-project-only auto cut chain gate (AC-1 applies to every project, not just fresh ones) |

**Key invariants**:
- Refinement only ever narrows the gap between a word's reported and true boundary; it never invents a boundary the underlying audio does not support (AC-2's "never worse" guarantee is enforced by leaving `start`/`end` untouched whenever the search finds no confident crossing).
- The pass is idempotent and safe to interrupt: nothing is written until the whole transcript has been searched, so a browser tab closed mid pass leaves the project exactly as it was (still `wordsAligned: false`), simply retried on the next reselect.
- The pass never touches the EDL (the cut/keep segment list); it only refines the word timestamps that later cuts, trims, and highlights read from. An already edited project's existing cuts are never silently rewritten.
- **Mid pass edit guard** (cross checked; without this, the pass could reintroduce the exact drift bug it exists to close): if the user cuts, trims, or restores anything while the pass is still running, the EDL bakes in that edit's boundary against the word's pre-refinement timestamp. At write time (the single point where results are persisted, after the whole transcript has been searched), re-read the current EDL and skip overwriting `start`/`end` for any word whose current segment shows manual activity (`reason: "manual"`) touching its span; leave that one word's timestamp exactly as the user's own edit already established it. Every other word still refines normally.
- **Main thread yielding**: the envelope decode and the per word search both run in chunks (yielding, e.g. between each decoded audio chunk and after a bounded batch of word searches) rather than as one long synchronous pass, the same "hold one small piece of work at a time" shape `waveform.ts`'s existing streaming decode already uses. This is what actually delivers AC-8, not just the claim that it runs in the background.

**Security model**:
Unchanged from today. No new third party ever receives the audio (the one property this spec is built to preserve); the PATCH this pass uses is gated by the same project ownership check every other project write already goes through.

**Configuration required**:
None. No new environment variables, credentials, or feature flags.

**Critical test scenarios**:
- Happy path: reselect a project's source video, wait for the background pass, confirm at least one word's `start`/`end` changed and `aligned: true`, verifies **AC-1**, **AC-3**.
- Fallback: a word placed over synthetic noise with no clear silence to speech crossing in its search window keeps its original timestamp and `aligned` stays false/absent, verifies **AC-2**, **AC-7**.
- Regression: cut a word via Cut left/right after the pass completes, confirm the cut lands exactly on the refined boundary, verifies **AC-5**.
- Idempotency: reselect the same project a second time, confirm the pass does not re run (no second PATCH, `wordsAligned` still true from before), verifies **AC-4**.
- Non-blocking: reselect a long video, confirm the editor becomes interactive at the same speed as before this feature (no new blocking wait), verifies **AC-8**.

## Build plan

Read in pre flight: this app's default build approach is Tracer Bullet (thin vertical slices through every layer, working end to end, then thickened). The plan below stands up one real word getting refined and persisted end to end before hardening every edge case.

1. Migration: add `wordsAligned boolean not null default false` to `projects`; extend `TranscriptWord`/`transcriptWordSchema` with the optional `aligned` field; add `wordsAligned: z.boolean().optional()` to `patchProjectSchema` AND the corresponding `if (wordsAligned !== undefined) updateData.wordsAligned = ...` line to the PATCH route (cross checked: both are required, the column alone does not make the field persistable). Satisfies **AC-4** (foundation).
2. Build the core refinement algorithm as a pure, unit tested module (new `lib/word-alignment.ts`, mirroring `waveform.ts`'s streaming decode pattern): the one pass fine grained (5ms bucket) energy envelope extraction, and the per word local search/snap function against that envelope using the concrete `SEARCH_WINDOW_SECONDS`/threshold/minimum hold values in Value sourcing above. Satisfies **AC-1**, **AC-2**.
3. Wire the trigger: a new effect (alongside, not inside, the existing ADR 0004 auto cut chain effect) that fires the pass once per project on reselect, yields between chunks of work per the main thread yielding invariant above, applies the mid pass edit guard at write time, updates the open editor's local state with the refined words immediately on completion, and persists via the extended PATCH. This is the end to end tracer bullet slice: one real word, refined, visible, and saved. Satisfies **AC-3**, **AC-6**, **AC-8**.
4. Harden the edge cases: a decode failure or an interrupted pass leaves `wordsAligned` false and every timestamp untouched (no partial writes), confirmed against **AC-7**; confirm the existing manual cut paths (word select cut, Cut left/right, trim drag snap) transparently pick up refined timestamps with no separate integration work, since they already read from the same `words`/`transcript.words` data. Satisfies **AC-2**, **AC-5**, **AC-7**.
5. Regression pass: confirm the existing waveform/filmstrip decode, the ADR 0004 auto cut chain, and manual cut/restore flows are unaffected whether the refinement pass is mid flight, already finished, or has not started yet; specifically test the mid pass edit guard (cut a word while the pass is still running, confirm that word's manual boundary survives untouched after the pass completes). Satisfies **AC-8** and general regression.

## Migration plan

**Strategy**: no migration needed for existing data, an additive schema change only.
**Phases**:
1. Add `wordsAligned boolean not null default false` to `projects` (one deploy; existing rows default to `false`, which correctly means "not yet refined," so every pre-existing project picks up refinement on its next reselect per AC-1's "returning project" case).
2. Ship the client side pass and the extended PATCH schema in the same deploy as step 1, or after; the column being live first is harmless (it just sits unused until the client code ships).
**Rollback**: revert the deploy; the extra column is inert (nothing reads or writes it) if the client side code is rolled back first, and can be dropped in a follow up migration if the feature is abandoned.
**Risks**: none beyond a normal additive column; no backfill, no data transformation, no coordination window.

## Consequences

**Positive**:
- Closes the word boundary imprecision bug class at its source (the timestamp itself) instead of continuing to patch each place that reads it.
- No new vendor, no new recurring cost, and the app's "your video and audio never leave your device" story stays true.
- Benefits every future manual cut, and every future rough cut re run, not just new projects.

**Negative / tradeoffs**:
- A brand new project's very first automatic rough cut (the mechanical silence/retake pass that fires immediately on reselect per ADR 0004) most likely still runs on unrefined timestamps: that chain is blocking, this pass is deliberately background and non blocking, so the mechanical cut usually finishes first. The improvement reaches that project's auto cut only on a later "Re-run rough cut," not the very first one. Manual cuts are unaffected by this ordering, they always read whatever the transcript currently holds.
- Energy threshold detection is cruder than a trained model: a word spoken over background music or heavy noise may stay unrefined, correctly (per AC-2) but not helpfully. It also has a specific, known weakness (cross checked): unvoiced consonants, fricatives, and breathy onsets are naturally low energy even in a clean, quiet recording, exactly the sounds most likely to have caused the original mistimed-boundary bug. The minimum hold duration in the threshold rule above (15ms) reduces false triggers on a single noisy sample but does not eliminate this; a word starting with one of these sounds may still refine late or fall back unrefined more often than a vowel-led word.
- Adds a second full file audio decode pass (this one, separate from the existing waveform decode) the first time each project is reselected after this ships; a real, if small and purely additive, database migration is required.

**Neutral**:
- The client now has two separate reasons to decode the same source file (the timeline's display waveform, and this refinement pass); worth revisiting whether they can share one decode later, not attempted in this slice to keep it a single, focused change.
- An already edited project's existing EDL (its cuts and keeps) is never rewritten by this pass; only the underlying word timestamps improve, silently, for whatever the user cuts next.

## Follow-up

- [ ] Revisit whether a brand new project's first automatic rough cut should wait for refinement to finish (moving it earlier, or into the existing blocking loader, for fresh projects specifically), once there is real usage data on how often that first cut misses a word the way the bug report that motivated this spec did.
- [ ] Consider merging this pass's audio decode with the existing waveform decode (`lib/waveform.ts`) into one pass, to avoid decoding the source file twice per project.
- [ ] If energy threshold refinement proves insufficient in practice (frequently noisy source audio, music beds), revisit Option 2 or 3 in [rationale.md](rationale.md) with real accuracy data in hand, not speculative research.
