# 0003. Scene planner

**Date**: 2026-08-10
**Status**: In Progress

## Summary

The planner turns a b roll project's transcript into a ranked list of proposed
cutaway scenes, each tied to the line that triggered it. It runs on one Gemini
text call, returns a stream so a long call survives Vercel's proxy, and writes
its result into the `broll_scenes` table that migration `0015` already created.
The product's central promise is that it never invents a number, so every chart
value is traced back to the transcript span the model cited, and a value that
cannot be traced is dropped rather than published.

The first run on a project is free. Later runs cost $0.25 and replace the
planner's previous scenes while leaving anything the user added by hand alone.

## Rationale

Reasoning, the options weighed, and the references: see
[rationale.md](./rationale.md).

## Requirements

**User stories**:

- As a creator, I want a list of suggested cutaway moments from my own talk, so
  that I do not have to scrub the whole thing hunting for places b roll helps.
- As a creator, I want each suggestion labelled with the line that triggered it,
  so that I can scan twenty of them in a few seconds and know what each one is.
- As a creator, I want to trust every number that appears on screen, so that I
  can publish under my own name without checking each chart by hand.
- As a creator, I want a bad plan to be re runnable for a small, stated price,
  so that a poor first result is recoverable rather than final.

**Acceptance criteria.** This spec continues the b roll acceptance criteria
namespace shared by [0001](../0001-high-level-design/index.md) and
[0002](../0002-data-model/index.md). AC-23 to AC-28 are carried from the high
level design and are restated here verbatim because this spec is where they get
built; AC-48 onward are new.

Carried from the high level design:

- **AC-23**: The prompt's output shape section is generated from the schema (or
  a `responseSchema` is passed). Adding a field to the schema without touching
  prose changes the model contract.
- **AC-24**: A plan containing one malformed scene returns the remaining valid
  scenes plus a visible rejection, rather than failing wholesale.
- **AC-25**: Planning debits credits on re runs only; the first run of a project
  is bundled.
- **AC-26**: The plan route is rate limited per user via `@repo/server-shared`.
- **AC-27**: Model availability is checked at runtime with a clear error. A
  retired model id surfaces as an actionable message, not a raw 404.
- **AC-28**: Selectivity tuned against at least one real ten minute transcript;
  the multiplier is either confirmed or changed with a recorded reason.

New in this spec:

- **AC-48**: Before planning, consecutive transcript segments are merged into
  utterances. A project whose transcript came from a subtitle upload (one
  segment per caption cue) and one that came from a Ruff Cut handoff (one
  segment per utterance) present the planner with the same shape.
- **AC-49**: Opening a linked project re reads the source project's edit
  fingerprint and warns when it differs from the stored `edl_fingerprint`. The
  stored transcript is never silently replaced.
- **AC-50**: The scene count target is `ceil(runtime_in_minutes * 1.2)`. A 9:46
  transcript targets about 12 scenes, not 703.
- **AC-51**: A re run deletes every scene with `origin = 'planner'` and inserts
  the new plan in one statement. Scenes with `origin = 'manual'` survive
  untouched, and two concurrent runs never leave a mixture of both plans.
- **AC-52**: The route streams newline delimited JSON: phase lines, a heartbeat
  at least every five seconds, then one terminal line carrying the plan or an
  error.
- **AC-53**: A run that **commits zero scenes** is refunded in full, whether
  because every scene was rejected or because the write itself failed. A run
  that commits at least one scene stays charged, even when other scenes were
  rejected. A scene is **usable** when it passes the schema, regardless of
  whether its chart survived the honesty check: a chart nulled by AC-54 is a
  successful scene, not a rejected one.
- **AC-54**: A chart whose values or unit cannot be traced to the transcript
  span the model cited is dropped: `chart` is written as `NULL` and the scene
  survives as a text treatment. The scene is never discarded for a bad chart,
  and an untraceable number is never stored.
- **AC-55**: A transcript above the documented size cap is refused with a
  message naming the limit, and no charge is taken.
- **AC-56**: A plan run only ever starts from an explicit user action. Nothing
  plans automatically, including the free first run.
