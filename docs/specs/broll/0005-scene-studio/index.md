# 0005. Scene Studio: the review and override surface

**Date**: 2026-08-13
**Status**: In Progress

## Summary

Scene Studio is where a creator reviews the scenes the planner proposed and
changes the ones that are wrong. This spec settles which fields they may change
and which they may not. The rule is one line: **presentation is editable, claims
are not.** A creator may pick a different template, a different emotion, different
words on screen, may exclude a scene, and may add a scene by hand. They may never
edit a chart's numbers or a scene's timings, because both are traced back to the
transcript and editing them would let someone publish a number the app had just
refused to invent.

Part of this shipped already, in PRs #142 and #143. That build settled the hardest
question correctly and drew the line too wide, locking presentation on an argument
that only justifies locking claims. This spec keeps its reasoning, widens the
editable set, and adds the four things the design brief asked for that were never
built.

## Requirements

**User stories**:

- As a creator, I want to scan the proposed scenes and judge each in about two
  seconds, so that reviewing twenty of them does not cost more than the edit I
  came here to finish.
- As a creator, I want to change the look of a scene the planner got stylistically
  wrong, so that I do not have to throw away a good moment over a bad template.
- As a creator, I want to add a cutaway at a moment the planner missed, so that my
  own judgement of my own talk is not overridden by the model's.
- As a creator, I want to see where a chart's numbers came from, so that I can put
  my name on the clip.
- As a creator, I want to know why a scene is plain text when I expected a chart,
  so that a downgrade reads as a decision rather than a bug.

**Acceptance criteria**:

- **AC-75**: A creator can change a scene's `layout_template`, and only to a
  template this scene's own data can draw. A scene with no chart never offers
  `chart-full`. A project with no committed character set never offers a character
  template. A template with no renderer is never offered.
- **AC-76**: `visual_type` is derived server side from `layout_template` and is
  never accepted from the client. A request that supplies it has that field
  ignored, not honoured.
- **AC-77**: A creator can change a scene's `emotion`, only while the template is a
  character template, and only to an emotion actually committed for this project.
- **AC-78**: `chart` (values, labels, unit and type), `start_ms` and `duration_ms`
  are never writable on a planner scene through any Scene Studio surface. A request
  naming any of them is rejected rather than partially applied.
- **AC-79**: A creator can add a scene by picking a transcript segment. The stored
  row carries `origin = 'manual'` and `start_ms` taken from that segment's start,
  and leaves `source_text`, `source_start_ms`, `source_end_ms` and `strength` NULL,
  so spec `0002`'s NULL invariant holds unchanged.
- **AC-80**: A new manual scene starts on `text-card`, at the midpoint of the
  duration window, and cannot be saved with empty overlay text or with text longer
  than `MAX_OVERLAY_TEXT_CHARS`. Create rejects an over long caption rather than
  truncating it, unlike the edit path.
- **AC-81**: A manual scene can be deleted. A planner scene cannot. A delete naming
  a planner scene answers 404, the same answer another user's scene id gets.
- **AC-82**: Manual scenes are capped per project at
  `MAX_MANUAL_SCENES_PER_PROJECT`. At the cap, create is refused with a message
  naming the cap, and no row is written. The count is evaluated **inside** the
  insert, so two concurrent creates cannot both pass it.
- **AC-83**: Create and delete go through `sceneCreateRateLimit` and fail
  **closed** when the limiter is unavailable. The edit path (`included`,
  `overlay_text`, `layout_template`, `emotion`) keeps `writeRateLimit` and stays
  fail **open**, as built.
- **AC-84**: Every planner scene row displays its `strength`. A manual scene has
  none, so it displays no score and keeps its existing "added by hand" label. A
  NULL strength is never rendered as zero.
- **AC-85**: At plan time the planner writes `included = false` for scenes beyond
  its own target count, ranked by `strength` descending and by `start_ms` ascending
  as the tiebreak, and `included = true` for the rest. A plan returning at or under
  target unchecks nothing.
- **AC-86**: A scene whose **current template renders a chart** displays the cited
  transcript span with the charted figures highlighted inside it, positioned from
  `chart.source_span` offsets into `source_text`. A scene styled away from
  `chart-full` keeps its `chart` value but shows no citation.
- **AC-87**: A scene whose chart the honesty check dropped says so on the scene
  itself, reading as a downgrade to text rather than an error, and survives a page
  reload. The reason is attributed to a scene by `utteranceIndex`, never by
  position in the plan result.
