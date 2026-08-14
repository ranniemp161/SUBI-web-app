# Verify: Scene Studio layout · spec 0006 · updated 2026-08-14

_Steps derived from spec 0006 acceptance criteria. `/check verify` runs these; `/test`
locks the durable ones._

**Nothing here spends money or calls a vendor**, with one exception: any step that
presses **Re-run plan** charges the plan re-run price. Every other step is free, and
rendering is free by design. Run project `0620` on the dev branch
(`ep-holy-hall-aoe13azt`), which is what `apps/broll/.env.local` points at.

**Run spec `0005`'s `verify.md` in the same sitting.** Its screen boxes are all
unticked and they need a human in front of this exact screen; driving it once rather
than twice is the whole reason this feature was put in front of them.

## UI / manual

### Arriving and scanning

- [ ] Open a planned project's page → the plan is **not** on it. There is a Scene
      Studio card stating the scene count and the included count, and an Open Scene
      Studio button → AC-94
- [ ] Same page, scroll to the bottom → the Parsed segments list is gone. The only
      place transcript lines are listed anywhere in the app is the add scene picker
      → AC-112
- [ ] Press Open Scene Studio → lands on `/dashboard/<id>/scenes` → AC-94
- [ ] In the studio, scroll the list to the bottom → **the browser's own scrollbar
      never moves**. The bar stays put, and the list and detail panes scroll
      independently of each other → AC-96
- [ ] Read ten rows without opening any → every row shows a timecode, a duration, and
      a source line over up to three lines. **No row shows a single truncated
      fragment** → AC-97
- [ ] Find a planner scene and a manual scene in the same list → the planner scene
      shows a meter plus one of `strong` / `fair` / `weak`; the manual scene shows
      **no meter and no word**, and nowhere shows a zero → AC-98
- [ ] Check the four markers each appear on at least one row (excluded, downgraded to
      text, added by hand, chart traced) → each is a **word**, not a colour or a dim.
      An excluded row is exactly as legible as an included one → AC-99
- [ ] Look at the row stills → every row whose template has a renderer shows a small
      frame of the scene. Switch a scene to `character-plus-chart` or `split-compare`
      if one is available → that row shows a labelled "No preview yet" box, never a
      blank one → AC-100
- [ ] Open dev tools performance and record five seconds while hovering down the list
      → **no `requestAnimationFrame` loop is running for any row**. Only the detail
      pane's preview animates → AC-101
- [ ] Press each filter chip in turn → each shows a count, the list narrows, and the
      order never changes: always ascending by timecode, and there is no way to
      re-sort → AC-105
- [ ] Press the `chart on screen` chip → its members are exactly the rows carrying the
      `chart traced` marker, and each of those, opened, shows a citation → AC-105

### The single scene

- [ ] Click a row → the detail pane shows, top to bottom: the large preview, then
      include / template / emotion / on screen text, then the provenance block →
      AC-102
- [ ] Copy the URL, reload from it → the same scene is open → AC-103
- [ ] With a scene open, press the `excluded` chip while that scene is included → the
      row disappears from the list and **the scene stays open in the detail pane** →
      AC-103, AC-105
- [ ] Press a filter chip that matches nothing → the list says so and offers to clear
      itself, and the detail pane is unchanged → AC-105
- [ ] Toggle include from the row, then from the detail pane → the two always agree,
      and reloading shows the last state → AC-104
- [ ] Change the open scene's template and its caption → the preview redraws as you
      type, and the row's still redraws to match → AC-100, AC-102
- [ ] Confirm there is **no control anywhere on this screen** for a chart's values or
      a scene's start or duration → AC-113
- [ ] Watch the preview at a scene's real length → it plays for that scene's duration
      and settles, and it is the only thing moving on the screen → AC-101

### Keyboard

- [ ] Click a row, then press `ArrowDown`, `ArrowUp`, `j`, `k` → the selection moves
      one row at a time and the detail pane follows → AC-107
- [ ] Press `space` with a row focused → that scene's inclusion toggles → AC-107
- [ ] Put the caret in the on screen text field and press `space` → **a space is
      typed and inclusion does not change** → AC-107
- [ ] Open a template or emotion select and press the arrow keys → the select changes
      and the list selection does not move → AC-107
- [ ] Press `Enter` on a focused row → focus lands on the detail pane's include
      toggle → AC-107
- [ ] Tab through the screen → the focus ring is the blue 2px ring at 2px offset, and
      it is visible on every control including inside both scrolling panes → AC-107

### Provenance

