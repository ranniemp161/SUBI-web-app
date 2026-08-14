# 0006. Scene Studio layout: the list and detail review screen

**Date**: 2026-08-13
**Status**: In Progress

## Summary

Scene Studio holds every control a creator needs and none of the composition, so
reviewing twenty scenes means scrolling through twenty stacked forms. This spec
turns it into its own full width screen with two panes: a scannable list of scenes
on the left, and the selected scene's moving preview, controls and proof of where
its numbers came from on the right. Nothing about which fields a creator may change
moves; spec `0005` settled that and this spec touches none of it. There is no
schema change and no new API route, so the whole feature is composition over data
and endpoints that already exist.

## Requirements

**User stories**:

- As a creator, I want to run down a list of proposed scenes and judge each in about
  two seconds, so that reviewing a plan costs less than the edit I came here to
  finish.
- As a creator, I want to open one scene and watch it move at its real length while
  I change how it looks, so that I judge the clip rather than a description of it.
- As a creator, I want the proof behind a chart's numbers where I am already
  looking at that chart, so that I can put my name on the clip.
- As a creator, I want to work the list from the keyboard, so that a twenty scene
  pass is not twenty round trips to the mouse.
- As a creator, I want export reachable from any scroll position, so that finishing
  is never a hunt.

**Acceptance criteria**:

- **AC-94**: Scene Studio is its own route at `/dashboard/[id]/scenes`. The project
  page keeps the header facts, the freshness warning and the character panel, and
  gains a card that states the plan's state (how many scenes, how many included) and
  opens the studio.
- **AC-95**: The studio route is auth gated and owner scoped exactly as the project
  page is. A project id the signed in user does not own answers 404, never 403.
- **AC-96**: The screen fills the window up to a maximum content width. The page
  body itself never scrolls; the list pane and the detail pane scroll independently
  under a bar that stays put.
- **AC-97**: A resting row shows the timecode, the duration, and the source line
  wrapped over up to three lines. A row never shows a single truncated fragment of
  the source line, and the full text is always present in the detail pane.
- **AC-98**: A planner scene's `strength` is shown as a short meter plus a word
  (strong, fair, weak). A manual scene shows no meter and no word, never a zero. The
  thresholds live in exactly one module that both the meter and any test read.
- **AC-99**: Excluded, downgraded to text, added by hand, and chart traced each read
  as a labelled marker in the row. None of the four is carried by colour or opacity
  alone, and an excluded row stays as legible as an included one rather than being
  dimmed.
- **AC-100**: Every row whose template has a renderer carries a small still of the
  scene, drawn at the settled frame through `drawRenderable` and the same
  `toRenderable` mapping the encoder uses. A still draws **one frame per change of
  its inputs** (the scene, or the character cutout arriving) and never on a timer or
  an animation frame. A template with no renderer shows a labelled placeholder, never
  a blank box.
- **AC-101**: No canvas in the list ever runs a frame loop. The detail pane's preview
  is the only animating canvas on the screen, which makes spec `0005` AC-88's "at most
  one preview animates" true by construction rather than by a module level handshake.
- **AC-102**: The detail pane reads preview, then controls, then provenance: the
  large preview at the top, the four controls from spec `0005` under it, and below
  those the full source line, the cited quote with the charted figures highlighted,
  and any downgrade note. A manual scene has none of those three, so its provenance
  block instead states the timecode it was placed at and shows the transcript line it
  sits on, read from the stored document.
- **AC-103**: The selected scene is carried in the URL as a search parameter.
  Selection is independent of the filter: filtering never changes which scene is
  selected, and a selected scene hidden by the active chip stays open in the detail
  pane. On load, and whenever the current id names a scene that is absent (deleted, or
  replaced by a re-run), the selection falls back to the first scene in plan order
  across the whole project and rewrites the URL. An empty pane happens only when the
  project has no scenes at all.