- **AC-88**: A scene preview holds a settled still and plays at the scene's real
  duration on hover. At most one preview animates at a time.
- **AC-89**: Re-running the plan warns first, naming how many **user touched**
  planner scenes will be lost and stating that manual scenes survive. A scene
  counts as touched only when `user_edited_at` is not NULL, never by inspecting
  `overlay_text` or `included`, both of which the planner itself writes.
- **AC-92**: Every Scene Studio write sets `user_edited_at` on the row it changes,
  in the same statement. Nothing else writes that column.
- **AC-93**: Switching a scene to a template that is not a character one clears
  `emotion` to NULL in the same statement that derives `visual_type`, so a non
  character scene never carries a stale emotion.
- **AC-90**: Batch export is disabled when no scene is included, and says what is
  needed rather than producing an empty archive.
- **AC-91**: Every Scene Studio write proves ownership inside the statement, joined
  through `broll_projects` on `user_id`. Another user's scene id answers 404, never
  403.

## Decision

**Chosen option**: Option 2: Presentation editable, claims locked.

A creator may change how a scene looks and whether it ships. They may never change
what it claims. The boundary is drawn at whether a field carries a factual assertion
traced to the transcript, not at how hard the field is to build.

## Rationale

Reasoning, the options weighed, and the evidence: see [rationale.md](./rationale.md).

## Feature design

**Data model sketch**:

No new tables. Two new columns, and a set of new writers on existing ones.

| Column | Change |
|---|---|
| `broll_scenes.chart_rejection_reason` | **New**, `text`, nullable. Why the honesty check dropped this scene's chart. NULL on a scene that never proposed one, which is the common case. |
| `broll_scenes.user_edited_at` | **New**, `timestamptz`, nullable. When a human last changed this row through Scene Studio. NULL means the planner's values are untouched. This is the only sound way to tell a user edit from a planner write, see below. |
| `broll_scenes.layout_template` | Now user writable, constrained per scene (AC-75) |
| `broll_scenes.emotion` | Now user writable on a character template only (AC-77) |
| `broll_scenes.visual_type` | Now derived server side from `layout_template`; never client supplied (AC-76) |
| `broll_scenes.included` | Planner now writes `false` for the surplus; user still owns it after (AC-85) |
| `broll_scenes.origin` | `'manual'` now actually reachable (AC-79) |
| `broll_scenes.start_ms`, `duration_ms` | Writable at manual create only; never on a planner scene (AC-78, AC-79) |
| `broll_scenes.strength` | Unchanged, now read for display and for the surplus rule (AC-84, AC-85) |
| `broll_scenes.source_text`, `source_start_ms`, `source_end_ms` | Unchanged. Stay NULL exactly when `origin = 'manual'` |
| `broll_scenes.chart` | Unchanged, read only to the user (AC-78) |

Both new columns exist because a value this spec needs cannot be derived.

`chart_rejection_reason`: `PlanRejection` is computed at plan time and streamed
back in the run response, so today even the aggregate "3 charts dropped" count
lives in client state and is gone on reload. Deriving it is impossible: once
`chart` is NULL, a scene the planner intended as text and a scene that lost its
chart are the same row. The reason is attributed to a scene by matching
`PlanRejection.utteranceIndex` to the utterance the scene cited, **never by array
position**: `collectScenes` sorts by `startMs` after assembly, so positional
correlation would silently attach the wrong reason to the wrong scene. A rejection
whose `utteranceIndex` is NULL is not attributed to any scene and contributes to
the aggregate count only.

`user_edited_at`: AC-89 must count the review work a re-run is about to destroy,
and after AC-85 there is no field left that answers it. `overlay_text` is written
by the planner at plan time, so it is not NULL on most scenes from the start; and
`included = false` now means either the planner's surplus rule or the user's
exclusion. Both proxies are unsound, so the fact has to be recorded rather than
inferred. One timestamp also answers "what have I changed" for anything later.

**State transitions**:

A scene has two independent axes and no lifecycle beyond them.

- Inclusion: `included = true` ⇄ `included = false`. Reversible forever, never
  deletes. Written first by the planner (AC-85), owned by the user after.
- Origin: fixed at insert. `planner` scenes are replaced wholesale by a re-run and
  cannot be deleted; `manual` scenes survive a re-run and can be deleted (AC-81).

