# 0009. The clip's visual language

**Date**: 2026-08-18
**Status**: In Progress

## Summary

The thing a creator publishes, the MP4, has never been designed. Every visual
constant in the renderer is a placeholder that shipped, and both template files
say so in their own comments. This spec settles what a clip looks like: how
things move, how a chart draws its marks, how text is set, how the frame gains
depth, and how a vertical clip keeps clear of the chrome that social apps put
over it. The look stays recognisably what ships today (black ground, the 40px
grid, Key Yellow) and is finished properly rather than replaced.

## Requirements

**User stories**

- As a creator, I want a clip to look produced rather than generated, so I can
  cut it into my video without it standing out as the cheap part.
- As a creator, I want a chart to read in the two seconds a cutaway gets, so the
  number lands before the shot is gone.
- As a creator, I want a clip to end where I choose to cut it, so I can edit it
  like any other piece of footage.
- As a creator publishing vertically, I want my words to stay clear of the like
  button, so I do not find out on the platform.
- As a creator, I want to point at the word that matters, without the app
  deciding for me what my point is.

**Acceptance criteria**

Motion

- **AC-173**: One module owns every easing curve, duration and delay the
  renderer uses. No template file defines an easing function of its own.
- **AC-174**: Arrivals ease out. A figure (a character cutout or a generated
  illustration) overshoots slightly and settles; chart marks and text do not
  overshoot.
- **AC-175**: No clip carries a baked exit. The last frame is the settled
  composition, held.
- **AC-176**: A slow push in is applied once, centrally, wrapping every
  template. No template opts in or out.
- **AC-177**: The push is normalised to the clip's length, so clips of any
  duration finish at the same scale.
- **AC-178**: `drawRenderable` receives the clip's duration. The row still, the
  detail preview and the encoder all pass it.
- **AC-179**: An exported file animates regardless of the machine's reduced
  motion setting. The on page preview continues to honour it.
- **AC-180**: Bars arrive one after another, in the order the speaker said
  them, never reordered by size.

Chart

- **AC-181**: A baseline rule is drawn beneath bar and line marks. No value
  gridlines are drawn anywhere.
- **AC-182**: Bars are rounded at the top, square where they meet the baseline,
  and filled flat.
- **AC-183**: A round chart draws as a donut with visibly separated slices, and
  the hole carries the largest traced value. It never carries a computed total.
- **AC-184**: A line chart draws straight segments with a dot at each value. No
  area fill, and no smoothing between points.
- **AC-185**: A value of seven digits or more renders compact (`1.2M`), with its
  unit still attached.
- **AC-186**: A chart title wraps to at most two lines and is trimmed with an
  ellipsis beyond that. No title leaves the frame.
- **AC-187**: The single big number counts up, with its unit set smaller and in
  the muted tone. `formatChartValue` returns the number and the unit separately
  as well as joined, so nothing re derives where a unit sits.
- **AC-188**: No clip burns a citation, attribution or timecode into the frame.

Text

- **AC-189**: A word the creator wraps in asterisks inside the on screen text
  renders in Key Yellow. The asterisks themselves never render.
- **AC-190**: Emphasis is only ever creator marked. No code path selects a word
  to emphasise.
- **AC-191**: A text block is centred on real font metrics rather than on the
  font's declared box.
- **AC-192**: Wrapping never leaves a single word alone on the last line when a
  word can be pulled down from the line above **and the pulled line still fits**.
  An orphan is kept rather than causing an overflow.
- **AC-193**: The scrim behind text sitting over a figure is a gradient fading
  from the ground colour, with no visible edge.

Depth

- **AC-194**: The backdrop grid fades out toward the frame edges.
- **AC-195**: A soft radial glow sits behind a figure. No contact shadow is
  drawn, and no per element shadow blur is used anywhere.

The vertical frame

- **AC-196**: In portrait, no **text or chart mark** enters the reserved margins
  along the bottom and the right. Figures are deliberately exempt and may still
  reach the frame edge.
- **AC-197**: Scene Studio draws a faint safe area guide on the preview only. It
  never appears in an exported frame.

Cost

- **AC-198**: Encoding a 6 second clip at 1080p30 stays within roughly twice
  Phase 0's measured 1791ms on comparable hardware.

## Decision

**Chosen option**: Option 1: Refine the existing templates in place.