- **AC-104**: Include or exclude is available both in the row and in the detail
  pane. Both write through the same PATCH, and the two never disagree about a
  scene's state.
- **AC-105**: The list offers filter chips (all, included, excluded, chart on screen,
  downgraded to text, added by hand), each showing its count. The chart chip uses the
  same predicate as the row marker and the citation, so it means "this scene will draw
  a chart" rather than "this row has chart data stored". The order of the list is
  always plan order, ascending by `start_ms`, and is never resortable. A filter
  matching nothing says so and offers to clear itself, and does not disturb the
  selection (AC-103).
- **AC-106**: One bar holds the counts and every screen level action: plan or
  re-run with its price, add a scene, render all, download the zip. It is reachable
  at any scroll position. Spec `0005` AC-90 still holds: with nothing included,
  export is disabled and says what is needed.
- **AC-107**: Up and down arrows (and `j` and `k`) move the selection, space toggles
  inclusion on the selected scene, and enter moves focus into the detail pane, landing
  on its first control (the include toggle). No single key binding fires while focus is
  in a text input, a select or a textarea. The list exposes the selection to assistive
  technology, and the focus ring is the ecosystem's `2px` blue at `2px` offset.
- **AC-108**: A scene's render state (queued, rendering with a percentage, done,
  failed with a retry) shows on its own row. One place on the screen owns that state
  for every scene, and both the bar and the rows read it from there. The state is this
  browser session's only: it is not stored, and after a reload every row reads as not
  yet rendered rather than claiming a status the page cannot know.
- **AC-117**: Every render started anywhere on this screen goes through one driver and
  one queue: the batch, and the single scene render in the detail pane. At most one
  encode runs at a time, and starting a render for a scene that is already rendering
  is refused rather than starting a second encoder. A single scene render updates that
  scene's row state exactly as a batch render does.
- **AC-109**: Add a scene starts from the bar and takes over the detail pane. Its
  transcript line picker is searchable by text and by timecode rather than a single
  select of every line. The created scene becomes the selection. At the manual cap
  the action says so before it is pressed.
- **AC-110**: Below roughly 1100px the screen collapses to one pane: the list at
  full width, with the detail opening over it and a way back. The bar keeps all of
  its actions. The genuine mobile refusal is out of scope here and stays with the
  blocking states screen.
- **AC-111**: Under `prefers-reduced-motion` nothing plays on hover or on focus. The
  preview shows its settled still and plays only when a creator presses play.
- **AC-112**: The parsed segments list is gone from the project page. The only place
  transcript lines are listed is the add scene picker.
- **AC-113**: This feature adds no column, no migration and no API route. Every
  value it shows comes from a column that exists, and every write goes through one
  of the three scene endpoints spec `0005` already defined. Chart values and scene
  timings are not writable from any surface on this screen.
- **AC-114**: The transcript freshness warning reaches a creator inside the studio,
  not only on the project page, because scene timecodes are exactly what it warns
  about.
- **AC-115**: A project with no plan yet opens the studio on a zero state that names
  what a plan costs and offers to run one, rather than two empty panes.
- **AC-116**: While a plan run is in flight the list is locked and visibly inert,
  with the run's phase in the bar. Any debounced edit is settled or cancelled before
  the run starts, so no PATCH lands against a scene the run is about to replace. A plan
  run cannot start while a render is in flight; the bar refuses it and says why, rather
  than encoding clips for scenes that are being replaced.

## Decision

**Chosen option**: Option 2: A two pane list and detail screen on its own route.

Scene Studio becomes `/dashboard/[id]/scenes`: a fixed bar, a scannable list of
scenes on the left, and one selected scene's preview, controls and provenance on the
right. The existing controls keep their logic and move into the detail pane; only
the composition is new.

## Rationale

Reasoning, the options weighed, and the layout numbers: see [rationale.md](./rationale.md).

## Feature design

**Screen composition**:

```
┌────────────────────────────────────────────────────────────────┐
│ bar: 12 scenes · 9 included · 3 charts dropped                 │
│      [Re-run plan $0.40] [Add a scene] [Render all] [Zip]      │
├──────────────────────────┬─────────────────────────────────────┤
│ [all][included][excluded]│  ┌───────────────────────────────┐  │
│ [chart][text][by hand]   │  │  preview, plays on hover      │  │
│ ┌──────────────────────┐ │  │  at the scene's real length   │  │
│ │▣ 2:35 · 6.0s  ▮▮▮▯   │ │  └───────────────────────────────┘  │
│ │ [▪] "Nigeria imports │ │  include · template · emotion ·     │
│ │ about 80% of its     │ │  on screen text                     │
│ │ refined fuel"        │ │                                     │
│ │ chart traced         │ │  Source line, in full               │
│ ├──────────────────────┤ │  Read from: "...about 80% of..."    │
│ │▢ 2:48 · 5.0s  ▮▮▯▯   │ │  Shown as text, not a chart: ...    │
│ │ ...                  │ │                                     │
│ └──────────────────────┘ │                                     │
└──────────────────────────┴─────────────────────────────────────┘
```

Three regions, and each has one job. The bar is state and departure. The list is
judgement. The detail pane is the single scene. The load bearing rule is that the page
body never scrolls, so the bar cannot be scrolled away from and the two panes never
fight for one scrollbar.

**Sizes and thresholds** (each a judgement; the basis for each is in the rationale):

| Value | Setting |
|---|---|
| Content maximum width | 1600px, centred, with 24px gutters |
| List pane | 40 percent of the content width, minimum 360px, maximum 560px |
| Detail pane | The remainder, minimum 520px |
| Bar height | 56px, fixed, always visible |
| Row source line | Clamped to 3 lines; the full text lives in the detail pane |
| Row still | 96px wide, at the project's output aspect ratio |
| Detail preview | Fills the pane up to 640px wide, at the same aspect ratio |
| One pane breakpoint | 1100px |
| Strength words | `strong` at 0.7 and above, `fair` at 0.4 and above, `weak` below. One home, `scene-strength.ts` |
| Save debounce | 600ms, unchanged from `scene-overrides.tsx` |

Surface treatment comes from what exists: `broll-glass` for the panes and rows,
`broll-glow` for the one focal element (the detail preview), `broll-tabular` on every
timecode and number, and the `--broll-*` tokens for every colour. No new token, no new
hue, and no light mode.

**Data model sketch**:

No change. No new table, no new column, no migration (AC-113). Every value this
screen shows already exists on `broll_scenes` (`start_ms`, `duration_ms`,
`source_text`, `strength`, `included`, `origin`, `layout_template`, `emotion`,
`overlay_text`, `chart`, `chart_rejection_reason`, `user_edited_at`) or on
`broll_assets` (the committed emotions), and both were settled in specs `0002` and
`0005`.

Three pieces of state are new and all three are the browser's: the selected scene
id (in the URL), the active filter chip (in the studio shell), and the render queue
(also in the shell, see below).

**Where the render queue lives.** Today every piece of render state (which scene is
encoding, its progress, the finished clips held for the zip, the cancel flag) is
private to `batch-export.tsx`, because that one component both started a render and
displayed it. This spec separates those two: the bar starts, the rows display. So the
state moves up into a `use-render-queue` hook owned by the studio shell, and the bar
and the rows both read from it (AC-108). Nothing about the queue's behaviour changes:
scenes still render one at a time, a failure still does not stop the batch, finished
clips are still held between runs, and the zip is still built in plan order.

**State transitions**:

The scene lifecycle is unchanged from spec `0005`. The screen adds one small
machine of its own, over the selection:

- `no scenes` to `first scene selected`, when a plan lands.
- `selected` to `another selected`, by click, by arrow key, or by creating a manual
  scene (the new one wins).