- **AC-57**: The planner writes from the full six template vocabulary, whether
  or not a template renders yet: `character-left`, `character-center`,
  `chart-full`, `character-plus-chart`, `text-card`, `split-compare`.
- **AC-58**: The project page offers a Plan button, shows the streamed phases
  while a run is in flight, and lists the resulting scenes read only.
- **AC-59**: The route runs on the Edge runtime with an explicit `maxDuration`,
  and completes its charge, call, write, refund sequence server side even when
  the client disconnects mid stream. A dropped connection loses the result on
  screen, never the money.
- **AC-60**: The scene count target is prompt guidance, not a validation rule.
  A plan returning more or fewer scenes than the target is accepted; only
  malformed scenes are rejected (AC-24).

## Decision

**Chosen option**: Option 2: one streamed `generateContent` call with a
deterministic honesty check.

The planner is a single Gemini `generateContent` call against a pinned
`gemini-3.6-flash`, passing a `responseSchema` derived from the same Zod schema
that parses the reply, returned to the browser as a stream, with chart values
verified against the cited transcript span by ordinary code rather than by a
second model call.

## Feature design

**Data model sketch**

No schema change. Migration `0015` already created `broll_scenes` with every
column the planner writes, and `0016` added the ledger reason it charges under.
The planner is the first writer of the following columns, all defined in
[0002](../0002-data-model/index.md):

| Column | Written by the planner as |
|---|---|
| `start_ms`, `duration_ms` | Position and length on the creator's final cut |
| `source_text`, `source_start_ms`, `source_end_ms` | The merged utterance that triggered the scene, never null for a planner scene |
| `visual_type` | `character`, `infographic`, or `text` |
| `emotion` | The character variant, or null on a chart only or text only scene |
| `layout_template` | One of the six fixed templates (AC-57) |
| `overlay_text` | Optional on screen text |
| `chart` | `{type, title, values, labels, unit, source_span}`, or `NULL` when nothing survives the honesty check (AC-54) |
| `strength` | The model's confidence, 0 to 1, stored for display and retuning only |
| `included` | Written `true` by the planner; the user owns it afterwards |
| `origin` | Always `planner` from this route |

**State transitions**

A plan run, per project:

    idle
      -> charged   (re run only; first run is bundled, AC-25)
      -> planning  (the Gemini call is in flight, phases streaming)
      -> written   (planner scenes replaced atomically, AC-51)
      -> idle

    from planning, two other exits, both refunding (AC-53):
      -> refunded  (every scene rejected)      -> idle
      -> refunded  (the write itself failed)   -> idle

The third exit is the one worth naming: the refund predicate is **scenes
committed**, not scenes validated. A charge that lands, a model that answers,
and a write that then fails leaves the user paying for nothing, so the write's
own success feeds the same refund decision as the honesty check.

There is deliberately no claim column and no hold. A plan run is one synchronous
call, so it takes the eager charge shape `chargeAiCut` established, and
atomicity of the write is what makes concurrency safe instead (AC-51).

**API surface**

| Endpoint | Method | Key inputs | Key outputs | Auth | Key errors |
|---|---|---|---|---|---|
| `/api/projects/[id]/plan` | POST | `Idempotency-Key` header (opt) | NDJSON stream: `{"phase":"merging"\|"planning"\|"validating"}` lines, then one terminal line `{scenes, rejected}` or `{error}` | Clerk session, owner only | 401 signed out, 404 not this user's project, 413 transcript over the cap (AC-55), 429 rate limited (AC-26), 402 insufficient balance |

The high level design called this `/api/plan`. It is nested under the project
instead, matching rough cut's `/api/projects/[id]/ai-cut`, because the run is
always scoped to one project and the id belongs in the path rather than the body.

**The route copies both halves of the AI Cut precedent, not just the streaming
half** (AC-59). Streaming defeats the proxy's idle timeout; it does nothing
about the function duration ceiling, which is a separate limit. So, exactly as
`ai-cut/route.ts` does:

```ts
export const runtime = "edge";
export const maxDuration = 300;
```

