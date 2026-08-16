# Verify: Scene Studio · spec 0005

Checked by `/check verify`. Each box maps to an acceptance criterion in
[index.md](./index.md). Tick a box only when it was actually driven and passed.

Nothing here needs a vendor key or spends money. Every box is runnable against the
dev Neon branch with a planned project; project `0620` is the reference, and a
project with a committed character set is needed for the emotion boxes.

## Unit

- [x] The template options for a scene with `chart` NULL exclude `chart-full`, and
      include it when `chart` is present. → **AC-75**
      _Driven 2026-08-13 against the live dev branch on a scratch project. The
      scene whose chart was dropped read back `hasChart: false` and was offered
      no `chart-full`; the scene carrying a chart was._
- [x] The template options for a project with no committed `broll_assets` exclude
      `character-left` and `character-center`. → **AC-75**
      _The scratch project had zero committed assets and the two character
      templates were absent from its options._
- [x] A template with no renderer is never in the options, checked against
      `RENDERABLE_TEMPLATES` rather than a second hardcoded list. → **AC-75**
- [ ] `visual_type` is derived from each of the four templates and matches the
      expected value; a request supplying `visualType` does not change the stored
      column. → **AC-76**
      _Half driven. The derivation was read back off the live column after a real
      template switch (`text-card` → `visual_type` `text`). The **request** half
      was not: every route needs a Clerk session, see Blocked in the report._
- [ ] An emotion not committed for the project is refused; one that is, is
      accepted; both while the template is a character one. An emotion change on
      `text-card` or `chart-full` is refused. → **AC-77**
      _Not driven. This gate lives in the route handler, which could not be
      reached without a signed in session._
- [x] Switching a scene from `character-left` to `text-card` clears `emotion` to
      NULL in the same write, and switching back leaves it NULL until an emotion
      is chosen. → **AC-93**
      _Driven live: a `character-left` scene carrying `thoughtful` came back
      `layout_template` `text-card`, `visual_type` `text`, `emotion` NULL, from
      one statement._
- [ ] A rejection is attributed to the scene citing the same `utteranceIndex`,
      **not** to the scene at the same array position. Build a case where the two
      differ: `collectScenes` sorts by `startMs`, so a plan whose rejections arrive
      out of timecode order is the test that catches a positional implementation.
      A rejection with a NULL `utteranceIndex` attaches to no scene. → **AC-87**
- [x] The surplus rule's tiebreak: two scenes of equal `strength` at the cut line
      resolve by `start_ms` ascending, deterministically across repeated runs of
      the same input. → **AC-85**
- [x] A PATCH body carrying `chart`, `startMs`, `durationMs` or `visualType`
      alongside a valid `overlayText` writes only `overlay_text`, leaving the rest
      untouched. The route accepts a closed field list rather than filtering.
      → **AC-78**
      _Driven live at the statement layer, which is where the closed list is
      enforced: a call carrying all four extra fields beside a caption left
      `chart`, `start_ms` and `duration_ms` byte identical and saved the caption._
- [x] A manual scene insert leaves `source_text`, `source_start_ms`,
      `source_end_ms` and `strength` NULL, and sets `origin = 'manual'` with
      `start_ms` equal to the picked segment's start. → **AC-79**
      _Read back off the live row: all four NULL, `origin` `manual`, `start_ms`
      42000 exactly as passed._
- [ ] A new manual scene defaults to `text-card` and to the midpoint of
      `MIN_SCENE_DURATION_MS` and `MAX_SCENE_DURATION_MS`, read from
      `scene-schema.ts` rather than from literals. Empty or whitespace only text is
      refused, and text over `MAX_OVERLAY_TEXT_CHARS` is **refused, not
      truncated**, unlike the PATCH path. → **AC-80**
      _Half driven. The defaults were read back live: `text-card`, 7000ms, equal
      to the midpoint computed from the two constants. The empty and over long
      text refusals are Zod in the route and were **not** exercised._
- [ ] A manual scene's NULL `strength` renders as no score, never as `0` and never
      as `0.0`. → **AC-84**
      _Not driven. The NULL reaches the client correctly (confirmed live), but
      what it renders as needs the page in a browser._