- `selected` to `fallback selected`, when the current id disappears under a re-run or
  a delete. The fallback is the first scene in plan order **across the whole
  project**, never the filtered subset, and it rewrites the URL rather than leaving a
  dangling parameter (AC-103). _Corrected 2026-08-14: this line originally said "the
  first scene in the current filter", which contradicts AC-103, the value sourcing
  table and the invariant that selection is independent of the filter. Three
  statements said whole project and one said filter, so the one was the typo. The
  build follows AC-103._
- `selected` to `add form`, and back to `the created scene`, or back to the previous
  selection on cancel.
- Any state to `locked`, while a plan run is in flight, and back when it settles
  (AC-116). A plan run cannot begin while the render queue is busy.

The render queue is its own small machine, one per scene: `not rendered` to `queued`
to `rendering` to `done` or `failed`, with `failed` returning to `queued` on a retry.
Only one scene is ever in `rendering` (AC-117). The whole map resets on reload and on
a plan re-run.

**API surface**:

No new endpoint, and no change to an existing one. For completeness, the three this
screen calls, all defined in spec `0005`:

| Endpoint | Method | Used by |
|---|---|---|
| `/api/projects/[id]/scenes/[sceneId]` | PATCH | The include toggle in the row and in the detail pane, and the three presentation controls |
| `/api/projects/[id]/scenes` | POST | Add a scene, from the detail pane |
| `/api/projects/[id]/scenes/[sceneId]` | DELETE | Delete, on a manual scene only |

The studio route itself is a server component that reads the same three queries the
project page reads today (`getBrollProject`, `listBrollScenes`, `listCharacterAssets`)
under the same authorization (AC-95).

**Value sourcing**:

| Action | Value produced / displayed | Source |
|---|---|---|
| Row | timecode, duration | `start_ms`, `duration_ms`, formatted by the existing `formatClock` |
| Row | the source line | `source_text`. NULL exactly on a manual scene, which shows the "added by hand" marker in its place rather than an empty line |
| Row | strength meter and word | `strength`, mapped through a new pure module `scene-strength.ts`, the single home for the thresholds. NULL renders nothing at all (spec `0005` AC-84) |
| Row | excluded marker | `included` |
| Row | downgraded marker | `chart_rejection_reason` is not NULL |
| Row | added by hand marker | `origin` |
| Row | chart traced marker | The same predicate the citation uses: `chart` is not NULL **and** the current `layout_template` draws a chart. One helper, so the row marker and the detail citation can never disagree |
| Row | the still | `drawRenderable` at the settled elapsed time, through the shared `toRenderable` mapping the encoder uses. No second mapping and no second renderer |
| Row, detail | the character cutout a still or preview composites | `loadCharacterBitmaps`, called once by the studio shell for the emotions the current plan actually uses, exactly as `plan-panel.tsx` does today. A still whose bitmap has not arrived draws its text alone and redraws when it lands (AC-100) |
| Row, bar | render state | The `use-render-queue` hook in the studio shell, fed by `run-render.ts` progress callbacks. One owner, read by both (AC-108). Never read from `broll_scenes.render_status` |
| List | filter chip counts | Derived client side from the loaded scenes, using the same predicates as the markers above |
| List | the order | `start_ms` ascending, with the scene id as the tiebreak, exactly as the server returns it. Never resorted (AC-105) |
| Bar | included count, dropped chart count | Derived from the loaded scenes, as `plan-panel.tsx` does today |
| Bar | the re-run price | `BROLL_PLAN_RERUN_MICROS` formatted on the server, because the price override is not public. Unchanged |
| Bar | how many edits a re-run would destroy | `user_edited_at` on planner scenes (spec `0005` AC-89). Unchanged |
| Bar | the manual cap | `MAX_MANUAL_SCENES_PER_PROJECT` in `scene-limits.ts` |
| Bar | freshness warning | `checkTranscriptFreshness`, already computed for the project page and passed into the studio route the same way (AC-114) |
| Detail | the preview | Same `toRenderable` plus `drawRenderable`, at the project's `output_width` and `output_height` for the aspect ratio and its exact `fps` rational for the encode |
| Detail | template options | `templateOptionsFor`, shared with the PATCH route, unchanged |
| Detail | emotion options | The committed `broll_assets.emotion` rows for this project, unchanged |
| Detail | cited quote with figures highlighted | `citationParts(source_text, chart)`, unchanged |
| Detail | downgrade note | `chart_rejection_reason` |
| Detail | a manual scene's provenance | `start_ms` for the timecode, and the transcript line it sits on, looked up in the stored document already passed in for the add picker. A manual scene's `source_text`, `chart` and `chart_rejection_reason` are all NULL by spec `0002`'s invariant, so there is nothing else to show (AC-102) |
| Selection | which scene is open | The URL search parameter, falling back to the first scene in plan order across the whole project, never the filtered subset (AC-103) |
| Add scene | transcript lines to pick from | `transcript.segments` with their document index, passed from the server exactly as today, filtered client side by the search box |
| Project page | the studio card's summary | The scene count and included count from `listBrollScenes`, which the page already loads |