The handler also runs to completion server side. If the client disconnects mid
stream the charge, the call, the write and any refund still finish; the user
loses the result on screen, never the money. Neither this route nor AI Cut
inspects `request.signal`, and that is deliberate here rather than inherited by
accident.

Because the HTTP 200 is sent before the model answers, a failure after the
stream opens arrives as `{"error"}` inside the terminal line, not as an HTTP
status. Callers must read the stream incrementally. This is the same contract,
and the same caveat, that rough cut's AI Cut route already carries.

**The idempotency key is minted by the client** (AC-25): one UUID when the Plan
button enters its planning state, reused for the lifetime of that request, with
the button disabled until the run settles. Without a key
`chargeBrollPlanRerun`'s insert is unconstrained, which removes the only guard
against a double charge, so the client always sends one.

**Value sourcing**

| Action | Value produced or displayed | Source |
|---|---|---|
| Plan a project | Is this run charged? | `broll_projects.plan_runs > 0`, read and incremented inside `chargeBrollPlanRerun` (AC-25) |
| Plan a project | The price | `BROLL_PLAN_RERUN_MICROS` in `@repo/billing/pricing`, env overridable, decided in [0001 §8.1](../0001-high-level-design/index.md) |
| Plan a project | The idempotency key | Client supplied `Idempotency-Key` header, stored as `broll_plan:<key>` in `credit_ledger.stripe_event_id` (AC-45) |
| Plan a project | Scene count target | `ceil(broll_projects.duration_ms / 60000 * 1.2)` (AC-50), passed as prompt guidance only, never enforced at parse time (AC-60) |
| Plan a project | The transcript the model sees | `broll_projects.transcript`, after the utterance merge (AC-48) |
| Plan a project | The model id | A pinned constant in the planner module, never an env var and never a `-latest` alias |
| Plan a project | Whether the model is callable | The real call's own error, translated. There is **no separate probe**: `models.list()` is known to lie (0001 rationale §3), and a probe call costs money to answer a question the real call answers anyway. A 404 or `NOT_FOUND` naming the model becomes an actionable message (AC-27) |
| Merge segments | Utterance boundaries | An utterance ends when `segment.text` ends in `.`, `?`, `!`, `…` **or** the gap to the next segment exceeds `UTTERANCE_GAP_MS`. Either signal alone is sufficient, so a cue with no terminal punctuation still ends on a pause, and a pause mid sentence still splits |
| Merge segments | `UTTERANCE_GAP_MS` | A named constant, provisionally **700**, unmeasured; see Follow-up |
| Merge segments | The merged `source_text`, `source_start_ms`, `source_end_ms` | The member segments' texts joined with a single space, the first member's `start`, the last member's `end` |
| Validate a chart | The text a value is traced against | `chart.source_span` is `{startChar, endChar}`, character offsets into the **merged utterance text** the planner was given. Offsets rather than a quoted string: a model that misquotes its own citation would otherwise be indistinguishable from one that cited nothing, and both would silently drop a real chart (AC-54) |
| Validate a chart | Value comparison | Case folded, whitespace collapsed, thousands separators and a leading currency symbol stripped, trailing `.0` normalized. `80`, `80.0` and `1,200` all compare as written in the span |
| Validate a chart | The unit alias table | A named constant, not one hardcoded pair. Seeded with `%` to and from `percent`, `x` to and from `times`, and the plain word forms of small integers. Extending it is a one line change; see Follow-up |
| Show the scene list | Scene order | `ORDER BY start_ms, id`, the existing `broll_scenes_project_start_idx` |
| Show the scene list | The label for each scene | `source_text`, the verbatim utterance (AC-48 is what makes this identifiable) |
| Open a linked project | Is the transcript stale? | The source project's current edit fingerprint, re fetched from rough cut, compared against `broll_projects.edl_fingerprint` (AC-49) |
| Refuse an oversized transcript | The cap, and its unit | Estimated **input tokens of the merged transcript**, since that is what actually bounds the Gemini call, not bytes and not runtime. A named constant beside the planner, provisionally **250,000** tokens estimated at roughly 4 characters per token, unmeasured; see Follow-up (AC-55). This is a second, narrower gate than `@repo/transcript`'s 5 MB document cap, which is about what can be stored rather than what can be planned |
| Refuse an oversized transcript | Ordering against the charge | The cap is checked **before** `chargeBrollPlanRerun`, so an oversized transcript is never billed (AC-55) |
| Rate limit a run | The bucket | Per user, keyed on the Clerk id, **10 runs per hour**, matching rough cut's `aiCutRateLimit` (`AI_CUT_LIMIT` 10, `AI_CUT_WINDOW_SECONDS` 3600). Fail closed, as that route does on a money path (AC-26) |

