# Hardening, main, 2026-07-09

**Analysed by**: systems-level review on claude-opus-4-8
**Scope**: 5 code files (+3 test files), uncommitted vs HEAD
**Risk posture**: Harden before merge → both should-harden items are now Fixed (see below). Ship as-is.

## Summary
Four small safety/accuracy fixes to a credits-billed video editor. The riskiest
surface is the new AI-Cut re-run guard: it is a check-then-act (`getOwnedProject`
reads `aiCuts`, the route writes `aiCuts` seconds/minutes later) with no
transaction and no row lock, so it prevents a *sequential* re-charge but leaves a
*concurrent* double-charge window that the guard's own comment claims is closed.
The rest (frame-snap transform, file-picker duration check, exit toast) are low
blast-radius; the file-picker check is correctly a UX safety net, not a security
boundary, and should stay described that way. The `utterances:"true"` addition is
requested from Deepgram but silently dropped by the normalizer, so it currently
does nothing for the cut logic it was added to serve.

## Should-harden

### Should-harden: Concurrency & races — TOCTOU double-charge across concurrent AI-Cut POSTs, `apps/rough-cut/src/app/api/projects/[id]/ai-cut/route.ts:107` + `:150-153`
**Status: Fixed 2026-07-09.** Added `claimAiCutSlot`/`releaseAiCutClaim` in
`lib/projects.ts` — an atomic conditional UPDATE (mirroring `reserveCredits`'
`hold_micros IS NULL` gate) that flips `ai_cuts` from empty to a pending
marker; a losing concurrent request matches zero rows and gets 409
`AI_CUT_IN_PROGRESS` before any charge. The claim is released on every
failure path after it's taken (insufficient credits, Gemini error, size
guard, or any unexpected exception) so the project is never stuck pending. A
stale claim older than 6 minutes (`AI_CUT_CLAIM_STALE_MS`, above the 300s
function timeout) is reclaimable. Covered by new tests in
`ai-cut/route.test.ts` ("concurrent-run claim" describe block); full suite
(278 tests) and typecheck both green.
**Scenario**: The user has the same project open in two browser tabs (or a
scripted/direct API caller fires two requests) and both hit AI Cut within the
same second. Each `runAiCut` invocation generates its **own** fresh
`Idempotency-Key` (`page.tsx:726-729`, `crypto.randomUUID()` per call), so the
two requests carry **different** keys — the `idempotency:<key>` lock at
`route.ts:68` does not collide. Both requests call `getOwnedProject` (a plain
`SELECT`, no `FOR UPDATE`), both read `aiCuts` as empty, both pass the
`ranges?.length > 0` guard at `route.ts:107`, both call `chargeAiCut`. With
distinct keys, `chargeAiCut`'s `ON CONFLICT (stripe_event_id)` never fires
(`credits.ts:380`), so **both charges commit** (the CHECK constraint only stops
an overdraft, not a double-spend of a sufficient balance). Both run Gemini, both
`UPDATE ... SET aiCuts` (last write wins). The neon-http driver has no
transaction wrapping read→charge→write, so nothing serializes the two.
**Impact**: The user is charged twice (real USD-micros off their balance) for one
logical AI pass, plus two paid Gemini calls. It is the user's own credits, not a
cross-tenant issue, and it requires two near-simultaneous runs — but the guard's
in-code comment ("a second run can never charge again once results exist") and
ADR 0002's "Placing the 409 before `chargeAiCut` guarantees … no window where a
charge exists for a rejected request" both overstate the protection: the
guarantee holds only for *sequential* runs, not concurrent ones.
**Mitigation**: Make the charge atomic with a claim, the same pattern
`reserveCredits` already uses (`credits.ts:154-157`: `WHERE ... hold_micros IS
NULL` so a concurrent second call matches zero rows). Options, cheapest first:
(a) gate the run on a conditional `UPDATE projects SET aiCuts = '{running}'::jsonb
WHERE id = ? AND (aiCuts IS NULL OR aiCuts->'ranges' = '[]'::jsonb) RETURNING id`
and only proceed to charge if a row came back — a losing concurrent request gets
zero rows and returns 409; or (b) require the `Idempotency-Key` on this route and
fail-closed when absent (`route.ts:62`), then derive it deterministically per
*project+transcript* rather than per-attempt so two tabs collide on the same key.
Also soften the in-code/ADR comments to state the guarantee is sequential-only
until the atomic claim lands.
**Verify with**: add a test in `ai-cut/route.test.ts` that invokes `POST` twice
with **no** (or two different) `Idempotency-Key`s against the same
empty-`aiCuts` project and asserts `chargeAiCut` (or the claim UPDATE) commits at
most once — the current suite (`route.test.ts:162-188`) only covers the
already-non-empty sequential case, so there is no regression net for the
concurrent window today.