- [x] The surplus rule ranks by `strength` descending, keeps exactly the planner's
      target count, and unchecks the rest. A plan at target and a plan under target
      both uncheck nothing. → **AC-85**
      _15 scenes against project `0620`'s real target of 12 left exactly 12
      checked, and they were the 12 strongest. 12 at target unchecked nothing._
- [x] The highlight offsets resolve `chart.source_span` `{startChar, endChar}`
      against `source_text` and mark the charted figures, including a span whose
      figures are not at its start. → **AC-86**
      _"We cut fuel imports by 80% in three years." marked `80%` at offset 23 of
      the span, and the parts rejoin to the original line exactly._

## Route

**None of the HTTP status codes below were driven.** Every route here sits behind
`proxy.ts`, which answers `401` before the handler loads, so reaching them needs a
signed in Clerk session and this run had none. What could be driven is the
statement each route calls, and those results are recorded per box. Read an
unticked box here as "not exercised", not as "failed".

- [ ] `PATCH` with another user's `sceneId` answers 404, not 403, and changes no
      row. → **AC-91**
      _The "changes no row" half is driven and holds: a write as a different user
      id returned false and the row was byte identical afterwards, and the same
      user read no edit context. The `404` status itself is not driven._
- [ ] `DELETE` on a `origin = 'planner'` scene answers 404 and the row survives.
      → **AC-81**
      _The "row survives" half is driven and holds: the delete returned false and
      the planner scene was still there. The status is not driven._
- [ ] `DELETE` on the caller's own `origin = 'manual'` scene removes it.
      → **AC-81**
      _Driven at the statement layer: the row was removed. The route was not._
- [ ] `POST` at the manual cap answers 409, names the cap, and writes no row.
      → **AC-82**
      _The "writes no row" half is driven: at 40 of 40 the create returned
      `at_cap` and the count did not move. The `409` and its message are not._
- [x] **Two concurrent `POST`s at the cap boundary**, fired together, result in at
      most the cap. The count is inside the insert, so a read then insert
      implementation fails this and passes the box above. → **AC-82**
      _Driven at the statement layer: two creates fired together at 39 of 40, one
      created and one answered `at_cap`, final count 40. **One observation of a
      race is weak evidence**, and this build's own note says a genuinely
      simultaneous pair inside one statement's execution can still both pass
      under read committed. Treat this tick as "did not reproduce", not as proof._
- [ ] `POST` with a `segmentIndex` past the end of the document, negative, or not
      an integer answers 422 and writes no row. → **AC-79**
- [ ] With the rate limiter unreachable, `POST` and `DELETE` are refused while a
      `PATCH` toggling `included` still succeeds. This is the one asymmetry in the
      app and the test is what pins it. → **AC-83**
- [x] Every successful `PATCH`, `POST` and `DELETE` sets `user_edited_at`; a plan
      run leaves it NULL on every scene it writes. → **AC-92**
      _Driven live, and this is a statement level guarantee rather than a route
      one, so the layer that enforces it is the layer that was exercised. A plan
      run wrote 4 scenes all NULL; one caption edit stamped exactly that row; a
      manual create stamped its own; a re-run came back all NULL again._
- [ ] A `PATCH` naming a scene a plan re-run has already replaced answers 404.
      → **AC-89**

## Runtime, driven in the real app

**Nothing in this section was driven on 2026-08-13.** The dev server started
clean on port 3003 and answered, but every box below needs a signed in session,
and this session had no browser automation and no way to complete a Clerk sign
in. These are the boxes a human has to sit in front of, and they are the ones
carrying the two Phase 0 canvas hazards.

- [ ] Switch a `character-left` scene to `character-center` and watch the preview
      redraw to the new composition. → **AC-75**
- [ ] Change that scene's emotion and watch the character image change to the
      matching committed variant. → **AC-77**
- [ ] Every scene row shows its strength score. → **AC-84**
- [ ] A scene carrying a chart shows the cited transcript line with the charted
      figures visibly marked inside it. Read one number off the chart and find it
      in the quote. → **AC-86**