`render_status` is untouched by this feature.

**API surface**:

| Endpoint | Method | Key inputs | Key outputs | Auth | Key errors |
|---|---|---|---|---|---|
| `/api/projects/[id]/scenes/[sceneId]` | PATCH | `included:boolean` (opt), `overlayText:string\|null` (opt), `layoutTemplate:string` (opt), `emotion:string\|null` (opt) | `{ ok: true }` | Clerk session | 404 not owned or absent, 422 template invalid for this scene, 422 emotion not committed or set on a non character template |
| `/api/projects/[id]/scenes` | POST | `segmentIndex:number` (req), `overlayText:string` (req) | `{ id, startMs, durationMs }` | Clerk session | 404 project not owned, 409 at the manual cap, 422 empty text, 422 text over `MAX_OVERLAY_TEXT_CHARS`, 422 `segmentIndex` out of range or not an integer, 429 limiter unavailable |
| `/api/projects/[id]/scenes/[sceneId]` | DELETE | none | `{ ok: true }` | Clerk session | 404 not owned, absent, or `origin = 'planner'`, 429 limiter unavailable |

The PATCH route exists and gains two fields. POST and DELETE are new.

**Field handling on PATCH.** The route accepts a **closed list** of four fields.
Anything else in the body is ignored rather than filtered out of a supplied object,
which is what makes AC-78 a property of the route's shape rather than of a
blocklist someone has to keep current. `visual_type` is derived from
`layoutTemplate` and `emotion` is cleared to NULL when the new template is not a
character one, both in the same statement (AC-93). `user_edited_at` is set on every
successful write (AC-92).

**Rate limiting.** PATCH keeps `writeRateLimit` (fail open, as built). POST and
DELETE use a new `sceneCreateRateLimit(clerkId)` in `rate-limit.ts`, key
`broll-scene-create:${clerkId}`, 30 requests per 60 seconds, `failClosed: true`.
They create and destroy rows rather than toggling two columns, so they do not
inherit the fail open reasoning that the edit path is built on.

**Value sourcing**:

| Action | Value produced / displayed | Source |
|---|---|---|
| List scenes | strength score | `broll_scenes.strength`, written by the planner. NULL on a manual scene, displayed as no score rather than as zero |
| List scenes | which templates this scene may become | Derived: `broll_scenes.chart` non NULL gates `chart-full`; a committed `broll_assets` row for this project gates the character templates; `RENDERABLE_TEMPLATES` in `render/renderable.ts` gates all four |
| List scenes | which emotions are offerable | `broll_assets.emotion` rows committed for this project |
| List scenes | the cited quote, with figures highlighted | `broll_scenes.source_text` for the text, `chart.source_span` `{startChar, endChar}` for the offsets, both already stored. Offset semantics decided in spec `0003` |
| List scenes | why this scene is text and not a chart | `broll_scenes.chart_rejection_reason`, new column, written at plan time from `PlanRejection.reason` |
| Plan run | which scene a rejection belongs to | `PlanRejection.utteranceIndex` matched against the utterance the scene cited. Never array position: `collectScenes` sorts by `startMs` after assembly. A NULL `utteranceIndex` attributes to no scene |
| List scenes | aggregate dropped chart count | Now derived from the same column, so it survives a reload; today it comes from the run response only |
| Plan run | `included` for each scene | Derived at plan time: rank by `strength` descending, `start_ms` ascending as tiebreak, keep the planner's own target count, uncheck the rest. Target is `ceil(duration_ms / 60000 * SCENES_PER_MINUTE)`, decided in spec `0003` AC-50 |
| Create manual scene | `start_ms` | The `start_ms` of the transcript segment the creator picked, read from the stored document |
| Create manual scene | `duration_ms` | Midpoint of `MIN_SCENE_DURATION_MS` and `MAX_SCENE_DURATION_MS` in `scene-schema.ts`, the single home for that window |
| Create manual scene | `layout_template` | Constant `text-card`, the only template valid with no chart and no character set |
| Create manual scene | `visual_type` | Derived from `layout_template` |
| Create manual scene | `origin` | Constant `manual` |
| Create manual scene | the cap | `MAX_MANUAL_SCENES_PER_PROJECT` in `scene-limits.ts`, the existing home for constants both the server and the browser read |
| Create manual scene | whether the cap is reached | A count of `broll_scenes` where `origin = 'manual'`, evaluated **inside** the insert so two concurrent creates cannot both pass it |
| Patch scene | `visual_type` | Derived from the submitted `layout_template`, never read from the request |
| Patch scene | `emotion` after a template switch | NULL when the new template is not a character one, written in the same statement (AC-93) |
| Patch, create, delete | `user_edited_at` | The statement's own clock, set on every successful Scene Studio write and by nothing else (AC-92) |
| Delete scene | whether deletion is permitted | `broll_scenes.origin = 'manual'`, checked inside the DELETE statement |
| Export gate | whether anything is included | Count of `broll_scenes` where `included` for this project |
| Re-run warning | how much review work is at risk | Count of planner scenes where `user_edited_at` is not NULL. **Not** `overlay_text` (the planner writes it at plan time) and **not** `included = false` (AC-85 makes the planner write that too) |