**Key invariants**:

- **One renderer, one mapping, three surfaces.** The row still, the detail preview
  and the encoder all draw through `drawRenderable` and the same `toRenderable`. That
  mapping moves out of `plan-panel.tsx` into its own module because a third caller now
  needs it. A second copy is exactly how what a creator judges stops matching what
  lands in the file.
- **Exactly one canvas animates, by construction.** Only the detail pane owns a
  render loop (AC-101). The module level claim and release handshake in
  `scene-preview.tsx` stays as a guard, but it is no longer what makes the rule true.
- **The row marker, the chart filter chip and the detail citation share one
  predicate.** A row that says "chart traced" beside a detail pane that shows no
  citation would be worse than showing neither, and a chip that disagrees with both is
  the same bug wearing a third face.
- **One render driver, one encode at a time** (AC-117). Both render entry points go
  through the same queue, so the app's rule that scenes render in order rather than
  racing is enforced by there being one queue rather than by nobody pressing two
  buttons. This is the one place the recomposition changes behaviour rather than
  moving it: today the detail pane's button owns a `Worker` of its own, and two
  encoders on one laptop is exactly what the batch was built to avoid.
- **Selection is independent of the filter** (AC-103). A chip changes what is listed
  and never what is open, so filtering can never empty the detail pane.
- **Plan order is the only order** (AC-105). A b-roll batch is read against the
  timeline, and the clip at 2:35 is the whole mental model of this product.
- **Nothing on this screen writes a claim.** Chart values and timings are absent
  from every surface here, exactly as in spec `0005`. This is a layout spec and it
  has no authority to widen that set.
- **Selection always resolves.** A dangling scene id is impossible to observe: it
  falls back and rewrites (AC-103).
- **A single key binding never fires while typing** (AC-107). Space toggling
  inclusion while a creator types a caption is a data loss bug wearing a shortcut's
  clothes.
- **State is never carried by colour or opacity alone** (AC-99), which is the
  brief's accessibility rule and the reason today's 55 percent dim on an excluded row
  has to go.

**Security model**:

Unchanged, and deliberately so. The studio route runs the same `auth()`, the same
`getAuthorizedDbUser`, and the same owner scoped queries as the project page, and a
project the signed in user does not own answers 404 (AC-95). No new endpoint means
no new surface to authorize. Every write still proves ownership inside its own
statement (spec `0005` AC-91). No new personal data is displayed: the character
cutouts already reach this page by signed URL and that path is untouched.

**Configuration required**:

None. No environment variable, no secret, no third party call.

**Component inventory**:

| Component | State |
|---|---|
| `src/app/dashboard/[id]/scenes/page.tsx` | **New.** The server component: auth, the three queries, the signed character reads, and the props the studio needs |
| `scene-studio.tsx` | **New.** The client shell: the two panes, selection, filters, the keyboard handling, the character bitmap load, the render queue, and the locked state during a run |
| `use-render-queue.ts` | **New.** The render state every scene shares: the per scene phase, the finished clips held for the zip, the cancel flag, and the one at a time run loop. Lifted out of `batch-export.tsx` because the trigger and the display now live in different components (AC-108, AC-117) |
| `studio-bar.tsx` | **New.** Counts, plan and re-run with its confirm, add a scene, render all, download, and the freshness marker |
| `scene-row.tsx` | **New.** One resting row: timecode, source line, strength meter, markers, still, include toggle, render state |
| `scene-still.tsx` | **New.** The single frame canvas. Draws once, never loops |
| `scene-detail.tsx` | **New.** The right pane, composing the preview, the existing controls, and the provenance block |
| `lib/scene-strength.ts` | **New.** The strength thresholds and their words. Pure, so both the meter and its tests read one source |
| `lib/render/to-renderable.ts` | **New.** `toRenderable`, moved out of `plan-panel.tsx` so the still, the detail preview and the batch share one mapping |
| `scene-overrides.tsx` | **Moves.** Same logic, same debounce, same optimistic save; rendered inside the detail pane and laid out as a column rather than a wrapping row |
| `scene-preview.tsx` | **Changes.** Becomes the detail pane's preview only: larger, and the sole animating canvas. Its canvas discipline (reset before repaint, mount the loop once, read through refs) is unchanged and must stay |
| `scene-citation.tsx` | **Moves.** Into the provenance block, unchanged |
| `add-scene.tsx` | **Changes.** Same POST and the same rules; the 254 option select becomes a searchable picker, and it renders in the detail pane |
| `batch-export.tsx` | **Splits.** Its actions move into the bar, its state moves into `use-render-queue`, and its per scene phases feed the rows. The one at a time loop, the retry set and the zip building are unchanged, only relocated |
| `render-scene-button.tsx` | **Changes.** Moves into the detail pane and stops owning a `Worker`: it enqueues the selected scene into the shared queue instead. Its capability check on mount and its single clip download stay (AC-117) |
| `plan-panel.tsx` | **Retires.** Its stream reader, its price confirm and its counts move into the studio shell and the bar. Nothing about the run itself changes |
| `dashboard/[id]/page.tsx` | **Changes.** Loses the plan panel and the parsed segments list, gains the studio card |

**Critical test scenarios**:

- Happy path: a creator opens a planned project, scans the list, excludes two weak
  scenes from the rows without opening anything, opens one, changes its template and
  its caption, watches the preview, and exports a zip from the bar. Verifies
  **AC-94**, **AC-97**, **AC-104**, **AC-106**.
- Scan quality: a twenty scene plan shows every row's timecode, source line, strength
  and markers with no truncated fragment, and the whole list is reachable without the
  page body scrolling. Verifies **AC-96**, **AC-97**, **AC-99**.
- Rendering: with twenty rows on screen, only the detail canvas has a running frame
  loop; every row still is drawn once. Verifies **AC-100**, **AC-101**.
- Selection: a scene is opened, the URL is copied, the page is reloaded from that
  URL, and the same scene is open. Then the plan is re-run and the stale id falls
  back to the first scene with the URL rewritten. Verifies **AC-103**.
- Keyboard: arrows move the selection and space toggles inclusion; with the caret in
  the on screen text field, space types a space and changes nothing about inclusion.
  Verifies **AC-107**.
- Failure case: a plan re-run is started while a caption edit is debounced. The edit
  settles or is dropped before the run begins, and no PATCH answers 404 afterwards. A
  re-run attempted while a render is in flight is refused with a reason. Verifies
  **AC-116**.