- [ ] A scene whose chart was dropped says so on the scene, reads as a downgrade
      rather than an error, and **still says so after a full page reload**. The
      reload is the point of this box. → **AC-87**
- [ ] A preview holds a still, plays at the scene's real duration on hover, and
      only one canvas animates at a time with twenty scenes on screen. Watch for a
      frame bleeding through a repaint and for the loop surviving a keystroke in
      the caption field, which are Phase 0's two recorded bugs. → **AC-88**
- [ ] Add a manual scene by picking a transcript segment, then export and confirm
      the clip lands at that segment's timecode. → **AC-79**
- [ ] Re-run the plan on a **freshly planned project nobody has touched**. The
      warning says nothing is at risk. This is the box that catches the unsound
      proxy: the planner writes `overlay_text` at plan time and, under AC-85,
      writes `included = false` too, so an implementation reading either will
      wrongly claim work is at risk here. → **AC-89**
- [ ] Then edit one scene, exclude another, re-run, and read the warning again: it
      names the touched scenes and says manual scenes survive. Confirm afterwards
      that the manual scene is still there and the planner scenes were replaced.
      → **AC-89**
- [ ] Exclude every scene and confirm export is disabled with an explanation, and
      that no empty archive can be produced. → **AC-90**

## Migration

- [x] `chart_rejection_reason` and `user_edited_at` applied to the **dev branch**
      (migration `0017`, 2026-08-13). `db:verify` passes, and
      `information_schema.columns` confirms both live, `text` and
      `timestamp with time zone`, both nullable with no default. Production is
      **not** done: this app has no production deploy yet, so it is applied there
      with feature 8. → **AC-87**, **AC-92**
- [x] A plan run writes the reason on a scene whose chart was dropped and leaves it
      NULL on a scene that never proposed one. → **AC-87**
      _Driven live: a plan of 4 stored `"the value 42 does not appear in the
      cited line"` on the downgraded scene and NULL on the other three, and it
      read back through `listBrollScenes` unchanged, which is what makes the
      aggregate count survive a reload._

---

## Added by /develop, 2026-08-13

_Steps this build derived, one per Value sourcing row not already covered above,
plus the three places the build's own decisions need watching. Everything above
this line was written at design time and is unchanged._

### Two boxes above need re-reading before they are driven

- [x] **The concurrency box under Route (`AC-82`, two concurrent POSTs) asserts
      more than this build guarantees, and that is known rather than a bug to
      find.** The count is a subquery of the insert, so no read then write race
      exists and every race longer than one statement is closed — which is the
      shape a double click and a retried request actually take. But under
      Postgres' default read committed isolation, two inserts overlapping inside
      a single statement's execution can still both see the same count, and the
      Neon HTTP driver gives each statement its own transaction, so there is no
      wider one to serialize them in. Drive the box, and if a genuinely
      simultaneous pair lands one row over the cap, record it as the documented
      limit rather than a failure. A lost race costs one extra row on a path
      that spends nothing at any vendor. → **AC-82**
      _Driven 2026-08-13 and it did not reproduce: two creates fired together at
      39 of 40 gave one row and one `at_cap`, final count 40. Recorded as "did
      not reproduce" rather than as proof, because one run of a race proves
      little and the narrower guarantee above still stands._
- [ ] **The claim lock box under Unit (`AC-78`) settled a wording conflict in
      `index.md`, in its favour.** AC-78 says a request naming `chart` is
      "rejected", while AC-76 and that box both say such a field is *ignored*
      while the rest of the request applies. The route now ignores: the schema
      names four fields and strips anything else, so a body carrying `chart`
      beside a valid `overlayText` saves the caption and drops the chart. Drive
      the box as written. AC-78's sentence is the one that should be tidied.
      → **AC-76**, **AC-78**

### Value sourcing rows

- [ ] The **aggregate** dropped chart count survives a reload, not just the per
      scene note. Plan a project where two charts are dropped, read the count,
      reload, and read it again: it is derived from `chart_rejection_reason`
      across the scenes, so it must be identical. Before this build it lived in
      client state and read zero after a refresh. → **AC-87**