- [ ] Open a scene drawing a chart → the provenance block shows the full source line,
      then the cited quote with the charted figures highlighted → AC-102
- [ ] Restyle that scene away from `chart-full` → the citation disappears, the row's
      `chart traced` marker disappears, and the `chart on screen` chip's count drops
      by one. **All three change together** → AC-105
- [ ] Open a scene carrying `chart_rejection_reason` → the downgrade note reads as a
      decision, and it is still there after a reload → AC-102
- [ ] Open a manual scene → the provenance block states the timecode it was placed at
      and shows the transcript line it sits on, and shows no cited quote, no chart and
      no downgrade note → AC-102

### Add and export

- [ ] Press Add a scene in the bar → the **detail pane** takes it, not a panel under
      the list → AC-109
- [ ] Type a word into the picker's search, then a timecode like `2:35` → both narrow
      the list of lines → AC-109
- [ ] Pick a line, type on screen text, save → the created scene becomes the selection
      and appears in plan order → AC-109
- [ ] With 40 manual scenes on a project, look at the bar → the add action says the
      limit is reached **before it is pressed** → AC-109
- [ ] Press Render all, and while it runs press the open scene's own render button →
      only one encode is in flight at any moment, and the second is refused rather
      than starting a second encoder → AC-117
- [ ] While the batch runs, watch the rows → each shows queued, then a percentage,
      then rendered, and the bar's count agrees with the rows → AC-108
- [ ] Render one scene from the detail pane alone → that clip downloads on its own,
      and that scene's **row** updates exactly as a batch render would → AC-117
- [ ] Reload mid batch → every row reads as not yet rendered rather than claiming a
      status the page cannot know → AC-108
- [ ] Let one scene fail (an oversized frame, or kill the worker) → the batch carries
      on, the failure shows on its own row with a retry, and the zip still contains
      the others in plan order → AC-108
- [ ] Untick every scene, then look at the bar → export is disabled and says what is
      needed → AC-106

### The paths that are not the happy one

- [ ] Open the studio on a project with no plan → a zero state naming what a plan
      costs and offering to run one, not two empty panes → AC-115
- [ ] Start a plan re-run → the list is visibly inert, the run's phase shows in the
      bar, and no row can be toggled → AC-116
- [ ] Type into the on screen text field and press Re-run plan within 600ms → the
      caption is **saved** (reload and check the field), and no PATCH answers 404 in
      the network panel → AC-116
- [ ] Press Re-run plan while a render is in flight → it is refused with a sentence
      saying why → AC-116
- [ ] Open a project whose Ruff Cut edit has moved → the freshness warning reaches you
      **inside the studio**, in the bar, not only on the project page → AC-114
- [ ] Narrow the window under 1100px → the screen collapses to one pane: the list at
      full width, the detail opening over it with a way back, and the bar keeping all
      of its actions → AC-110
- [ ] Turn on `prefers-reduced-motion` at the OS level and reload → hovering and
      focusing the preview plays nothing. It shows its settled still and plays only
      when the play button is pressed → AC-111

### Auth

- [x] Signed out, visit `/dashboard/<id>/scenes` → redirected to sign in → AC-95
      (2026-08-14: `307` to `/sign-in?redirect_url=...%2Fdashboard%2Fxxx%2Fscenes`)
- [ ] Signed in as another user, visit a project id you do not own → **404, never
      403** → AC-95

## Commands

- [x] `npm run lint && npm run typecheck && npm run test` → all green → the repo gates
      (2026-08-14: 8 turbo tasks successful, broll 33 test files)
- [x] `npm run build -w @repo/broll` → compiles, and `/dashboard/[id]/scenes` appears
      in the route table → AC-94 (2026-08-14: present as `ƒ /dashboard/[id]/scenes`)
- [x] `git log --oneline -- packages/db/drizzle | head -1` → the newest migration is
      still `0017`. This feature adds no column and no migration → AC-113
      (2026-08-14: newest file is `0017_red_next_avengers.sql`)
- [ ] `grep -rn "chart\." apps/broll/src/app/api/projects/\[id\]/scenes/` → the PATCH
      schema still names four fields and rejects any body carrying another. Chart
      values and timings are not writable → AC-113

## Value sourcing coverage

One step per row of spec 0006's Value sourcing table, biased at the edge that breaks
if the source is wrong.

- [ ] Row timecode and duration: pick a scene, read its `start_ms` and `duration_ms`
      on the dev branch, and confirm the row matches through `formatClock` → and check
      one scene past the one hour mark if the transcript has one, since the format
      changes shape there