- Render ownership: "Render all" is running when the open scene's own render is
  pressed. Only one encode is in flight at any moment, the row and the bar agree about
  every scene's phase, and a single scene render started from the detail pane updates
  that scene's row. Verifies **AC-108**, **AC-117**.
- Empty and edge states: a project with no plan, a filter matching nothing while a
  scene stays open in the detail pane, a manual scene's provenance block, a project
  with no character set, and a window narrowed under the breakpoint. Verifies
  **AC-102**, **AC-105**, **AC-110**, **AC-115**.
- Accessibility: reduced motion stops every automatic play; no state is announced by
  colour alone; the selected row is exposed as selected. Verifies **AC-99**,
  **AC-107**, **AC-111**.
- Auth: another user's project id answers 404 on the studio route, the same as on the
  project page. Verifies **AC-95**.

## Build plan

Journey, one complete user path per phase, which is this feature's own approach from
its scope row rather than the project default. Each phase leaves the screen usable
end to end for one thing a creator actually does, so the redesign can be judged in the
real app at every step instead of only at the end.

**All six landed 2026-08-14.** Lint, typecheck and the full repo suite are green, and
`next build` compiles `/dashboard/[id]/scenes` as a route. None of it has been watched
running: that is `/check verify`'s box, and on this feature it is the only one that
can answer the question the redesign exists for.

1. **Arrive and scan.** ✅ The route, the server component, the two pane shell with the
   bar, the row (timecode, source line, strength meter, markers, still, include
   toggle), the filter chips, the project page card, and the parsed segments list
   retired. Satisfies **AC-94**, **AC-95**, **AC-96**, **AC-97**, **AC-98**,
   **AC-99**, **AC-100**, **AC-105**, **AC-112**, **AC-113**.
2. **Open one and change it.** ✅ Selection with its URL parameter, its fallback and its
   independence from the filter, the detail pane in its order, the existing controls
   moved in, inclusion mirrored, the preview as the only animating canvas, and the
   keyboard loop. Satisfies **AC-101**, **AC-103**, **AC-104**, **AC-107**.
3. **Check where the numbers came from.** ✅ The provenance block: the full source line,
   the cited quote with its highlighted figures, the downgrade note, the manual scene
   case, and the row marker and chart chip that share their predicate. Satisfies
   **AC-102**, and completes the chart traced marker from **AC-99** and the chip from
   **AC-105**.
4. **Add what the planner missed.** ✅ Add a scene from the bar into the detail pane,
   with the searchable line picker, the cap message, and the new scene selected on
   save. Satisfies **AC-109**.
5. **Render and leave.** ✅ The render queue lifted into the shell, batch actions in the
   bar, per row render state, the detail pane's single scene render going through that
   same queue, the export gate, and the zip. Satisfies **AC-106**, **AC-108**,
   **AC-117**.
6. **The paths that are not the happy one.** ✅ The zero state, the re-run warning and
   the locked list, the freshness marker, the empty filter, the narrow window, and
   reduced motion. Satisfies **AC-110**, **AC-111**, **AC-114**, **AC-115**,
   **AC-116**.

**Three things the build settled that the spec left to it.**

The selection fallback is **derived during render, not corrected by an effect**. The
spec describes it as a transition (`selected` to `fallback selected`), and written
that way it is a `setState` inside an effect: one wasted render, one frame of an empty
pane every time a re-run replaces the ids, and an ESLint rule in this repo that
refuses it outright. Resolving it in the render body makes a dangling scene id
impossible to observe rather than corrected after the fact, which is what AC-103
actually asks for.

The **caption debounce is settled through a ref the shell holds**, not cancelled.
AC-116 allows either. Settling is the better half of the choice: the PATCH goes out
while the scene it belongs to still exists, so the creator's last keystroke is saved
rather than discarded to protect the run.