**Key invariants**

1. A stored chart value appears in the transcript span the model cited. Nothing
   else may be stored in `chart` (AC-54).
2. `chart IS NULL` is a valid, meaningful state and never an error. It is what a
   vaguely quantified transcript must produce.
3. A planner scene always has `source_text`, `source_start_ms`, `source_end_ms`
   and `strength`. Those four are null only when `origin = 'manual'` (AC-46).
4. A re run never destroys a scene with `origin = 'manual'` (AC-51).
5. Money moves only through `@repo/billing`. This app writes no ledger statement
   (AC-43).
6. The prompt's shape section and the parser derive from one schema. A field
   added to the schema changes the prompt with no prose edit (AC-23).
7. A single malformed scene never discards the valid ones (AC-24). Strict about
   claims, lenient about shape.

**Security model**

Every read and write is scoped by `broll_projects.user_id`, as a predicate in
the query rather than a check on the result, matching `getBrollProject`. The
route accepts no user id from the client. The Clerk gate in `proxy.ts` already
answers an unauthenticated call with JSON 401.

No new regulated data. The transcript is already stored; the planner reads it
and writes derived rows beside it. The reference photo is not involved and is
still stored nowhere (AC-22).

**Configuration required**

- `GEMINI_API_KEY`: already present and already in `turbo.json`'s build env
  list. The planner adds no new secret.
- `BROLL_PLAN_RERUN_MICROS`: optional, already defined in
  `@repo/billing/pricing` with a $0.25 default.

**Critical test scenarios**

- Happy path: a real transcript plans end to end, streaming phases, and lands a
  scene list ordered by `start_ms` with an identifiable `source_text` on each,
  verifies **AC-48**, **AC-52**, **AC-58**.
- Honesty: a transcript saying "most of it" yields a scene with `chart IS NULL`
  rather than an invented percentage, verifies **AC-54**.
- Honesty backstop: a chart whose value does not appear in its cited span is
  dropped while the scene survives, verifies **AC-54**.
- Partial plan: one scene with an out of enum `emotion` is rejected and reported
  while the rest are written and the run stays charged, verifies **AC-24**,
  **AC-53**.
- Total failure: a run producing zero usable scenes refunds the $0.25, verifies
  **AC-53**.
- Re run: a project with two manual scenes and eight planner scenes re runs; the
  two manual ones survive and exactly one plan's worth of planner scenes exists,
  verifies **AC-51**.
- Billing: the first run is free, the second is charged, and a double click with
  one idempotency key charges once, verifies **AC-25**.
- Oversize: a transcript above the cap is refused with the limit named and the
  balance unchanged, verifies **AC-55**.
- Auth: another user's project id answers 404, not 403 and not a plan, verifies
  the security model.

## Build plan

Tracer Bullet: a thin thread through every layer first (a real transcript, a
real Gemini call, a real row, a real list on screen), then the guarantees that
make it trustworthy, then the money and the limits. No schema task appears
because `0015` and `0016` already landed the schema this feature writes.

