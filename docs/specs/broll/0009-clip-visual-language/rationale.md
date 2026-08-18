# Rationale, spec 0009

Why the clip looks the way it now will, the options weighed, and the one thing
this spec cannot promise.

## Context

> ⚠️ Premise note: this spec ratifies an aesthetic, and almost nothing in it can
> be proved by a test. Every acceptance criterion in `index.md` is a structural
> proxy: that a baseline rule is drawn, that stagger offsets increase, that the
> push scales with duration. None of them says the clip looks produced, because
> no unit test can. Phase 0 deferred exactly this judgement, spike 05, "final
> aesthetic judgment deferred to a real timeline", and the deferral is still
> partly real: the only honest gate is a person watching a rendered batch at full
> size. Treat the suite as protection against regression, and `/check verify`
> against `verify.md` as the actual decision. A green suite here does not mean
> the design worked.

The output is the product. A creator uses this app to get MP4 files they drop
into an edit and publish under their own name, and until now nobody has decided
what those files look like. The palette work of 2026-08-17 fixed the most
obvious symptom, three templates had each invented their own navy and periwinkle,
and the typography work that followed put the brand faces into the exported file
for the first time. Both were corrections of things that were wrong. Neither was
a design.

What remains is that every visual constant in the renderer is a value someone
picked to get a frame drawing, and both template files say so in their own
comments: "the visual design here is deliberately plain and is not specified
anywhere", and "the visual design is a plain default and is not ratified". The
brief, `design-prompt.md`, gives one line of composition per template and nothing
about marks, motion, or depth. So there are nine templates whose look nobody
approved, and no written basis on which to approve or reject a change to any of
them.

Four forces shape what can be done about it.

**The renderer is a canvas drawn by hand, and stays that way.** Drawing is a pure
function of the scene, the elapsed time and the frame size, which is what lets
the page preview and the encoder share one code path. That sharing is the
invariant the whole render layer exists to protect: what a creator judges on
screen has to be what lands in the file.

**Rendering happens on the creator's laptop, and costs them time directly.**
Phase 0 measured 1791ms to encode 6 seconds at 1080p30. A twelve scene batch is
about twenty one seconds today. Anything added per frame comes out of that.

**H.264 destroys exactly the kind of detail that reads as polish.** Fine low
contrast texture, gradients across large flat areas, hairlines. The backdrop grid
is already drawn as 2 pixel rectangles rather than 1 pixel strokes for this
reason, and it is why several obvious choices here are refused.

**The palette is closed.** Key Yellow, Interactive Blue, their shades and
neutrals, with a test asserting no template theme contains anything else.

## Options considered

### Option 1: Refine the existing templates in place

Keep the composition, the palette and the canvas renderer, and finish the visual
language: shared motion, designed chart marks, text set with real metrics, cheap
depth, and a portrait frame that respects platform chrome.

**Pros**

- Every change is local to a template or a shared helper, so each can land and be
  judged on its own.
- Clips already exported stay recognisably related to new ones.
- Fits the cost ceiling without much thought, because none of it is expensive.
- The two unbuilt templates inherit the motion and depth for free.

**Cons**

- Refinement cannot fix a composition that is wrong, and it does not ask whether
  "a picture and some words on a grid" is a rich enough vocabulary for nine
  templates.
- Spreads across six slices for no new capability, competing with features.

### Option 2: Rebuild the renderer around a small scene graph

Introduce a declarative layer, elements with positions, styles and animations,
and have templates describe a frame rather than draw one. The visual language
would then be data instead of imperative code.

**Pros**

- Restyling becomes editing data, and a future template is composition rather
  than drawing code.
- Motion could be described per element rather than hand written per template.
- Makes the two unbuilt templates substantially cheaper.

**Cons**

- It is a rewrite of a layer that currently works, to change how it looks.
- The purity invariant would have to be re established through the new layer, and
  that invariant is the thing protecting preview and export from diverging.
- Adds per frame interpretation cost against a measured budget.
- Answers none of the actual design questions. A scene graph does not know
  whether a line should be smoothed.

### Option 3: Adopt Remotion

Replace hand drawn canvas with React components rendered to video.

**Pros**

- A real ecosystem, real primitives, and a large body of existing motion work.
- The design questions would be answered in a medium designed for them.

**Cons**

- It means server side rendering, and client side WebCodecs is the entire reason
  export costs the user nothing. This alone rules it out.
- Introduces a render queue, infrastructure, and a cost per export where there is
  none today.
- `apps/broll/AGENTS.md` records the client side choice as settled, and the
  mediabunny skill evaluation already declined the Remotion adjacent options.

### Option 4: Reconceive the frame from scratch