### Should-harden: Data integrity — `utterances:"true"` requested but discarded by the normalizer, `apps/rough-cut/src/app/api/transcribe/deepgram/route.ts:200` + `apps/rough-cut/src/lib/deepgram.ts:57-72`
**Status: Fixed 2026-07-09.** `normalizeDeepgram` now carries Deepgram's
utterance end-times through as `utteranceEnds` (frame-snapped, ascending) on
the stored transcript. `retake-detection.ts`'s `groupIntoSentences` uses them
as real acoustic sentence boundaries when present, falling back to the old
fixed-pause/punctuation heuristic for transcripts stored before this change
(no `utteranceEnds`). Threaded through `edl.ts` (`buildAutoLayer`,
`buildInitialEDL`, `reRoughCut`) and wired at the one call site
(`page.tsx`'s `reRunRoughCut`, via `project.transcript.utteranceEnds`). New
tests demonstrate the fix changes real behavior: a fast re-take spoken with
no pause and no terminal punctuation — which the old heuristic glues into
one sentence and misses entirely — is now correctly split and caught as a
retake once utterance boundaries are supplied. Full suite (286 tests) and
typecheck both green.
**Scenario**: The route now asks Deepgram for `utterances:"true"`, and its
comment says this gives "the cut-suggestion logic … phrase boundaries to align
to." But `normalizeDeepgram` only reads `results.channels[0].alternatives[0]`
(words/transcript/language); `results.utterances` is never read and is not part
of `NormalizedTranscript`, so it is dropped before anything is stored. A grep of
`src` finds no consumer of `utterances` anywhere except the request itself and
its test.
**Impact**: No correctness break, but the added option delivers zero of its
stated benefit while enlarging every Deepgram response and (depending on plan)
its processing — the change looks done but the cut logic still never sees
utterance boundaries. Future readers will trust the comment and be misled.
**Mitigation**: Either carry utterances through `normalizeDeepgram` into the
stored transcript and actually consume them in `ai-cuts.ts`/`ai-rough-cut.ts`, or
drop the `utterances:"true"` request and its comment until a consumer exists.
Decide before merge so the request and the code that reads it ship together.
**Verify with**: the existing `deepgram/route.test.ts:248` only asserts the param
is sent; add a `deepgram.test.ts` assertion that a payload carrying `utterances`
either surfaces them on the normalized result (if kept) — otherwise the param is
dead and the test locks in dead behavior.

## Watch / accept

- `apps/rough-cut/src/lib/deepgram.ts:49` — `snapToFrame(seconds)` does no guard on
  a `NaN`/`undefined` `w.start`/`w.end` from a malformed Deepgram word:
  `Math.round(NaN*30)/30` = `NaN`, which then flows into EDL/seek math. This is
  no worse than the prior raw pass-through (it already forwarded whatever
  Deepgram sent) and `DeepgramWord.start/end` are typed non-optional, so it is a
  pre-existing edge, not introduced here. Large/long-video and precision cases
  are fine (`10800s*30` is an exact integer; sign is preserved for the
  non-negative timestamps Deepgram emits). Monitor rather than fix, or add a
  `Number.isFinite` clamp if a malformed-payload incident ever appears.

- `apps/rough-cut/src/components/file-picker.tsx:77-88` — the duration-match check
  reads `durationMs` from a client-side hidden `<video>` and is trivially
  spoofable (a hand-crafted container reporting a matching duration, or the same
  duration on a genuinely different video — the blind spot ADR 0003 names
  explicitly). This is correct as-is: it is a footgun guard for an honest user
  reselecting the wrong file, and the only party harmed by a bypass is that same
  user's own edit (garbage timestamps on their own timeline). It is **not** a
  security/trust boundary and must not be relied on as one; ADR 0003 frames it as
  a UX safety net, which is accurate. Keep it framed that way. The
  `fileInputRef.current.value = ""` reset (line 85) correctly re-arms the change
  event so re-picking the same file re-runs the check.

- `apps/rough-cut/src/app/api/projects/[id]/ai-cut/route.ts:188-191` (DELETE) —
  clears `aiCuts` unconditionally with no "already empty?" precheck; an
  already-empty clear is a harmless idempotent no-op write (bumps `updatedAt`
  only), so no guard is needed. DELETE has no rate limiter, but it is auth +
  ownership gated and is a single cheap UPDATE, and a DELETE→POST loop charging
  each POST is the intended clear-then-rerun billing behavior, not abuse. A
  DELETE racing an in-flight POST is last-write-wins on the `aiCuts` column
  (either the clear is overwritten by the finishing run, or the run's write is
  wiped by a later clear) — no corruption, only a surprising-but-recoverable
  final state the user can re-clear. The client's optimistic `setProject({...,
  aiCuts: null})` (`page.tsx`) can momentarily disagree with a concurrent
  server read, but self-heals on the next fetch. Accept and monitor.

- `apps/rough-cut/src/app/(app)/dashboard/[id]/page.tsx:88-92` (`showExitReassuranceToast`)
  — fires a non-blocking sonner toast on the exit `<Link onClick>`. It relies on
  the dashboard mounting its own `Toaster` for the toast to survive navigation
  (noted in the comment); if that Toaster is ever removed the toast silently
  no-ops. Pure UI reassurance, no state, no failure mode worth a fix.

## Already covered
- The 409 guard is placed **before** `chargeAiCut` (`route.ts:107` vs `:120`), so
  a *sequentially* blocked re-run takes no charge and needs no refund — the ADR
  0002 intent holds for the sequential case, which is the common accidental one.
- A single client's retry of the *same* run is protected: `runAiCut` keeps one
  `Idempotency-Key` in a ref for the whole attempt (`page.tsx:726-735`), so a
  timeout-retry with that key collides on the `idempotency:<key>` lock
  (`route.ts:68`, `failClosed:true`) and 409s without re-charging.
- In-app double-click is blocked twice over: `if (!edl || aiBusy) return`
  (`page.tsx runAiCut`) plus the same-key idempotency lock.
- `chargeAiCut` fails **closed** on a Redis error for the idempotency lock and
  refunds are keyed (`ai_cut_refund:` prefix, `credits.ts:418`) so a retried
  refund can't double-credit; the charge path's overdraft is CHECK-constrained.
- DELETE enforces the same `auth()` + `getOwnedProject` ownership checks as POST
  (`route.ts:174-186`), satisfying ADR 0002 AC-4, and is tested
  (`route.test.ts:253-266`).
- The frame-snap is centralized at the single normalizer chokepoint both
  transcription paths flow through, so seek/EDL/export inherit one consistent
  grid rather than each rounding differently.
