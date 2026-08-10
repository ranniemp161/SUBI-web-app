# Verify: scene planner · spec 0003

Checked by `/check verify`. Each box maps to an acceptance criterion in
[index.md](./index.md). Tick a box only when it was actually driven and passed.

## Commands

- [ ] Unit: the utterance merge turns 254 cue shaped segments from project
      `0620` into utterance shaped ones, and leaves an already utterance shaped
      Ruff Cut document unchanged. → **AC-48**
- [ ] Unit: the honesty check accepts a chart whose values appear in the span at
      `{startChar, endChar}`, rejects one whose value does not, and accepts
      `80` against a span saying "80 percent" through the alias table. Also
      accepts `1,200` and `80.0` against `1200` and `80` through the stated
      normalization. → **AC-54**
- [ ] Unit: `ceil(runtime_in_minutes * 1.2)` gives 12 for a 9:46 transcript and
      never a per second figure. → **AC-50**
- [ ] Unit: a plan returning 30 scenes against a target of 12 is accepted in
      full; the target never rejects or truncates. → **AC-60**
- [ ] Unit: the merge ends an utterance on terminal punctuation with no gap, and
      on a gap above `UTTERANCE_GAP_MS` with no punctuation. The merged
      `source_text` is the members joined with single spaces, spanning the first
      member's start and the last member's end. → **AC-48**
- [ ] Unit: a plan containing one scene with an out of enum `emotion` yields the
      remaining valid scenes plus a rejection, not an empty result. → **AC-24**
- [ ] Search: the prompt's shape section and the parser both derive from one
      schema. Adding a field to the schema changes the prompt with no prose
      edit. → **AC-23**
- [ ] `npm run lint && npm run typecheck && npm run test` pass. → all

## UI and runtime

- [ ] Open a project with a transcript. A Plan button is offered and nothing has
      planned on its own. → **AC-56**
- [ ] Press Plan. Phase lines appear while the run is in flight and the
      connection survives a call longer than ten seconds. → **AC-52**
- [ ] The run completes and the page lists the scenes, ordered by start time,
      each labelled with a readable `source_text` that identifies the moment.
      → **AC-58**, **AC-48**
- [ ] A scene whose transcript line quantifies only vaguely ("most of it") has
      no chart, and the scene still exists as a text treatment. → **AC-54**
- [ ] `broll_scenes` rows carry `layout_template` values from the full six
      template vocabulary, not only the one Phase 4 renders. → **AC-57**

## Money

- [ ] The first run on a project is free: `plan_runs` goes 0 to 1 and the
      balance is unchanged. → **AC-25**
- [ ] The second run charges $0.25 and writes one `broll_plan_rerun` ledger row.
      → **AC-25**
- [ ] Two rapid presses carrying one `Idempotency-Key` charge once. → **AC-25**
- [ ] A run that produces zero usable scenes refunds in full, leaving the
      balance where it started. → **AC-53**
- [ ] A run that produces some valid scenes and some rejected ones stays
      charged. → **AC-53**
- [ ] A scene whose chart was nulled by the honesty check still counts as
      usable: a run producing only such scenes stays charged. → **AC-53**
- [ ] Force the write to fail after a successful model call. The run refunds,
      rather than charging for scenes that were never committed. → **AC-53**
- [ ] Close the tab mid run. The charge, the write and any refund still settle
      server side; the balance and `broll_scenes` are consistent afterwards.
      → **AC-59**

## Re run and concurrency

- [ ] Add a manual scene, exclude a planner scene, then re run. The manual scene
      survives; exactly one plan's worth of planner scenes exists. → **AC-51**
- [ ] Two concurrent runs on one project leave one plan's scenes, never a
      mixture of both. → **AC-51**
- [ ] Same scenario, checking the money: two concurrent runs with **different**
      idempotency keys charge twice and only one plan survives. This is the
      accepted loss recorded in Consequences, so the expected result is two
      charges, not one. Confirm it matches what the spec says rather than
      treating it as a pass or a bug. → Consequences, not an AC

## Limits and failure

- [ ] A transcript above the cap is refused, the message names the limit, and
      the balance is unchanged. → **AC-55**
- [ ] Exceeding the per user rate limit answers 429. → **AC-26**
- [ ] Point the planner at a retired model id. The error names the model and
      says what to do, rather than surfacing a raw 404. → **AC-27**
- [ ] Another user's project id answers 404, not a plan and not a 403. →
      security model

## Staleness

- [ ] Open a linked project whose source project has since been edited in Ruff
      Cut. A warning appears and the stored transcript is not replaced. →
      **AC-49**

## Selectivity

- [ ] Run the planner against project `0620` (9:46 of real speech) and judge it
      by what it does **not** pick. Record whether `1.2` survives, and if it
      changes, why. This is the one box that produces a decision rather than a
      pass or fail. → **AC-28**

## Not automatable

- **AC-28** is a judgment call about plan quality, not an assertion. It needs a
  human reading the output against the talk. Record the verdict here; do not
  write a test that pretends to check it.

---

# Added by /develop, 2026-08-10

## Value sourcing