- [ ] Row source line: confirm a manual scene's `source_text` is NULL in the database
      and its row shows the "added by hand" marker rather than an empty line
- [ ] Strength: set one scene's `strength` to `0.70` and another to `0.69` directly on
      the dev branch, reload → the first reads `strong`, the second `fair`. The
      boundary is the thing worth checking, not the middle
- [ ] Strength NULL: confirm a manual scene renders no meter and no word, and in
      particular never `weak` and never a zero
- [ ] Chart traced marker: confirm the row marker, the chart chip and the detail
      citation all flip together when the template changes, since they read one
      predicate
- [ ] The still: confirm a row's still and the detail preview of the same scene show
      the same picture at different sizes, which is what one `toRenderable` and one
      `drawRenderable` guarantees
- [ ] Character cutout: open a project whose character set is not yet generated → the
      character template rows draw their text alone rather than staying blank, and
      they redraw once the set lands
- [x] Render state: confirm the rows never read from `broll_scenes.render_status`
      (`grep -rn "render_status\|renderStatus" apps/broll/src` returns only the schema)
      (2026-08-14: only `packages/db/src/schema.ts` and one explanatory comment in
      `use-render-queue.ts`; no read anywhere)
- [ ] Filter counts: confirm each chip's count equals the number of rows it lists
- [ ] Order: confirm two scenes sharing a `start_ms` stay in a stable order, tied by
      scene id, and that the order matches the server's
- [ ] Re-run price: confirm the bar's price matches `BROLL_PLAN_RERUN_MICROS`,
      including with the env override set, since the value is formatted server side
- [ ] Edits at risk: edit exactly two planner scenes, then open the re-run confirm →
      it says two, counted from `user_edited_at`. Then exclude a third **without**
      editing anything else → the count stays two, because `included` is not a proxy
      for an edit
- [x] Manual cap: confirm the bar's cap message uses
      `MAX_MANUAL_SCENES_PER_PROJECT`, not a literal (2026-08-14: defined as `40` in
      `scene-limits.ts`, interpolated into the message in the scenes POST route and
      read by the insert's own subquery; no literal anywhere)
- [ ] Freshness: confirm the studio's marker and the project page's warning come from
      the same `checkTranscriptFreshness` result and never disagree
- [ ] Detail preview aspect: open a project whose output is not 16:9 → the preview and
      every still take the project's own `output_width` / `output_height` ratio
- [ ] Template options: confirm a scene with no chart is never offered `chart-full`,
      and that the PATCH route refuses it if forced
- [ ] Manual provenance: confirm the transcript line shown under a manual scene is the
      last line at or before its `start_ms`, including for a scene placed on the very
      first line
- [ ] Selection fallback: open a scene, re-run the plan → the stale id falls back to
      the first scene **in plan order across the whole project**, not the first in the
      active filter, and the URL is rewritten
- [ ] Add picker: confirm the index sent to the POST route is the position in the
      **stored document**, by checking the created scene's `start_ms` equals that
      segment's own start rather than anything computed for display
- [ ] Studio card: confirm the project page card's two numbers match the studio's bar

## Acceptance-criteria coverage

- AC-94 · covered by the project page card, the route, and the build's route table
- AC-95 · covered by the two auth steps
- AC-96 · covered by the scroll step
- AC-97 · covered by the ten row read and the full text in the detail pane
- AC-98 · covered by the planner versus manual step and the 0.70/0.69 boundary step
- AC-99 · covered by the four marker step and the excluded legibility step
- AC-100 · covered by the still step, the placeholder step and the cutout step
- AC-101 · covered by the performance recording and the preview step
- AC-102 · covered by the four provenance steps and the pane order step
- AC-103 · covered by the URL copy, the filter independence and the fallback steps
- AC-104 · covered by the two toggles agreeing step
- AC-105 · covered by the chip steps, the empty filter step and the shared predicate step
- AC-106 · covered by the export gate step and the bar being reachable at any scroll
- AC-107 · covered by the six keyboard steps
- AC-108 · covered by the batch progress, the reload and the failure steps
- AC-109 · covered by the four add scene steps
- AC-110 · covered by the narrow window step
- AC-111 · covered by the reduced motion step
- AC-112 · covered by the parsed segments step
- AC-113 · covered by the two command steps and the absent controls step
- AC-114 · covered by the freshness steps
- AC-115 · covered by the zero state step
- AC-116 · covered by the locked list, the debounced caption and the refused re-run steps
- AC-117 · covered by the two encoders step and the single scene render step