**Built 2026-08-10 by `/develop`: tasks 1 to 10.** Code in `apps/broll/src/lib/`
(`utterances.ts`, `scene-schema.ts`, `emotions.ts`, `honesty.ts`, `planner.ts`,
`scenes.ts`, `staleness.ts`, `rate-limit.ts`),
`apps/broll/src/app/api/projects/[id]/plan/route.ts`, and
`apps/broll/src/app/dashboard/[id]/plan-panel.tsx`. Lint, typecheck and test are
green; b-roll went from 54 tests to 170. **Task 11 (AC-28, tune selectivity
against project `0620`) is not done**: it needs a live run against a real
transcript with a real `GEMINI_API_KEY`, which is a measurement rather than a
build. Two decisions the build needed and this spec does not name were answered
by the engineer during the run and are **not recorded in this spec yet**: where a
planner scene's `start_ms` and `duration_ms` come from, and the character emotion
vocabulary. Both are implemented and commented in code; run
`/architect scene planner` to deliberate them into the Value sourcing table.

**The first live run found the merge rule incomplete, and the code now diverges
from this spec.** Value sourcing says an utterance ends on sentence ending
punctuation **or** a gap over `UTTERANCE_GAP_MS`, "either signal alone is
sufficient". Project `0620` offers neither: auto-captions carry no punctuation
and their cues are contiguous, so all 254 segments merged into **one** utterance,
the model was handed a single numbered line, and eleven of the twelve scenes it
proposed cited lines that did not exist. Two signals cannot segment a transcript
that provides neither, and that transcript is the exact case AC-48 exists for. A
third signal, `MAX_UTTERANCE_MS` (12,000ms, the measured Ruff Cut density so a
punctuated handoff never reaches it), now ends an over-long utterance. Fold this
row into Value sourcing when ratifying the two decisions above.

1. Utterance merge: group consecutive segments on sentence ending punctuation
   and an inter segment gap, pure and unit tested, in `apps/broll`, satisfies
   **AC-48**.
2. The scene schema in Zod, plus the derivation of the prompt's shape section
   from it (or the `responseSchema` payload built from it), satisfies **AC-23**.
3. The thin thread: `POST /api/projects/[id]/plan` calls a pinned
   `gemini-3.6-flash` with the merged transcript, passes the scene count target
   as guidance rather than a rule, parses the reply scene by scene, and writes
   the scenes. Unmetered and unstreamed at this step, satisfies **AC-24**,
   **AC-50**, **AC-57**, **AC-60**.
4. The Plan button and the read only scene list on the project page, so the
   thread is visible end to end, satisfies **AC-56**, **AC-58**.
5. Stream the route: set `runtime = "edge"` and `maxDuration`, emit phase lines
   plus a five second heartbeat, terminal line carrying the plan or the error;
   the client reads incrementally and mints one idempotency key per run,
   satisfies **AC-52**, **AC-59**.
6. The honesty check: resolve `chart.source_span` against the merged
   transcript, verify every value and the unit, drop the chart on failure and
   keep the scene, satisfies **AC-54**.
7. The atomic replace: delete `origin = 'planner'` and insert the new plan in
   one statement, satisfies **AC-51**.
8. Money: charge through `chargeBrollPlanRerun` before the call; refund through
   `refundBrollPlanRerun` when the run commits zero scenes, which covers both
   "every scene was rejected" and "the write failed". The write's own outcome
   feeds the refund decision, so wrap step 7 accordingly, satisfies **AC-25**,
   **AC-53**.
9. Limits and resilience: the transcript token cap checked **before** charging,
   the per user rate limit (10 per hour, fail closed) via
   `@repo/server-shared`, and the model's own 404 translated into an actionable
   message rather than a separate probe call, satisfies **AC-55**, **AC-26**,
   **AC-27**.
10. Staleness: on opening a linked project, re fetch the source project's edit
    fingerprint and warn when it moved, satisfies **AC-49**.
11. Tune selectivity against project `0620` (9:46, real speech) and record
    whether `1.2` survives, satisfies **AC-28**.

## Consequences

**Positive**

- The one promise this product sells, that a number on screen came from the
  talk, is enforced by code that cannot itself hallucinate, not by a prompt.
- Both intake paths converge on one shape before planning, so a subtitle upload
  and a Ruff Cut handoff plan equally well (AC-48). That closes the granularity
  question the skeleton left open.
- No schema change and no new secret. The feature lands entirely inside surfaces
  that already exist and are already migrated.
- The money path reuses the two functions built for it, so no ledger statement
  is written in `apps/broll`.