One step per row of the spec's Value sourcing table. These exercise **where a
value came from**, not whether the happy path works: the gate on a source is a
design time check, and a mis-sourced value passes every functional test until the
day the input varies. Each one below varies the input that would expose it.

- [ ] Set `plan_runs` to 0, run, and confirm the run is bundled; set it to 1, run,
      and confirm it charges. The answer must come from the column, not from
      anything the client sent — a request cannot talk itself into a free run.
      → **AC-25**
- [ ] Set `BROLL_PLAN_RERUN_MICROS` to a non-default value. The confirmation
      panel, the button label and the ledger row all move together, because all
      three read `@repo/billing/pricing`. → **AC-25**
- [ ] After a charged run, the ledger row's `stripe_event_id` is
      `broll_plan:<key>`; after a refund, `broll_plan_refund:<key>`. Different
      prefixes are what keep a refund from colliding with its own charge.
      → **AC-45**
- [ ] Run against a 1:00 project and a 9:46 project. The prompt asks for about 2
      and about 12 scenes respectively — minutes, never seconds. → **AC-50**
- [ ] On a subtitle-upload project, confirm the prompt body carries far fewer
      numbered lines than the project's segment count (254 segments merged to
      utterances). The model must see the merge, not the raw cues. → **AC-48**
- [ ] Grep the planner for the model id: a pinned constant, no `process.env`, no
      `-latest` alias.
- [ ] Count outbound Gemini requests for one run: exactly one. There is no
      separate availability probe, by decision — the real call's own 404 is the
      check. → **AC-27**
- [ ] Vary the inter-segment gap either side of `UTTERANCE_GAP_MS` (700ms) and
      confirm the split appears and disappears. At exactly 700ms it must not
      split; the threshold is exceeded, not met. → **AC-48**
- [ ] Take one stored scene and compare `source_start_ms` against the first
      member cue's `start` in the stored transcript, and `source_end_ms` against
      the last member's `end`. Both come from the merge, never from the model.
- [ ] Shift a chart's `source_span` by a few characters so it points just off the
      figure, and confirm the chart drops while the scene survives. Offsets are
      into the **cited utterance's** text; if they were being resolved against
      the whole transcript instead, this step still passes the happy path and
      fails here. → **AC-54**
- [ ] Trace `1,200`, `80.0` and `$250` against spans written that way, and
      confirm `80` does **not** trace against a span saying only `1802` or
      `80.5`. → **AC-54**
- [ ] Confirm a chart whose unit is absent from the cited line drops, and one
      saying `percent` against a `%` unit survives. The unit is traced as hard as
      the values. → **AC-54**
- [ ] Scene list and export order are `start_ms, id`, and each scene's label is
      the verbatim `source_text`. → **AC-42**, **AC-58**
- [ ] Feed a transcript under `@repo/transcript`'s 5 MB document cap but over
      250,000 estimated input tokens. It is still refused: the planner's cap is a
      second, narrower gate measured in tokens of the merged transcript.
      → **AC-55**
- [ ] On that refusal, the balance is unchanged and no ledger row was written.
      The cap is checked before the charge. → **AC-55**
- [ ] The 11th run in an hour for one user answers 429, and a second user in the
      same hour is unaffected. The bucket is per user, keyed on the Clerk id.
      → **AC-26**
- [ ] Edit the source project in Ruff Cut, reload the linked b-roll project, and
      confirm the warning appears **and** the stored `transcript` row is byte
      identical to what it was. Warned, never replaced. → **AC-49**

## Decisions this build made that the spec does not yet record

Both were answered by the engineer during `/develop` and are implemented, but
they are not in the Value sourcing table yet. Run `/architect scene planner` to
deliberate them in; until then these two steps check code against a decision that
lives in a comment.

- [ ] A planner scene's `start_ms` equals the cited utterance's start, and its
      `duration_ms` is the model's proposal clamped to 4,000 to 8,000ms. No
      timecode comes from the model. Confirm by returning a wild `duration_ms`
      and an unrelated implied placement, and checking the stored row.
- [ ] `emotion` accepts exactly the six in `src/lib/emotions.ts` (neutral, happy,
      surprised, thoughtful, skeptical, excited) and is null on any scene whose
      `visual_type` is not `character`. This set is also what Phase 2's character
      pipeline must generate, so a change here is a change there.

## Already locked by automated tests

These boxes have unit coverage as of this build (170 tests in `apps/broll`), so
`/check verify` can treat them as regression-guarded and spend its runtime on the
live paths instead: **AC-23**, **AC-24**, **AC-48**, **AC-50**, **AC-54**,
**AC-60**, the refund predicate of **AC-53**, the ordering of the cap and the
charge in **AC-55**, the 429 of **AC-26**, the error translation of **AC-27**,
the single statement of **AC-51**, and the `runtime`/`maxDuration` of **AC-59**.

What has **no** automated coverage and needs a live run: every money box against
a real ledger, **AC-52**'s heartbeat over a real slow call, **AC-57** against real
model output, **AC-49** against a real Ruff Cut edit, and **AC-28**.