Keep the canvas renderer, the composition and the ecosystem palette exactly as
they are, and finish the visual language properly: one shared motion module, a
designed chart, text set with real metrics, two cheap depth devices, and a
portrait frame that respects platform chrome.

## Feature design

### Motion vocabulary

One module, `render/motion.ts`, owns every curve and every timing. It replaces
the four copies of the same easing function that exist today.

| Piece | Value | Why this value |
|---|---|---|
| Standard arrival | ease out cubic | Already in use and correct for an arrival. Nothing about it needed changing except that it lived in four places. |
| Figure arrival | ease out with a small overshoot, about 4% | Enough to read as weight settling, small enough that it never looks bouncy. A figure is the only thing in the frame heavy enough to justify it. |
| Stagger between bars | 70ms | Fast enough that five bars are all in within a third of a second, slow enough that the eye tracks the order. |
| Push in, total | 3% scale across the whole clip | Below the threshold where a viewer notices a zoom, above the threshold where a frame reads as frozen. |
| Push in, shape | linear across the clip's duration | A held shot pushes at a constant rate. Easing it would draw attention to the move itself. |
| Exit | none | See below. |

**The push is applied centrally.** `drawRenderable` saves the context,
translates to the frame centre, scales, translates back, calls the template, and
restores. Every template inherits it, including the two that are not built yet,
and none can drift from it.

**Which templates this covers.** All seven that draw: `chart-full`, `text-card`,
`character-left`, `character-center`, and the three object templates
(`object-full`, `object-left`, `character-plus-object`). "Figure" throughout this
spec means a character cutout **or** a generated illustration, so the object
templates take the overshoot, the glow and the safe area exemption on the same
terms as the character ones.

**This spec assumes spec `0008` has merged.** The object templates and
`figure-frame.ts` arrive with it. Building slice 1 before that lands means
consolidating easings that `0008` has already partly consolidated, twice.

**Nothing has an exit.** These clips are dragged into an editing timeline where
the editor applies their own transition. A fade burned into the file cannot be
removed and fights whatever the creator cuts to. The most useful thing the last
frame can be is a settled composition, held.

### Chart marks

**The baseline, and why there are no gridlines.** A single hairline rule sits
under the marks, so bars stand on something and zero is visible. There are
deliberately no horizontal value gridlines, and the reason is structural rather
than aesthetic: the 40px backdrop grid is decorative and does not line up with
any value, so value lines drawn over it would imply the backdrop meant something.
One grid in a frame is the most a viewer can read.

| Shape | Treatment |
|---|---|
| Bars | Rounded at the top, square at the baseline, flat Key Yellow fill. Negative values keep the muted fill. Staggered arrival, 70ms apart, in spoken order. |
| Line | Straight segments, a dot at each measured value, no area fill, no smoothing. Progressive reveal from the left, as now. |
| Donut | Separated slices from the `SERIES` ramp, with the largest traced value set in the hole. |
| Big number | Counts up, unit set smaller and in the muted tone, caption beneath. |

**The numbers, so none of these is invented at build time:**

| Constant | Value | Why |
|---|---|---|
| Bar corner radius | 0.35 of the bar's width, capped at 12px at 1080 | Reads as rounded at any bar count. The cap stops a single wide bar turning into a lozenge. |
| Donut inner radius | 0.58 of the outer radius | Leaves an arc thick enough to carry colour and a hole big enough to set a number in. |
| Donut slice gap | 1.5 degrees | Visible as separation at 1080, small enough not to distort the proportion being shown. |
| Donut hole figure | Sized to the hole, not to the frame | It must fit inside 0.58 of the radius, so it cannot reuse the big number's frame relative ratio. |
| Grid fade start | 0.55 of the half diagonal | The grid is full strength through the middle of the frame and gone by the corners. |
| Figure glow radius | 0.42 of the short edge | Wide enough to separate a figure without reading as a spotlight. |
| Figure glow alpha | 0.10 | Low enough that H.264 does not band it on dark ground. |

**The donut is a rewrite, not a restyle.** `drawPie` today draws wedges from the
centre outward. Inner radius, angular gaps and a figure set in the hole are new
geometry, which is why it is its own build step rather than a line item beside
rounded bar caps.

**The value formatter has to return parts.** `formatChartValue` currently returns
one joined string, so nothing downstream can set the unit differently from the
figure. It changes to return the number and the unit separately as well as
joined. Every label keeps using the joined form; only the big number uses the
parts. One place still decides where a unit sits relative to its number, which is
the property worth protecting.

