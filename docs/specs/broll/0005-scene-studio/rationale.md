# Rationale: Scene Studio · spec 0005

The reasoning behind [index.md](./index.md). `/develop` does not need this file.

## Context

The planner produces a list of proposed cutaway scenes, each tied to a line in the
creator's own transcript. Before this feature the list was read only: a creator
could see twelve scenes and change nothing about any of them, which made "review" a
figure of speech. The product's whole shape assumes a human judges the model's
output before it renders, and there was no surface to judge with.

Three forces pull against each other here.

**The product sells numeric honesty.** A chart in this app exists only because the
honesty check traced every one of its values back to character offsets inside the
transcript span the model cited, and a chart that fails that check is dropped
rather than corrected. That guarantee is the reason a creator can put their name
on the clip. Any editable field that carries a number puts the guarantee back in
the creator's hands, where it means nothing, because the failure it prevents is a
fabricated statistic rendered as a clean bar chart and published under a real
person's face.

**Speed of review beats depth of control.** The design brief is explicit that
creators are mid edit, not motion designers, and need to judge each scene in about
two seconds across ten to twenty of them. Every control added to a row is time
spent on a screen they want to leave. A surface with a field for everything would
be slower to use than the fifteen minutes in After Effects it replaces.

**The schema already anticipated more than the UI exposed.** Migration `0015`
shipped `origin`, `strength`, `visual_type`, `emotion` and `layout_template`, with
column comments describing behaviour that was never built: `origin` "gates the four
nullable columns" for a scene "the user added by hand at a chosen timecode", and
`included` is "written by the planner directly, then owned by the user". Nothing
created a manual scene and nothing displayed `strength`. Leaving that gap open
means the columns drift out of step with what the app does, and the next person
reads a comment describing a feature that does not exist.

The consequence of not deciding is already visible. PRs #142 and #143 built part of
this surface with no spec, settling the load bearing question inside a code comment.
That reasoning is good and it is invisible: it lives in one file's header, not in a
place a future change would consult. The next request to make a field editable would
be judged on effort rather than on principle.

## Options considered

### Option 1: Keep exactly the two overrides that shipped

Exclude a scene, and edit its burned in caption. Everything else about a scene stays
the planner's. The design brief's other overrides are treated as dropped scope, and
feature 6's **Done when** is amended to remove manual scenes.

**Pros**:

- Smallest surface, fastest to review, nothing more to build.
- Impossible to publish anything the honesty check refused, by construction.
- Matches what already exists, so the spec would be pure documentation.

**Cons**:

- Locks presentation fields on an argument that only covers claims. A creator who
  wants `character-center` instead of `character-left` is expressing taste, and the
  numeric honesty argument says nothing about taste.
- Leaves `strength`, `origin` and the four nullable columns written and never read.
- Discards a good moment when the planner styles it wrong, since the only remedy is
  exclusion.

### Option 2: Presentation editable, claims locked

A creator may change `layout_template`, `emotion`, `overlay_text` and `included`,
and may add and delete their own scenes. `chart`, `start_ms` and `duration_ms` on a
planner scene are never writable.

**Pros**:

- The boundary has a stated reason that answers future cases: does this field carry
  a factual assertion traced to the transcript?
- Recovers a badly styled scene without discarding it.
- Uses the columns the schema already shipped for exactly this.

**Cons**:

- More surface to build, and more to scan on a screen tuned for two second scans.
- The template picker must know what each scene's data can draw, which the scene
  list query did not previously need.
- Widens the write surface on rows that feed a render, so the per scene validation
  has to be right.

### Option 3: Everything the design brief lists, chart values included

The full B4 surface, with chart values editable behind a confirmation gate that
shows the traced quote beside the numbers.

**Pros**:

- Maximum creator control, and closest to the brief read literally.
- A creator who knows the model misread a number could fix it rather than exclude
  the scene.

**Cons**:

- Breaks the one guarantee the product is sold on. An editable value with a quote
  beside it is still an editable value, and the quote becomes decoration the moment
  the number can disagree with it.
- The honesty check's whole design is drop rather than fix. A UI that fixes what the
  server refused to fix puts the two in direct contradiction.
- The failure it enables is the exact one the app exists to prevent, and it fails
  silently: a wrong number in a clean chart looks identical to a right one.

## Rationale

Option 2, because the force that justifies locking a field is whether it carries a
claim, and only `chart`, `start_ms` and `duration_ms` do.

The shipped build reached the right answer through a wrong test. Its comment reads
"every other field is either measured or traced", and that is true of the timings
and the chart. It is not true of `layout_template` or `emotion`: those were the
model's suggestions, carry no assertion about the world, and are wrong often enough
that a creator with taste will disagree. Locking them protects nothing and costs the
scene. Option 1 would have frozen that overreach into a spec.

Option 3 fails on the first force in Context. The honesty check drops a chart it
cannot trace, and it drops rather than corrects on purpose, because there is no
safe way to guess what the speaker meant. A UI that lets the creator supply the
number the server refused to supply is not a smaller version of that guarantee, it
is its opposite, and the resulting clip is indistinguishable from an honest one.
The brief asked for editable chart values before the honesty check existed; the
check is the later and better answer to the same problem, and where they conflict
the check wins.

Three sub decisions were close enough to record.