`sceneDrawsChart` lives in **`scene-templates.ts`**, not in a module of its own. It is
the same question that file already answers for every other template gate, and the
row marker, the chart chip and the detail citation all import it, which is the
invariant the spec asked for.

## Consequences

**Positive**:

- The screen finally answers the question the brief asked and nobody had answered.
  Judging a scene stops requiring the creator to read a form.
- The one animating preview rule stops being a rule. Only one component owns a frame
  loop, so twenty rows cost twenty single draws rather than twenty loops held back by
  a shared variable.
- Export and the counts are always on screen, which is half of the feature's own
  definition of done.
- Every piece of logic that was tested stays tested. This is a recomposition, not a
  rewrite: the PATCH debounce, the zip writer, the render driver, the citation
  splitter and the template gating are all moved rather than replaced.
- Two encoders on one scene stops being possible. The single scene button owning its
  own worker beside a batch that owns another was a real hazard on a laptop, and it
  disappears because there is now one queue rather than because anyone is careful.
- Retiring the parsed segments list removes 254 rows of nothing from the project page
  and the duplicate listing of the same lines.

**Negative / tradeoffs**:

- More components than exist today, and a client shell that owns selection, filters,
  keyboard and the locked state at once. That is real complexity in one file, and it
  is where a future bug will live.
- Two independently scrolling panes with a fixed bar is a layout that is easy to get
  subtly wrong (a pane that grows the page, a bar that overlaps a focus ring). It
  needs to be checked at more than one window size, by hand.
- The row still is a canvas per row. Cheap because it draws once, and still twenty
  canvas elements on a page that had none.
- Render state living only in the browser means a reload loses which clips are ready.
  Honest, and mildly annoying on a long batch. The unused `render_status` column
  remains unused.
- A second route means a second place that loads a project and must keep its
  authorization identical to the first.
- The render queue moving up into the shell is the one behaviour change hiding in a
  recomposition. Lifting state out of the component that owned it is where a subtle
  regression lives (a stale progress map, a cancel flag that no longer reaches the
  loop), and it deserves more care in review than the layout does.
- The keyboard bindings are a small vocabulary nobody has been taught. They need
  discovery somewhere, and this spec does not settle where.

**Neutral**:

- `plan-panel.tsx` disappears as a file while all of its behaviour survives, so the
  diff will look larger than the change is.
- The chart citation stays inline in the sense that it needs no new step, but it moves
  out of the scan. B5's separate confirmation screen is now explicitly not being
  built, and that is a product call recorded here rather than an omission.

## Follow-up

- [ ] `apps/broll/AGENTS.md` describes `src/lib/render/run-render.ts` as "the one
      driver for a render worker, shared by the single scene button and the batch".
      That is not true today: `render-scene-button.tsx` constructs its own `Worker`
      and never calls the driver. AC-117 makes the sentence true, so the line needs no
      change once this ships, but it is currently wrong and was wrong before this
      spec. Worth a correction now if this feature slips.
- [ ] The strength thresholds in `scene-strength.ts` are untuned, exactly like
      `SCENES_PER_MINUTE`. Spec `0003` AC-28's selectivity tuning should revisit all
      three together rather than tuning the number without the words that describe it.
- [ ] Nothing teaches the keyboard bindings. A discovery affordance (a hint in the
      bar, or a shortcuts panel) is worth deciding once the screen has been driven.
- [ ] `broll_scenes.render_status` is still written by nothing and read by nothing.
      Either persist render state against it or drop the column; leaving it is a third
      state that looks authoritative and is not.
- [ ] Spec `0005`'s follow-up about `character-plus-chart` and `split-compare` having
      no renderer now also shapes this screen: those two templates make a row show a
      labelled placeholder instead of a still (AC-100). Deciding whether they ship
      would remove that case.
- [ ] The mobile refusal (the blocking states screen) is still unbuilt and unspecced.
      AC-110 stops at a narrow desktop window on purpose.
