# Rationale: Scene Studio layout · spec 0006

The reasoning behind [index.md](./index.md). `/develop` does not need this file.

## Context

> ⚠️ Premise note: this screen is being redesigned before it has ever been watched
> working. Feature 6's `/check verify` came back with every screen box unticked, and
> four verifications the scope calls owed (the planner run, the character pipeline,
> the prompt judgement and the selectivity tuning) are still owed. Designing the
> composition from reading the code is sound for layout, and it is not sound for
> anything about how the real data behaves: nobody has yet seen how long a real
> `source_text` runs on a Ruff Cut handoff, what a real strength distribution looks
> like across twenty scenes, or whether a real citation span lands where the
> highlighter expects. The right framing is that this spec settles composition now so
> the screen is driven **once** rather than twice, and that the verify pass over this
> screen must also close spec `0005`'s open boxes rather than only its own. Where a
> number here is a guess (the strength thresholds, the row line clamp), it is written
> down as a guess with one home, so a real transcript can move it in one edit.

Scene Studio is where a creator spends their time, and it is the one screen the UI
brief singled out: "design this one most carefully", followed by the key layout
question it then left open for whoever designed it. Nobody did. Feature 6 answered a
different question, correctly and completely: **which fields may a creator change**.
It shipped every control that question implied and stopped there.

**How the screen actually works today.** `plan-panel.tsx` renders one `<ul>` inside a
900 pixel column, under the project header, the freshness warning and the entire
character panel. Each `<li>` stacks, vertically: the timecode and source line, a
metadata line reading `chart-full · 6.0s · chart: Fuel imports · strength 0.82`, the
citation paragraph when the template draws a chart, the downgrade sentence when a
chart was dropped, a wrapping row of four controls (a checkbox, two selects and a
text input), a 320 pixel canvas, and a render button. On a twelve scene plan that is
roughly twelve screens of scrolling, and the field that identifies a scene, the source
line, is worth about one twentieth of the vertical space it sits in. Under it sits the
parsed segments list: 254 unclickable rows on the reference project, listing the same
transcript lines the add scene picker now lists again.

Nothing there is broken. Every acceptance criterion of spec `0005` is met by it. It is
a form, and the job is a scan.

Four forces shape the answer.

**Two seconds per scene is a measurement, not a mood.** Ten to twenty scenes, judged
in about two seconds each, is what the brief asks for and what the feature's own
definition of done repeats. Two seconds buys a glance at four things: when it is,
what it says, how strong the planner thought it was, and what it will look like. Any
composition that costs a scroll or a click before those four are visible fails the
measure regardless of how good it looks.

**The source line cannot be sacrificed.** It is what makes a scene recognisable, the
"oh, that's the fuel imports bit". Every compact layout is tempted to truncate it to
a single line, and a single line of a twelve second utterance is a fragment that
identifies nothing.

**Canvas cost is real and already understood.** Phase 0's two worst rendering bugs
both came from a live canvas beside editable fields, and spec `0005` AC-88 exists
because twenty looping previews on one page is a hot fan and a slow list. The current
answer is a module level variable that lets one preview animate at a time, which
works and is a rule held in one developer's head rather than a property of the layout.

**Everything already built works.** The PATCH debounce, the optimistic local patch,
the template gating shared with the route, the citation splitter, the zip writer, the
render driver and its retry set are all tested and all correct. A redesign that
rewrites them spends its risk budget on the parts that were never the problem.

The consequence of not deciding is that the screen stays a form, the verify pass runs
against a layout that is about to change, and the two second scan the whole product
rests on is never actually delivered.

## Options considered

### Option 1: Fix in place, one column with anchored controls

Keep the single column and the existing rows, but strip each row to a scan strip
(timecode, source line, strength, markers) and move the four controls behind a small
menu anchored to the row, matching the pattern this repo already prefers over
dialogs. The preview becomes a still that plays on demand.

**Pros**:
- Smallest change by a wide margin: no new route, no new page level state, no
  selection model, no breakpoint work.
- Keeps one scroll and one mental model.
- Directly fixes the worst symptom, which is the vertical cost of the controls.

**Cons**:
- Editing several scenes means opening and closing several menus, and the anchored
  menu pattern suits one shot actions rather than a four control panel with a live
  preview beside it.
- There is nowhere to put a large preview, so judging what a scene looks like still
  competes with the list for the same column.
- Leaves the citation either in the scan or nowhere.
- Does not use the width the app has. A 900 pixel column on a creator's real monitor
  wastes most of the screen.

### Option 2: Two pane list and detail, on its own route (chosen)

A dedicated screen with a fixed bar, a scannable list of rows on the left, and the
selected scene's preview, controls and provenance on the right. The project page keeps
setup, transcript facts and character generation, and links in.

**Pros**:
- The controls stop costing the scan anything at all, which is the only structural fix
  to the two second problem.
- Exactly one canvas can animate because only one component owns a loop. A rule
  becomes a property.
- Gives the citation a home where a creator is already looking at that scene's chart,
  with no new step on the fast path.
