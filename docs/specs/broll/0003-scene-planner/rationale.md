# Rationale — 0003 Scene planner

Why the planner is shaped the way it is. The build spec is
[index.md](./index.md); this file is the decision record and a build never
loads it.

---

## Context

B roll's whole value rests on one judgment: given ten minutes of someone
talking, which moments are worth cutting away to, and what should appear when
you do. Everything before this phase moves a transcript around. This is the
phase that reads it.

Three forces shape the design.

**The product sells numeric honesty.** A creator publishes these clips under
their own name. A chart reading `80` next to `20` when the speaker said "80
percent" is a different claim, and a fabricated statistic is not a rendering bug
but a reputational one. Phase 0's fourth spike tested exactly this and the model
declined to invent numbers on a vague fixture, which is encouraging and not
sufficient: model behaviour is not a guarantee, and it changes with the version.

**The transcript arrives in two different shapes.** Measured on real files, a
Ruff Cut handoff gives roughly one segment per twelve seconds, carrying word
timings and an exact frame rate. An uploaded subtitle file gives one per two
seconds, with neither. Both are correct: `@repo/transcript` deliberately keeps
each caption cue's own timing rather than inventing merged boundaries it cannot
measure. But the planner assumes the utterance shape in two places, its scene
count target and the "identifiable source line" a user scans in Scene Studio. A
cue reading "was the deadline" identifies nothing. The skeleton phase found this
and deferred it here.

**The call is slow, paid, and runs on Hobby.** One Gemini call over a ten minute
transcript with thinking enabled will not answer inside Vercel's ten second
proxy window. Rough Cut already hit this with AI Cut and solved it by streaming.
Separately, a re run costs the user $0.25, so every failure mode has a money
consequence attached, and the eager charge happens before the vendor answers.

Not deciding leaves Phase 3 blocked on the question the high level design named:
whether to build on `generateContent` or the Interactions API that Google is
steering toward.

---

## Options considered

### Option 1: `generateContent`, one plain JSON response, prompt led honesty

Ask the model for the whole plan, parse the JSON reply, trust the prompt's
instruction not to invent numbers because Phase 0 showed it complies.

**Pros**

- The least code by a wide margin, and the shape every developer expects.
- Matches what Phase 0 actually measured, so the honesty result transfers
  directly with nothing re proven.

**Cons**

- A plain response is killed by Vercel's proxy after ten seconds of silence on
  Hobby. This is not a risk, it is the documented behaviour that forced AI Cut
  to stream, and a ten minute transcript will not beat it.
- Honesty rests on model behaviour with no backstop. A model version change can
  silently break the one guarantee the product sells, and nothing would notice.

### Option 2: `generateContent`, streamed, with a deterministic honesty check

One call, returned as newline delimited JSON with phase lines and a heartbeat,
and every chart value verified in ordinary code against the transcript span the
model cited.

**Pros**

- Survives the proxy window by construction, reusing a streaming contract the
  repo has already shipped and debugged once.
- The honesty guarantee stops depending on the model. A check written in code
  cannot hallucinate, and it keeps working when the model version moves.
- `responseSchema` plus a Zod schema generated from one source closes the
  drift that failed four times in Phase 0.

**Cons**

- Streaming is meaningfully harder to call and to test, and a failure after the
  200 is invisible to anything inspecting HTTP status.
- A literal trace rejects legitimate paraphrase: "four in five" will not match
  `80`, so some true charts are lost.

### Option 3: Interactions API

Build on the API Google now recommends, which is generally available and
carries the newest models and features.

**Pros**

- Aligned with where the vendor is heading, so the migration is never owed.
- First access to whatever the vendor ships next.

**Cons**

- Its structured output story is not documented on its own guide page, and
  AC-23 depends entirely on structured output. That would have to be proven
  before anything could be built on it.
- The repo would run two different call shapes against one vendor, since
  rough cut's AI Cut is on `generateContent` and is not moving.

### Option 4: Two model calls, the second judging the first

Plan with one call, then ask a second call to verify each chart against the
transcript.

**Pros**

- Catches paraphrase and inference that a literal trace misses, which is the
  main weakness of Option 2.

**Cons**

- Doubles vendor cost against a flat $0.25 price.
- Asks a model to police a model. The failure being guarded against is exactly
  the one both calls share, so it is a weaker backstop than it looks while
  costing more.

---

## Rationale

**Option 2 wins on the proxy constraint alone.** The ten second idle timeout on
Hobby is documented in this repo, was hit before, and produced the streaming
pattern AI Cut still uses. Choosing a plain response would be choosing a known
failure, and discovering it on a real transcript rather than a fixture.

**The honesty check is code because the promise is the product.** Phase 0's
result, that the model declined to fabricate, is real evidence and it is why the
prompt is still the first line of defence. But it is evidence about one model
version on one fixture, and the rationale for that spike already framed the
validator as the backstop. A backstop that shares the failure mode it guards
against is not one, which is what rules out Option 4: a second Gemini call is
cheaper to write than a tracer and weaker than it appears. Deterministic
tracing accepts a real cost, losing paraphrased charts like "four in five", and
that is the right direction to fail in for a product whose pitch is that the
numbers are true.