**Flat fills are a decision, not an omission.** A full height gradient across a
large area of Key Yellow is what an 8 bit H.264 encode bands, and banding reads
as a fault rather than as a choice. The frame gets its depth from the grid fade
and the figure glow instead, both of which sit over dark ground where banding is
far less visible.

**The donut hole cannot show a total.** Summing the traced values produces a
figure the speaker never said, and putting an invented number in the largest
type on the frame is precisely what the honesty check exists to prevent. The hole
carries the largest single traced value instead.

**No smoothing on a line.** A curve drawn through measured points asserts values
between them that nobody measured. Straight segments are the honest reading.

### Text

**Emphasis is creator marked only.** A creator writes `*castle*` in the on
screen text field and that word renders in Key Yellow. The renderer never chooses
a word.

This is the one rule here with an honesty consequence, and it is worth being
explicit about why the obvious alternative is refused. On screen text is freely
editable and never passes the honesty check, so a creator can type a figure that
was never spoken. An automatic rule that highlighted figures would take exactly
that untraced number and make it the loudest thing in the frame. Creator marked
emphasis asserts nothing, because the creator made the choice.

**How emphasis actually draws.** `wrapText` works on plain strings today, so this
needs a run aware path rather than a colour swap. The text is parsed into runs
(plain, emphasised) before wrapping; wrapping then measures across runs while
keeping run boundaries intact; drawing walks the runs on each line, advancing x by
`measureText` of what it has already drawn. Emphasis takes no part in the orphan
decision below, which stays a question about words.

An unmatched asterisk renders as a literal asterisk and emphasises nothing. A
parser that ate the rest of the line on one stray character would be worse than
having no emphasis at all.

**Setting.** Blocks centre on the ink using `actualBoundingBoxAscent` and
`actualBoundingBoxDescent` rather than on the font's declared box, which is why
a line of capitals currently reads low. Wrapping stays greedy, with one addition:
when the last line would hold a single word and the line above can spare one, a
word is pulled down, **but only when the pulled line still fits**. A short orphan
below a line already holding one long word is left alone rather than forced into
an overflow. Full line balancing is refused because it changes line counts, and
the shrink to fit loop keys off the line count, so type size and line breaks
would start moving together as the creator types.

**The scrim** behind text over a figure becomes a gradient fading up from the
ground colour, replacing the hard edged rectangle whose top edge currently draws
a visible line across the creator's body.

### Depth

Two devices, both one gradient per frame, both chosen because they cost almost
nothing at the frame rate:

- **The grid fades toward the frame edges.** On a pure black ground a
  conventional vignette has nothing to darken, so the grid is the only thing that
  can carry one. Fading it focuses the centre and stops the grid reading as
  wallpaper.
- **A soft radial glow behind a figure.** A dark cutout on black currently loses
  its edges. The brief already sanctions a glow as a surface treatment.

No contact shadow, because a character is anchored to the bottom of its box and
an object floats in the middle of its own, so one grounding device cannot serve
both. No per element shadow blur anywhere, because it is the one drawing
operation that would break the cost ceiling.

### The vertical frame

Portrait clips reserve a margin along the bottom and the right, because Reels,
Shorts and TikTok place a caption block and an action rail there. Landscape is
unaffected.

| Margin | Reserved | Basis |
|---|---|---|
| Bottom | 18% of frame height | Covers the caption and handle block across the three platforms with a little room. |
| Right | 11% of frame width | Covers the action rail, which is the densest chrome of the three. |

**The reserve constrains text and chart marks. It does not constrain figures.**
This is the one rule here that is a judgement rather than a measurement, so it is
worth stating why. A caption bar crossing a character's shins is cosmetic, and
the shot still reads. A caption bar crossing a word destroys the thing the frame
was for. Applying one margin to both would either shrink every figure by a fifth
in portrait, or crop it, and `character-left`'s portrait band deliberately stands
the cutout on the frame edge so characters share a floor line across scenes.

That has a mechanical consequence worth being explicit about: **the reserve is a
box inset in `layout.ts`, not a central clip in `drawRenderable`.** It is
deliberately not centralised the way the push is, because a central clip cannot
tell a word from a figure and would crop both. `portraitCharacterBandRatio` keeps
its current 0.58.

