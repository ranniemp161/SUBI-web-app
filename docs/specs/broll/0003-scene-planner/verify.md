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