Treat the current look as a placeholder that served its purpose, and design the
clip properly from the brief with the palette as the only fixed constraint.

**Pros**

- Highest ceiling. Refinement can only reach a well executed version of the
  current idea.
- The one option that could ask whether the grid belongs at all.

**Cons**

- Every clip a creator has already exported becomes obviously old.
- Much larger surface, and no way to land it incrementally, so it is judged only
  at the end.
- Needs a design source that does not exist. Nobody has drawn these frames.

## Rationale

Option 1, because the constraints that matter are all satisfied by it and the
alternatives each fail on one of them.

Option 3 is eliminated by a force in Context rather than by taste: rendering is
client side precisely so export is free, and Remotion means it is not. Option 2
would rewrite a working layer that carries the preview and export invariant, and
would still leave every question in this spec unanswered, because a scene graph
is a way to express a design and not a design. Option 4 is the one with the real
argument for it, and it lost on the design source: the engineer's answer to how
the design should be obtained was "no design yet, propose a direction", which is
a reasonable basis for refining something that exists and a poor one for
reconceiving it. Reconception needs someone to have drawn the frames.

The engineer chose "refine what is there" over both larger options with the
tradeoff stated. That is the same conclusion this analysis reaches, so there is
no preference to argue against here.

Several individual calls inside Option 1 were made against the more obvious
choice, and those are the ones worth recording:

**Flat fills over gradients on bars.** The conventional polish move is a vertical
gradient. On the largest flat area in the frame, in an 8 bit H.264 encode, that
is the most likely thing to band, and banding reads as a fault rather than a
choice. Depth comes from the grid fade and the figure glow instead, both of which
sit on dark ground where banding is far less visible.

**No value gridlines.** This is structural rather than aesthetic. The 40px
backdrop grid is decorative and does not align to any value, so value lines drawn
over it would suggest the backdrop meant something. Only one grid in a frame is
readable, and the backdrop grid is the one carrying the ecosystem's identity.

**No exit.** This reverses a position taken earlier in the same conversation,
where "no exit at all" was described as a gap. The product context makes it a
correct default rather than an omission: these clips are raw material for an edit,
the editor applies their own transition, and a baked fade cannot be removed.

**The donut hole shows the largest traced value, never a total.** Summing traced
values produces a figure the speaker never said. Putting an invented number in
the largest type on the frame is the exact failure the honesty check exists to
prevent, arrived at from a direction the honesty check does not watch, because
the sum would be computed at draw time rather than proposed by the model.

**Emphasis is creator marked, never automatic.** The attractive version is
highlighting figures automatically. On screen text is freely editable and never
passes the honesty check, so that rule would find a number the creator typed,
which may be one nobody said, and make it the loudest thing in the frame. The
creator marking it themselves asserts nothing.

**Greedy wrapping with orphan control, not balanced lines.** Balanced lines are
typographically better and were refused for a mechanical reason: the shrink to
fit loop keys off the line count, so balancing would couple type size to line
breaking, and both would move as the creator types.

**Safe areas constrain text and marks, never figures.** This one was found by the
cross check rather than decided in the interview, and it is a judgement. The
portrait character band deliberately stands a cutout on the frame edge so
characters share a floor line between scenes; a margin applied to everything
would either shrink every figure by a fifth or crop it. The asymmetry is
justified by what occlusion costs: a caption bar over a character's shins is
cosmetic and the shot still reads, while a caption bar over a word destroys the
thing the frame existed to say. It also decides the mechanism, since a central
clip in `drawRenderable` cannot tell a word from a figure, so the reserve is a
box inset in `layout.ts` and is deliberately not centralised the way the push is.

## What the cross check changed

An independent read found seven gaps, four of them blocking, and all seven were
applied. Recorded because the pattern is worth knowing rather than the list:

Four were the same failure, and it is a failure of introspection rather than of
reasoning. The design questions were answered well and the **mechanical
consequences of those answers went unexamined**: that setting a unit smaller
requires a formatter that returns the unit separately, that a donut is new
geometry rather than a restyle of a pie, that emphasis inside wrapped text needs
run aware measurement, and that a safe margin has to say what it applies to. Each
was invisible from inside the decision and obvious from outside it.

Two were an internal double standard, caught by comparing the spec against
itself: every motion value was given a number while every depth value was left as
"a constant", in a spec whose stated purpose is ending exactly that.

The seventh was a scope boundary, not an error: the object templates arriving in
spec `0008` were never named, so it was unclear whether they were covered.

The general lesson for a spec like this: the decision that feels settled is not
the decision that is dangerous. What is dangerous is the second order consequence
of a settled decision, in a part of the code the decision did not seem to touch.