Scene Studio draws a faint guide on the preview canvas only, so the margin reads
as considered rather than as a bug. It is drawn by the studio, never by a
template, so it cannot reach an exported frame.

### Value sourcing

| What is drawn | Value it needs | Source |
|---|---|---|
| Push in scale | The clip's duration | **New**: `durationMs` added to the frame object `drawRenderable` receives. Today the encoder knows it, the renderer does not. |
| Bar stagger offset | The bar's index | Its position in `chart.values`, which is already spoken order |
| Donut hole figure | The largest traced value | `Math.max` over `chart.values`, never a sum |
| Emphasis span | Which characters are emphasised | Asterisk markers the creator typed into `overlayText` |
| Compact threshold | When to abbreviate | Constant in the chart theme, seven digits |
| Baseline y | Where the rule sits | Derived from the existing plot box |
| Safe area insets | Bottom and right reserve | Constants in `layout.ts`, applied only when `isPortrait` |
| Grid fade | Radius and falloff | Constants in `theme.ts`, expressed against the short edge like every other ratio |
| Figure glow | Radius, alpha and colour | Constants in `theme.ts`, alpha low enough to survive H.264 |

### Key invariants

- A value never renders without the unit the speaker attached to it. Compact
  notation changes the digits, never the unit.
- Nothing the renderer draws may assert a number that was not traced. This now
  covers the donut hole and any emphasis rule.
- The preview and the exported frame draw through one function with one set of
  inputs. Only the safe area guide differs, and it is drawn by the studio rather
  than by a template.
- Drawing stays a pure function of its inputs and elapsed time.

### Critical test scenarios

Structural tests, using the shared recorder, since none of these can assert that
a frame looks right (see the note in `rationale.md`):

- A template file defines no easing of its own, verifies **AC-173**
- Two clips of different durations reach the same scale at their final frame,
  verifies **AC-177**
- The final frame equals the settled composition, with no alpha ramp, verifies
  **AC-175**
- Bars carry increasing arrival offsets in array order, verifies **AC-180**
- A seven digit value renders compact and keeps its unit, verifies **AC-185**
- A donut's hole shows a value present in `chart.values`, verifies **AC-183**
- A title of 200 characters stays inside the frame, verifies **AC-186**
- Asterisk markers change a run's colour and never render as characters,
  verifies **AC-189**
- No draw call in a portrait frame enters the reserved margins, verifies
  **AC-196**
- No exported frame contains the guide, verifies **AC-197**

## Build plan

Tracer Bullet, so the first slice is a thin thread through every layer that
visibly changes every clip, and the rest thickens it.

1. **The motion thread.** ✅ Done 2026-08-18. Add `render/motion.ts` with the
   easings, the stagger helper and the push. Add `durationMs` to the frame object
   and pass it from the still, the preview and the worker. Apply the push
   centrally in `drawRenderable`. Delete the four easing copies. Satisfies
   **AC-173**, **AC-174**, **AC-176**, **AC-177**, **AC-178**, **AC-179**, and
   **AC-175** by confirming no exit is introduced.

   **Three copies, not four.** Spec `0008`'s `figure-frame` extraction had
   already absorbed one on its way through, which is exactly what this spec
   predicted would happen if slice 1 ran first. `entranceAt` moved to
   `render/motion.ts` and its five callers now import it from there, so
   `figure-frame.ts` is a composition rather than a composition plus a curve.

   `drawRenderable` applies the push in a `try`/`finally`: every case in that
   switch returns and the default throws, so a restore placed after it would be
   skipped and the transform would compound onto the next frame.
2. **Depth, shared by every template.** ✅ Done 2026-08-18. Grid fade in
   `drawBackdrop`, figure glow in `figure-frame.ts`. Satisfies **AC-194**,
   **AC-195**.

   The fade is **one radial gradient per frame**, built once and assigned to
   `fillStyle` before the grid loop, so it costs a single allocation whether the
   frame carries fifty lines or a hundred. Measured against the half diagonal
   rather than an edge, so it lands on the corner in both orientations. The glow
   is a radial gradient too, never `shadowBlur`: a real shadow would trace the
   cutout's alpha edge and read as a sticker outline. Its colour is the brief's
   `--accent-shadow` Key Yellow at 0.10 rather than the brief's 0.25, which is
   the banding margin this spec asked for.