- Uses the width, and the brief already names this shape as the one to consider.
- The existing components move rather than being rewritten.

**Cons**:
- The most new surface of the four options: a route, a shell owning selection, filters
  and keyboard, a breakpoint, and a URL parameter with a fallback rule.
- A second place that loads a project and must keep its authorization identical.
- Two independent scroll regions under a fixed bar is a layout with fiddly failure
  modes that only show up at particular window sizes.

### Option 3: Rows that expand in place

Keep one column and one scroll. Clicking a row opens it, showing its preview and
controls inside the row; one row open at a time.

**Pros**:
- No selection model beyond "which row is open", no second pane, no breakpoint.
- Reads as a natural progressive disclosure and is familiar from mail clients.
- Preserves the current component tree almost exactly.

**Cons**:
- Opening a row pushes everything below it, so the creator's place in the list moves
  under them, which is the specific thing a scan cannot survive.
- The open row is still competing for the same column width, so the preview stays
  small or the row becomes very tall.
- Closing and opening repeatedly is the same cost as the menus in option 1.

### Option 4: Card grid with a detail drawer

A grid of preview thumbnails; clicking one slides a detail drawer over the grid.

**Pros**:
- The most visual, and the fastest way to see what the batch looks like as a set.
- Fits many scenes on one screen with no scrolling.

**Cons**:
- A grid cell has room for a fragment of the source line at best, which sacrifices
  exactly the field the brief says must survive.
- A drawer over the grid hides the context a creator is comparing against.
- Twenty preview thumbnails is the canvas cost problem at its worst.

## Rationale

Option 2 is the only one where the controls stop costing the scan anything, and the
scan is the measure the feature is defined by. Options 1 and 3 both keep the controls
and the scan in one column, so they trade a scroll for a click and leave the two
second judgement fighting the same vertical budget; option 4 buys density by spending
the one field that makes a scene identifiable, which the brief rules out in advance.

The canvas argument settles it independently. Spec `0005` AC-88's "at most one preview
animates" is currently enforced by a module level variable that every future component
in that tree has to know about. In a list and detail split there is one detail pane, so
one render loop, and the rule holds because there is nowhere else for a loop to live.
That turns a piece of tribal knowledge into a property of the layout, which is worth
more than the composition itself over the next year.

The chart citation goes in the detail pane rather than becoming B5's separate
confirmation step because the app's own principle is that a creator who clicks plan and
then export all must get usable output. A mandatory gate in front of export contradicts
that, and it would be guarding against a risk the honesty check already removed: a
chart only exists here because every one of its figures was traced back into the cited
span, and an untraceable one is dropped rather than shown for confirmation. The
citation is therefore evidence a creator can check, not a checkpoint they must clear.
The row keeps a small traced marker so the scan still shows which scenes carry numbers.

Its own route rather than a section of the project page follows from the same measure.
A two pane review surface needs the window, and the project page legitimately holds
three other things (transcript facts, the freshness warning, character generation with
its review gate) that a creator returns to for different reasons. Splitting them costs
one navigation and gives both screens a single job.

One consequence only surfaced under cross check, and it is worth stating plainly. Today
one component both starts a render and displays it, so its state could stay private.
Splitting the trigger (the bar) from the display (the rows) forces that state up into a
shared queue, and once there is a shared queue the detail pane's single scene button
has no reason to keep its own `Worker`. It currently does, which means a creator can
already start a batch and a single render at once and have two encoders racing on one
laptop, against this app's own documented rule that scenes render one at a time. The
layout change does not create that hazard; it removes the reason it existed.

The one place this spec deliberately does less than it could: render state stays in the
browser. `broll_scenes.render_status` exists and is unused, and persisting it would
survive a reload, but a stored status can disagree with what the browser actually holds
in memory, and a row claiming a clip is ready when the blob is gone is worse than a row
that admits it does not know. That is recorded as a follow-up rather than settled here,
because it is a data decision wearing a layout costume.

## Where the numbers come from

Every concrete size in `index.md` is a judgement, and these are the ones worth knowing
the basis of.

- **1100 pixel breakpoint.** Chosen so a browser at half the width of a common 2560
  pixel monitor keeps both panes, and a half width 1920 monitor (960 pixels) collapses
  to one. It is a guess about how creators arrange a screen mid edit, and it is one
  constant.
- **Strength words at 0.7 and 0.4.** `strength` is a 0 to 1 score the planner writes
  and nothing has ever displayed, so there is no distribution to fit against. The cut
  points split the range into a strong upper third, a fair middle and a weak remainder,
  which is defensible and untuned. They live in one module for exactly that reason, and
  they are tied to spec `0003` AC-28's tuning in the follow-ups.
- **Three line clamp on the source line.** A Ruff Cut handoff averages one utterance
  per twelve seconds, which is long enough that no clamp shows all of it. Three lines
  is the point where a row still reads as a row and the line still identifies the
  moment; the full text is always in the detail pane, so the clamp never loses
  anything, it only defers it.
- **A 96 pixel still.** Wide enough to tell a chart from a character from a text card
  at a glance, small enough that twenty of them are twenty cheap single draws.