**`generateContent` stays, and the reason is narrower than the high level design
implies.** Rationale §3 of [0001](../0001-high-level-design/rationale.md) says
the API is being deprecated, inferred from a 404 body that recommended
migrating. Google's current documentation does not support that reading: the
Interactions API is generally available and recommended, and `generateContent`
"is also supported; the same configuration options and recommendations apply",
with no deprecation notice and no timeline. So this is not a race. What decides
it is AC-23: the prompt's shape must come from the schema, `responseSchema` is
the documented way to do that on `generateContent`, and the same is not yet
documented for Interactions. Picking the API whose structured output story is
proven, for a feature whose contract depends on structured output, is the
boring choice, and the call sits behind one function when that changes.

**Merging cues into utterances is deterministic on purpose.** The alternative,
handing the planner 254 caption cues and asking it to group them, moves a
correctness property into unverifiable model behaviour, and `source_text` could
still land on a fragment. A merge written in code can be tested against both
intake paths and inspected when it is wrong. It lives in `apps/broll` rather
than `@repo/transcript` because the package documents a deliberate refusal to
merge cues into utterances it cannot measure, and AC-16 keeps app specific
interpretation out of it. Merging is a planner need, so it belongs with the
planner.

**Concurrency is solved by atomicity rather than a claim column, and that
leaves one accepted loss.** Spec [0002](../0002-data-model/index.md) decided
plan runs carry no claim and no hold. Doing the delete and the insert as one
statement makes each run commit entirely or not at all, the same convention
`@repo/billing` uses for every balance mutation, so no migration and no stale
reclaim path is needed for a call that finishes in seconds.

An earlier draft of this reasoning said the exposure "is not a double charge,
which the idempotency key already prevents". A cross check caught that this is
only half true, and the correction is worth keeping. The key prevents a **retry
of one request** charging twice. It does nothing about **two independent
requests** with different keys, which is exactly the race the atomic replace
exists to describe: both charge, both call Gemini, and only the later one's
scenes survive. That earlier $0.25 bought nothing and has no refund path.

This is accepted rather than fixed, and recorded in Consequences so it is a
known loss instead of a surprise. Reaching it needs two tabs or a deliberate
second request, because the button disables itself for the life of a run. The
alternatives both cost more than the exposure: a claim column reverses 0002's
explicit decision and adds a migration, and refunding the loser means detecting
"I lost" only after the vendor has already been paid, so the Gemini cost is
eaten on every race. If a ledger query ever shows paired `broll_plan_rerun`
charges seconds apart on one project, the claim column becomes worth it.

**The refund predicate is scenes committed, not scenes validated.** The same
cross check found that a charge landing, a model answering, and the write then
failing left the user paying for nothing, with no state in the machine for it.
The predicate now keys on what actually reached the database, which folds the
write's own failure into the refund path rather than treating it as a separate
class of error.

**The scene count formula had a unit bug and it mattered.** Spec 0002's value
sourcing table reads `ceil(duration_ms / 1000 * 1.2)`, which is 1.2 scenes per
second: the 9:46 transcript now in the dev database would target 703 scenes.
The high level design's `ceil(runtime * 1.2)` only makes sense with runtime in
minutes, giving about 12, which matches the rationale's own talk of a twenty
scene batch. AC-50 fixes the unit; a follow up corrects 0002 so the two specs
do not disagree.

---

## References

**Project sources** (verifiable in this repo)

- `apps/rough-cut/AGENTS.md`, the AI Cut streaming contract and the ten second
  Hobby proxy limit that forced it.
- `packages/billing/AGENTS.md`, the one statement per mutation convention and
  the `chargeBrollPlanRerun` / `refundBrollPlanRerun` pair.
- `apps/broll/AGENTS.md`, the measured segment granularity difference between
  the two intake paths.
- Spec [0001](../0001-high-level-design/index.md) and its
  [rationale](../0001-high-level-design/rationale.md): AC-23 to AC-28, the
  chart shape from §2.1, the parse scene by scene rule from §2.6, the prompt
  and schema drift finding from §2.8, and the model id rot finding from §3.
- Spec [0002](../0002-data-model/index.md): the `broll_scenes` columns, the
  `origin` gate, and the decision that plan runs carry no claim and no hold.
- `packages/db/src/schema.ts`, migrations `0015` and `0016`, already applied to
  the dev branch.

**Practices and standards**

- Idempotency keys for money operations, already the repo's pattern via
  `credit_ledger.stripe_event_id`.
- Strict about claims, lenient about shape (from 0001 rationale §2.6): truth
  claims get zero tolerance, shape gets coercion.
- Generate one artifact from another rather than maintaining two copies of a
  contract; prose describing a schema is a copy, and copies rot.

**Links** (verified 2026-08-10)

- Gemini 3 Developer Guide, Interactions API:
  https://ai.google.dev/gemini-api/docs/interactions/gemini-3
- Gemini Developer API pricing: https://ai.google.dev/gemini-api/docs/pricing