**The unchecking rule reuses the planner's target rather than inventing a
threshold.** `packages/db/src/schema.ts` says `strength` is "deliberately NOT used
to decide `included`, because no threshold has any evidence behind it yet", and that
comment is right. An absolute cutoff would be a second guess stacked on
`SCENES_PER_MINUTE`, which is already an untuned one. Ranking by strength and
keeping the planner's own target count reuses a product judgement that exists, and
it fires only when the model returns more scenes than the runtime can absorb, which
is the case where unchecking is actually wanted. A plan at or under target unchecks
nothing, which is the honest outcome when there is no surplus to cut.

**One control, not two.** `visual_type` and `layout_template` encode overlapping
facts: `chart-full` implies infographic, `character-left` implies character. Two
writable fields describing one thing is a contradiction waiting to be stored, and
the creator does not think in visual types. The template is the thing they can see
in a thumbnail, so it is the control, and `visual_type` is derived from it server
side. It keeps its column for querying and stops being a decision anyone can get
wrong.

**A manual scene stores only the timecode, not the line.** Anchoring a manual scene
to a transcript segment is good UX, and storing that segment's text would break the
invariant that `source_text` is NULL exactly when `origin = 'manual'`. That
invariant is what makes `origin` meaningful rather than decorative, and spec `0002`
records it row by row. The segment is used to pick a moment and then discarded, so
the picker gets its convenience and the schema keeps its guarantee.

## Evidence

### What was already built, and where the reasoning lived

PR #142 added the `character-center` and `text-card` renderers. PR #143 added the
two overrides. The design reasoning for the override set was recorded in three
places, none of them a spec:

- `apps/broll/src/app/dashboard/[id]/scene-overrides.tsx`, the file header.
- `apps/broll/src/lib/scenes.ts`, on `updateBrollScene`.
- The #143 commit message.

All three say the same thing and all three are invisible to a reader asking "may I
make this editable?". That is the gap this spec closes, independent of whether the
answer changed.

### The gap the value sourcing pass found

AC-87 asks a scene to explain why it is text rather than a chart. Tracing that value
to a source showed it has none:

- `PlanRejection` is built in `apps/broll/src/lib/planner.ts` at plan time.
- It is streamed back in the run response by
  `apps/broll/src/app/api/projects/[id]/plan/route.ts` and never persisted.
- `apps/broll/src/app/dashboard/[id]/plan-panel.tsx` renders the aggregate count
  from that response, held in client state.

So the existing "3 charts dropped" count disappears on reload, which nobody had
noticed. And the per scene case cannot be derived at all: once `chart` is NULL, a
scene the planner intended as text is byte identical to one that lost its chart.
This is why spec `0005` carries a migration after a round of design spent
establishing it did not need one. It is a small column, and the alternative was an
explanation for the product's central promise that vanishes when the page reloads.

### What the cross check caught, and why the second column exists

An independent model read the drafted spec and found eleven things, two of them
load bearing. Both were verified against the code before being accepted.

**AC-89's warning could not count what it promised.** The draft counted planner
scenes where `included = false` or `overlay_text` was not NULL, as a proxy for
"the creator touched this". Both halves are wrong. `apps/broll/src/lib/planner.ts`
assigns `overlayText: parsed.overlay_text` at plan time, so the model's own caption
is stored on arrival and the field is not NULL on most scenes before anyone has
touched anything. And AC-85, added by this very spec, makes the planner write
`included = false` for surplus scenes, which destroys the other half. So this spec
broke its own proxy in the same document.

The failure mode is the bad one: the warning under counts silently, and it under
counts hardest for a creator who restyled ten scenes using the two fields this spec
adds, since neither `layout_template` nor `emotion` was in the proxy at all. They
would be told nothing is at risk immediately before a re-run deleted all of it,
which is the exact moment the warning exists for. There is no field left that
answers the question, so `user_edited_at` records the fact rather than inferring
it. That is the whole reason the migration carries two columns instead of one.

**The rejection had no correlation key.** `PlanRejection` carries
`{utteranceIndex, reason, kind}` and no scene id, and `collectScenes` sorts the
assembled scenes by `startMs` at `planner.ts:324`. So the obvious implementation,
walking two arrays together, attaches the wrong reason to the wrong scene whenever
a rejection arrives out of timecode order, and does it silently. Attribution is on
`utteranceIndex`, and the verify page carries a box built specifically to fail a
positional implementation.

The other nine were smaller: an unnamed cap value, an unnamed limiter for the new
routes, a missing status for an invalid `segmentIndex`, `emotion` never cleared on
a template switch, a NULL `strength` with no display rule, an unstated caption
length rule on create, a check then insert race on the cap, a chart citation keyed
off the column rather than the current template, and no tiebreak in the surplus
ranking. Each is settled in `index.md`.

The pattern worth keeping: every one of these is a value an acceptance criterion
needed whose source the spec did not name. None of them is a coding mistake. They
are the decisions a builder would have had to invent halfway through, which is what
a spec exists to prevent.

### The brief and the build disagree, on record

`docs/specs/broll/design-prompt.md` B4 lists per scene overrides on "visual type,
emotion, layout template, on-screen text, chart values", a strength score with weak
scenes unchecked, and manual scene addition. B5 asks for chart values to be confirmed
against a highlighted verbatim quote before render. Of that list, the shipped build
covers on screen text and exclusion.

This spec adopts the brief on template, emotion, strength and manual scenes; adopts
B5's traceability as a read only display rather than a confirmation gate, since the
honesty check already refuses anything untraceable server side; and rejects the
brief on editable chart values for the reason given above. B6's
`character-plus-chart` and `split-compare` have no renderer and are carried as a
follow up rather than silently dropped.