**Key invariants**:

- A creator can never write a value that carries a factual claim. `chart`,
  `start_ms` and `duration_ms` on a planner scene are read only to the user, enforced
  by the PATCH route accepting a closed field list rather than filtering a supplied
  object (AC-78).
- `visual_type` always agrees with `layout_template`, because only one of them is
  ever written and the other is derived from it (AC-76). Two writable fields
  encoding the same fact is a contradiction waiting to be stored.
- `source_text`, `source_start_ms`, `source_end_ms` and `strength` are NULL exactly
  when `origin = 'manual'`, unchanged from spec `0002` (AC-79).
- A scene is never deleted unless the creator created it (AC-81).
- A creator can never select a template this scene cannot draw, because the option
  is not offered rather than rejected after the fact (AC-75).
- `emotion` is NULL on any scene whose template is not a character template
  (AC-93), enforced by the same statement that derives `visual_type` rather than by
  a separate cleanup.
- `user_edited_at` is not NULL if and only if a human changed the row through
  Scene Studio (AC-92). Nothing else may write it, or the re-run warning starts
  counting the planner's own work as the creator's.
- The manual scene count never exceeds `MAX_MANUAL_SCENES_PER_PROJECT`, enforced
  inside the insert (AC-82). A read then insert is two statements racing, which is
  the same failure the ownership rule above exists to prevent.
- `chart` is never cleared by a template change. A creator who styles a scene away
  from `chart-full` and back gets their chart intact, and AC-86's citation is keyed
  off the current template rather than off the column being present.

**Security model**:

Every read and write is scoped to the signed in Clerk user through
`broll_projects.user_id`. Ownership is proved **inside** the mutating statement,
joined through `broll_projects`, never by reading the row first and then writing
(AC-91). Reading first is two statements racing, and answering 403 confirms the
row exists to someone who should not know that. A scene id belonging to another
user is indistinguishable from one that does not exist.

No regulated data is added. Scene text is transcript derived and already stored.
The Sentry scrubber established in PR #144 already strips request bodies, so the
new POST and DELETE inherit that with no extra work.

**Configuration required**:

None. No new environment variable, secret, or third party credential.

**Critical test scenarios**:

- Happy path: a creator switches a `character-left` scene to `character-center`,
  changes its emotion, excludes a weak scene, adds one manual scene, and exports a
  zip containing exactly the included scenes in plan order. Verifies **AC-75**,
  **AC-77**, **AC-79**, **AC-90**.
- Constraint: a scene with no chart is offered no `chart-full` option, and a PATCH
  naming `chart-full` on it answers 422 rather than storing a template that cannot
  draw. Verifies **AC-75**.
- Claim lock: a PATCH carrying `chart`, `startMs` or `visualType` does not write
  them, whatever else the request contains. Verifies **AC-76**, **AC-78**.
- Invariant: a manual scene is created and read back with `source_text`,
  `source_start_ms`, `source_end_ms` and `strength` all NULL. Verifies **AC-79**.
- Failure case: the rate limiter is unavailable. A create is refused and an
  `included` toggle still succeeds. Verifies **AC-83**.
- Failure case: a plan re-run lands while an edit is debounced in the browser. The
  PATCH answers 404 and the UI does not report a saved change. Verifies **AC-89**.
- Auth/permission: another user's scene id answers 404 on PATCH and on DELETE, and
  a planner scene answers 404 on DELETE. Verifies **AC-81**, **AC-91**.

## Build plan

Tracer Bullet: a thin thread through every layer first, then thicken. The order
below puts the migration in slice 1 because two later slices read the new column,
and puts one complete editable field end to end before adding the second.

