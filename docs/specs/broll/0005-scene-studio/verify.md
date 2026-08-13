# Verify: Scene Studio · spec 0005

Checked by `/check verify`. Each box maps to an acceptance criterion in
[index.md](./index.md). Tick a box only when it was actually driven and passed.

Nothing here needs a vendor key or spends money. Every box is runnable against the
dev Neon branch with a planned project; project `0620` is the reference, and a
project with a committed character set is needed for the emotion boxes.

## Unit

- [ ] The template options for a scene with `chart` NULL exclude `chart-full`, and
      include it when `chart` is present. → **AC-75**
- [ ] The template options for a project with no committed `broll_assets` exclude
      `character-left` and `character-center`. → **AC-75**
- [ ] A template with no renderer is never in the options, checked against
      `RENDERABLE_TEMPLATES` rather than a second hardcoded list. → **AC-75**
- [ ] `visual_type` is derived from each of the four templates and matches the
      expected value; a request supplying `visualType` does not change the stored
      column. → **AC-76**
- [ ] An emotion not committed for the project is refused; one that is, is
      accepted; both while the template is a character one. An emotion change on
      `text-card` or `chart-full` is refused. → **AC-77**
- [ ] Switching a scene from `character-left` to `text-card` clears `emotion` to
      NULL in the same write, and switching back leaves it NULL until an emotion
      is chosen. → **AC-93**
- [ ] A rejection is attributed to the scene citing the same `utteranceIndex`,
      **not** to the scene at the same array position. Build a case where the two
      differ: `collectScenes` sorts by `startMs`, so a plan whose rejections arrive
      out of timecode order is the test that catches a positional implementation.
      A rejection with a NULL `utteranceIndex` attaches to no scene. → **AC-87**
- [ ] The surplus rule's tiebreak: two scenes of equal `strength` at the cut line
      resolve by `start_ms` ascending, deterministically across repeated runs of
      the same input. → **AC-85**
- [ ] A PATCH body carrying `chart`, `startMs`, `durationMs` or `visualType`
      alongside a valid `overlayText` writes only `overlay_text`, leaving the rest
      untouched. The route accepts a closed field list rather than filtering.
      → **AC-78**
- [ ] A manual scene insert leaves `source_text`, `source_start_ms`,
      `source_end_ms` and `strength` NULL, and sets `origin = 'manual'` with
      `start_ms` equal to the picked segment's start. → **AC-79**
- [ ] A new manual scene defaults to `text-card` and to the midpoint of
      `MIN_SCENE_DURATION_MS` and `MAX_SCENE_DURATION_MS`, read from
      `scene-schema.ts` rather than from literals. Empty or whitespace only text is
      refused, and text over `MAX_OVERLAY_TEXT_CHARS` is **refused, not
      truncated**, unlike the PATCH path. → **AC-80**
- [ ] A manual scene's NULL `strength` renders as no score, never as `0` and never
      as `0.0`. → **AC-84**
- [ ] The surplus rule ranks by `strength` descending, keeps exactly the planner's
      target count, and unchecks the rest. A plan at target and a plan under target
      both uncheck nothing. → **AC-85**
- [ ] The highlight offsets resolve `chart.source_span` `{startChar, endChar}`
      against `source_text` and mark the charted figures, including a span whose
      figures are not at its start. → **AC-86**

## Route

- [ ] `PATCH` with another user's `sceneId` answers 404, not 403, and changes no
      row. → **AC-91**
- [ ] `DELETE` on a `origin = 'planner'` scene answers 404 and the row survives.
      → **AC-81**
- [ ] `DELETE` on the caller's own `origin = 'manual'` scene removes it.
      → **AC-81**
- [ ] `POST` at the manual cap answers 409, names the cap, and writes no row.
      → **AC-82**
- [ ] **Two concurrent `POST`s at the cap boundary**, fired together, result in at
      most the cap. The count is inside the insert, so a read then insert
      implementation fails this and passes the box above. → **AC-82**
- [ ] `POST` with a `segmentIndex` past the end of the document, negative, or not
      an integer answers 422 and writes no row. → **AC-79**
- [ ] With the rate limiter unreachable, `POST` and `DELETE` are refused while a
      `PATCH` toggling `included` still succeeds. This is the one asymmetry in the
      app and the test is what pins it. → **AC-83**
- [ ] Every successful `PATCH`, `POST` and `DELETE` sets `user_edited_at`; a plan
      run leaves it NULL on every scene it writes. → **AC-92**
- [ ] A `PATCH` naming a scene a plan re-run has already replaced answers 404.
      → **AC-89**

## Runtime, driven in the real app

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

- [ ] `chart_rejection_reason` and `user_edited_at` applied to the dev branch, then
      to production behind the preflight prompt. `db:verify` passes on both, and
      both columns are nullable with no default. → **AC-87**, **AC-92**
- [ ] A plan run writes the reason on a scene whose chart was dropped and leaves it
      NULL on a scene that never proposed one. → **AC-87**