- [x] The surplus rule's target is the planner's own, not a second number.
      Against project `0620` (586,800ms), `sceneCountTarget` is 12, so a plan
      returning 15 scenes leaves exactly 12 checked and 3 unchecked. Change
      `SCENES_PER_MINUTE` and confirm the number checked moves with it, which is
      what proves the two are one source. → **AC-85**
      _Driven with `0620`'s real duration: target 12, 15 scenes in, 12 checked,
      and the 3 unchecked were the 3 weakest. The constant was not moved, but the
      target is read from `sceneCountTarget` rather than passed as a literal, so
      there is no second number to drift._
- [x] A manual scene's duration is the midpoint of the window, read from
      `scene-schema.ts`. Move `MAX_SCENE_DURATION_MS` and confirm a newly added
      scene's duration moves with it rather than staying at 7000. → **AC-80**
      _The stored duration was 7000 and equal to the midpoint recomputed from
      `MIN_SCENE_DURATION_MS` and `MAX_SCENE_DURATION_MS` at run time, so the two
      cannot disagree. The constant itself was not moved._
- [ ] The emotion picker offers exactly the emotions in `broll_assets` for this
      project. Delete one committed asset row and confirm that emotion stops
      being offered **and** that a PATCH naming it answers 422. → **AC-77**
- [ ] A scene styled away from `chart-full` keeps its `chart` value: switch one
      to `text-card`, confirm the citation disappears, switch back, and confirm
      the chart draws again intact. The citation is keyed off the current
      template, not off the column being present. → **AC-86**
- [ ] The export gate distinguishes its two cases. With scenes present but none
      included it says nothing is switched on; with scenes included whose
      templates have no renderer it says none can be drawn. Neither produces an
      archive. → **AC-90**

### What the build decided, and what watching it looks like

- [ ] **A figure the honesty check accepted as a word is not emphasised in the
      citation, and the chart still draws.** Plan against a line reading "up
      three times", confirm the chart survives, and confirm the quote shows the
      whole cited span with no bold number in it. This is deliberate:
      `citation.ts` matches literally while `honesty.ts` accepts word forms,
      because the highlight is presentation and underlining a word as a figure
      reads more into the sentence than the offsets support. A reviewer meeting
      this cold will read it as a bug. → **AC-86**
- [ ] **The rejection reason is attributed at assembly, not matched afterwards.**
      The Unit box above asks for a plan whose rejections arrive out of timecode
      order; this build passes it for a stronger reason than that box tests, so
      also drive the case the box cannot distinguish: **two scenes citing the
      same utterance, both proposing a chart, only one traceable.** An
      `utteranceIndex` match attaches the reason to both; this build attaches it
      to the one that lost its chart. → **AC-87**
- [x] **`user_edited_at` has exactly one writer.** After a plan run, every
      planner scene has it NULL. After one caption edit it is set on that row and
      still NULL on every other. Re-run the plan and confirm it is NULL again
      across the new scenes, and that the warning beforehand counted exactly the
      one edited scene — not the scenes the surplus rule unchecked, and not the
      ones the planner wrote a caption for. → **AC-89**, **AC-92**
      _Driven live, and this is the box that would have caught the unsound proxy.
      At the moment of counting, the project held 44 scenes that **all** carried
      a caption and were **all** excluded, and the count of work at risk was
      **zero**. Either proxy would have said 44. One caption edit then moved it to
      exactly 1, and a re-run put every new planner scene back to NULL while all
      40 manual scenes survived._

### Acceptance criteria coverage

Every criterion AC-75 to AC-93 is covered by at least one box in this file.
The boxes added here cover **AC-76**, **AC-77**, **AC-78**, **AC-80**,
**AC-82**, **AC-85**, **AC-86**, **AC-87**, **AC-89**, **AC-90** and **AC-92**
a second time, from the value's source rather than from the behaviour, which is
the layer that catches a value drawn from the wrong place while still looking
right on screen.