1. Migration adding `broll_scenes.chart_rejection_reason` and
   `broll_scenes.user_edited_at`, both nullable. Write the reason at plan time,
   attributing it by `utteranceIndex`. Satisfies **AC-87** at the data layer.
2. The thin thread: extend the PATCH route and `updateBrollScene` to accept
   `layoutTemplate` on a closed field list, derive `visual_type` from it server
   side, clear `emotion` off a character template, and stamp `user_edited_at`. One
   template picker in the UI, filtered per scene. Satisfies **AC-75**, **AC-76**,
   **AC-78**, **AC-92**, **AC-93**.
3. Emotion override on the same route and picker, gated on the template being a
   character one and on the emotion being committed for this project. Satisfies
   **AC-77**.
4. Manual scenes: `POST /api/projects/[id]/scenes` with the segment picker, the
   text-card default, the required text with its length check, and the cap
   evaluated inside the insert; plus `DELETE` restricted to `origin = 'manual'`.
   Both go through the new fail closed `sceneCreateRateLimit`. Satisfies
   **AC-79**, **AC-80**, **AC-81**, **AC-82**, **AC-83**, **AC-91**.
5. The surplus rule at plan time: rank by `strength` descending with `start_ms`
   ascending as tiebreak, keep the planner's target count, write `included`
   accordingly. Satisfies **AC-85**.
6. The review surface reads: strength on every planner row, the cited quote with
   the charted figures highlighted on scenes whose current template draws a chart,
   and the per scene downgrade note reading from the column slice 1 added.
   Satisfies **AC-84**, **AC-86**, **AC-87**.
7. Preview on hover with one animating canvas at a time, the re-run warning
   counting `user_edited_at`, and the export gate when nothing is included.
   Satisfies **AC-88**, **AC-89**, **AC-90**.

## Consequences

**Positive**:

- A creator can rescue a good moment the planner styled badly, which is the
  difference between a review surface and a read only list.
- The editable set now has a stated principle rather than an accident of build
  order. "Does this field carry a claim?" answers every future request to make
  something editable, including ones nobody has asked for yet.
- `strength` and `origin` stop being written and never read. Both were built for
  exactly this and have been dead weight since migration `0015`.
- The downgrade explanation survives a reload, so the product's central promise
  is answerable at the moment a creator doubts it.

**Negative / tradeoffs**:

- A migration this spec spent a round trying to avoid, and it grew from one column
  to two. Both are nullable and neither is on a money path, but it is still a
  shared schema change going through `packages/db`.
- `user_edited_at` is a fact that must be maintained rather than derived, so every
  future write path into `broll_scenes` has to remember to stamp it. That is the
  standing cost of the re-run warning being truthful, and a write that forgets it
  makes the warning quietly under count.
- The surplus rule is a heuristic with no evidence, exactly like
  `SCENES_PER_MINUTE`. It reuses an existing untuned number rather than inventing
  a second one, which limits the damage without removing it. AC-28's tuning should
  revisit both together.
- The template picker needs the project's committed character set to decide what
  to offer, so the scene list query grows a join it did not have.
- Hover to play means a creator on a trackpad triggers previews while scrolling
  past. Cheaper than twenty looping canvases, and worse than a deliberate click.

**Neutral**:

- `visual_type` becomes a derived column in practice while staying a stored one.
  It keeps its value for querying and stops being a decision.
- The PATCH route moves from a two field open shape to a closed field list, which
  is a small refactor of code that shipped three days ago.

## Follow-up

- [ ] AC-28's selectivity tuning should revisit the surplus rule and
      `SCENES_PER_MINUTE` together, since the rule reuses that constant. Neither
      has evidence today.
- [ ] `packages/db/src/schema.ts` carries a comment on `strength` saying it is
      "deliberately NOT used to decide `included`". AC-85 changes that. Update the
      comment when the migration lands so the schema does not contradict the
      shipped behaviour.
- [ ] The design brief's `character-plus-chart` and `split-compare` templates have
      no renderer and are therefore not offerable (AC-75). They are still listed in
      `design-prompt.md` B6 as part of the six. Decide whether they ship or are
      dropped from the brief.
- [ ] B6 describes a template as "positions plus motion" with entrance, idle drift
      and optional exit. The built renderers take `elapsedMs` and animate, but no
      spec records what each template's motion actually is. Worth its own spec
      before a creator judges templates by their motion.