**Negative and tradeoffs**

- The streamed route is harder to call and harder to test than a plain JSON
  response, and a post 200 failure is invisible to anything checking HTTP
  status. This is a real cost, accepted because a plain response would be cut
  off by Vercel's proxy on a realistic transcript.
- A deterministic honesty check will reject legitimate paraphrase. "Four in
  five" will not trace to `80`, so a fair chart is lost. The product's bias is
  deliberately toward dropping a true chart over publishing a false one.
- A re run silently discards the user's `included = false` decisions on planner
  scenes. The UI must warn before spending the $0.25.
- **A genuine race can lose one $0.25 charge, and this is accepted.** Two runs
  started at once with different idempotency keys both charge, but the atomic
  replace means only the later one's scenes survive; the earlier charge bought
  nothing and has no refund path. The idempotency key stops a retry of one
  request, not two independent requests. Reaching this needs two tabs or a
  deliberate second request, because the button disables itself for the life of
  a run. Chosen over a claim column, which would reverse
  [0002](../0002-data-model/index.md)'s explicit decision that plan runs carry
  no claim, and over refunding the loser, which would eat the Gemini cost on
  every race. If real usage shows it happening, the claim column is the fix.
- The transcript cap means a long talk cannot be planned at all, rather than
  planned partially. Chunking was rejected, so the cap is a real ceiling.
- The planner writes templates that do not render until Phase 5. A user seeing
  the plan before then will find scenes that cannot yet be exported.

**Neutral**

- `strength` is stored and displayed but decides nothing. No threshold on it has
  any evidence behind it yet, and inventing one would put a made up number on
  the critical path.
- The planner is the first b roll surface to spend money, so it is also the
  first real exercise of `chargeBrollPlanRerun` and `refundBrollPlanRerun`.

## Follow-up

- [ ] The transcript token cap (provisionally 250,000 estimated input tokens at
      roughly 4 characters per token) is arithmetic, not a measurement. Tune it
      against a real long transcript and record the number, the same debt
      `MAX_DOCUMENT_BYTES` already carries in `@repo/transcript`.
- [ ] `UTTERANCE_GAP_MS` is provisionally 700 and unmeasured. Tune it against
      both intake paths: project `0620` is the cue shaped case, a Ruff Cut
      handoff is the other. Rough cut's own `PAUSE_MARKER_SECONDS` (0.5s) and
      `PHRASE_PAUSE_SECONDS` (0.35s) are calibrated on real speech and are the
      obvious reference points.
- [ ] The unit alias table starts small (`%`/`percent`, `x`/`times`, small
      integer words). Real transcripts will show what else it needs. Widening
      it is the lever if the honesty check proves too strict in practice, and
      it is deliberately a table rather than a hardcoded pair for that reason.
- [ ] Spec [0002](../0002-data-model/index.md)'s value sourcing table says the
      scene count is `ceil(duration_ms / 1000 * 1.2)`, which is 1.2 scenes per
      second. AC-50 fixes the unit here; correct it there too so the two specs
      do not disagree.
- [ ] [0001 rationale §3](../0001-high-level-design/rationale.md) says
      `generateContent` is being deprecated. Google's current documentation does
      not say that: the Interactions API is generally available and recommended,
      and `generateContent` "is also supported", with no timeline. Soften that
      note so a later reader does not treat a recommendation as a deadline.
- [ ] Revisit the Interactions API once its structured output support is
      documented on its own guide. Nothing forces a move today, and the call
      sits behind one function, but a recommended API is worth re checking.
- [ ] The rate limit (10 per hour per user) is borrowed from `aiCutRateLimit`,
      not derived from load data for this route. Revisit once there is real
      usage; a plan run is cheaper and faster than an AI Cut run, so the number
      is probably conservative.
- [ ] The accepted race in Consequences (one lost $0.25 on two concurrent runs
      with different keys) has no telemetry behind it. If a ledger query ever
      shows `broll_plan_rerun` charges landing in pairs seconds apart on one
      project, that is this race, and the claim column becomes worth its
      migration.