3. **Chart marks, and the formatter split.** Baseline rule, rounded caps, bar
   stagger, line dots, compact notation, title wrap and trim. Change
   `formatChartValue` to return the number and unit separately as well as joined,
   then set the big number's unit smaller and muted. Satisfies **AC-180**,
   **AC-181**, **AC-182**, **AC-184**, **AC-185**, **AC-186**, **AC-187**,
   **AC-188**.
4. **The donut.** Its own step, because it is new geometry rather than a restyle:
   inner radius, angular gaps, and the largest traced value set in the hole.
   Satisfies **AC-183**.
5. **Measure the cost here, not at the end.** Slices 2 to 4 add the most per
   frame work. Time a 6 second 1080p30 encode against Phase 0's 1791ms before
   going further. Satisfies **AC-198**.
6. **Text setting.** Optical centring, orphan control with the overflow guard,
   gradient scrim. Satisfies **AC-191**, **AC-192**, **AC-193**.
7. **Creator marked emphasis.** Run parser, run aware wrapping and drawing, and
   the field hint in Scene Studio. Satisfies **AC-189**, **AC-190**.
8. **The vertical frame.** Safe area insets in `layout.ts` applied to text and
   mark boxes only, and the guide in the studio preview. Satisfies **AC-196**,
   **AC-197**.

Slices 3, 4, 6, 7 and 8 are independent of each other and can land in any order
once slices 1 and 2 are in. Slice 5 is a gate rather than a feature: it is placed
where the cost has just been added and is still cheap to walk back.

## Consequences

**Positive**

- The aesthetic stops being undocumented. Phase 0 spike 05 deferred this
  judgement "to a real timeline" and it has been open ever since.
- One motion module ends four copies of the same function, and gives the two
  unbuilt templates their motion for free.
- Three live bugs are fixed on the way through: a chart title that runs off the
  frame, a seven digit number that overflows, and a scrim edge drawn across the
  creator's body.
- The push applied centrally means a template physically cannot forget it.

**Negative**

- **Clips exported before this will look dated beside clips exported after.**
  There is no re render of old output, so a creator with a half finished project
  gets two visibly different generations of clip in one edit.
- Every template's tests change, because the frame object gains a field and the
  central push shifts every drawn coordinate slightly.
- Creator marked emphasis adds a syntax a creator has to learn, and a parser
  that has to handle unmatched asterisks without eating the text.
- Six slices is a lot of surface for a change that produces no new capability.
  This is polish, and it competes with features.

**Neutral**

- `drawRenderable`'s signature changes. It is called in three places, all in
  this workspace.
- Safe area margins are constants based on three platforms' current layouts,
  which will move. They are in one file for that reason.
- No new dependency. Easings are a few lines of arithmetic, and this repo's
  precedent (a zip writer written by hand rather than pulled in) is the right
  one to follow.
- **No migration plan, unlike spec `0007`.** Nothing here touches stored data or
  needs a coordinated deploy. Every slice is a client side drawing change that a
  single revert undoes, and a clip already exported is a file the creator holds,
  untouched by anything shipped later.

## Follow-up

- [ ] The acceptance criteria here are structural proxies. Whether a clip looks
      produced is checkable only by watching a rendered batch at full size, so
      `/check verify` against `verify.md` is the real gate, not the test suite.
- [ ] The cost measurement is now slice 5, placed deliberately after the slices
      that add per frame work rather than at the end, so a breached ceiling is
      cheap to walk back.
- [ ] Creator marked emphasis (slice 5) is the one item here that adds a user
      facing affordance rather than changing how something draws. It could be
      dropped from this spec and enrolled on its own without weakening the rest.
- [ ] The two undrawn templates, `character-plus-chart` and `split-compare`,
      inherit the motion and depth decided here but have no composition designed.
      That is a build question and belongs in its own spec.
- [ ] This spec depends on spec `0008` having merged, for the object templates
      and `figure-frame.ts`. Check that before starting slice 1.
- [ ] The safe area rule exempts figures, which is a judgement rather than a
      measurement. If a vertical clip turns out to lose a character's face rather
      than their shins on some platform, the exemption is the thing to revisit,
      not the margin.
- [ ] Safe area figures should be re checked against the three platforms before
      slice 6 lands. They come from current layouts and are the only numbers here
      sourced from outside this repo.

## Rationale

Reasoning, the options weighed, and the premise note: see
[rationale.md](rationale.md).
