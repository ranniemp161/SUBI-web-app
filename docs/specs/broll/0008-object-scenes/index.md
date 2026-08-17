# 0008. Object scenes

**Date**: 2026-08-17
**Status**: In Progress

## Summary

A speaker who says "they built a castle on the hill" is asking the viewer to
picture a castle. Today B-Roll has nothing to offer that line: it can draw a
chart (there are no numbers), the creator's face (which is not what the line is
about), or the words themselves — so the most visual moment in the speech gets
the least visual treatment.

This spec adds a fourth thing a scene can be: an **object**. The planner
proposes the concrete noun the speaker named, and a per-scene illustration of it
is generated in the project's character style, background-removed, and
composited by one of three new templates. The subject is traced back to the cited
line exactly as a chart's numbers are, because a castle nobody mentioned is a
picture of a claim nobody made — and it is harder to notice than an invented
number, since nothing about a well-drawn castle looks wrong.

Illustrations are drawn **on demand** rather than at plan time, so a creator only
pays for the ones they keep.

## Requirements

**User stories**

- As a creator, I want a line that names something concrete to get a picture of
  that thing, so my cutaway shows what I was talking about instead of restating
  it as text.
- As a creator, I want the illustration to look like it belongs beside my
  character, so my b-roll reads as one piece of work rather than as stock art
  dropped in.
- As a creator, I want to see what a scene is going to draw, and what it cost,
  before I pay for it.
- As a creator, I want to redraw one I do not like without redoing anything else.
- As a creator, I want "plan, then export all" to still produce a full batch,
  even though illustrations are not drawn until asked for.
- As a reader of the finished video, I want every illustration to be of something
  the speaker actually named.

**Acceptance criteria**

The subject, and the honesty rule

- **AC-150**: The planner may return an `object` on a scene: a short noun phrase
  `subject` plus a `source_span` of character offsets into the cited utterance.
  Null is the common and correct answer.
- **AC-151**: `traceObject` verifies that **every** content word of the subject
  appears inside the cited span, folding case, punctuation, articles and joining
  words, and singular against plural. One matching word is not enough: "a
  medieval castle" must not pass on a line that only says "the medieval period".
- **AC-152**: A subject that fails its trace is **dropped, never rewritten**.
  `object` is written NULL, `object_rejection_reason` records why, and the scene
  survives.
- **AC-153**: A scene whose object was dropped is also moved off its object
  template onto `text-card`. An object template with no subject has nothing to
  draw and no prompt to draw it from.
- **AC-154**: `subject` is not editable. Scene Studio renders it read-only beside
  its citation, and the scene PATCH schema still names exactly four fields.

The illustration

- **AC-155**: An illustration is generated **on demand**, from the scene that
  needs it, never at plan time.
- **AC-156**: It is generated in the project's `style`, from a prompt that asks
  for a flat grey background, no shadow, no floor line, no text and no people.
- **AC-157**: The generated PNG is background-removed and alpha-trimmed in the
  browser and uploaded **straight to storage** by presigned PUT. No image byte
  crosses one of our Functions on a path the browser can take itself.
- **AC-158**: A redraw writes a **new** pathname and never overwrites the
  previous one.
- **AC-159**: The scene row does not point at an illustration until the bytes are
  in the store. A run abandoned midway leaves the scene still waiting for one.
- **AC-160**: A scene may have at most `MAX_OBJECT_ATTEMPTS` illustrations drawn
  for it.

Money

- **AC-161**: Each illustration is charged through `@repo/billing`, eagerly, at
  `BROLL_OBJECT_IMAGE_MICROS`. Every one is charged; there is no bundled first.
- **AC-162**: A charge that does not deliver a picture is refunded before the
  route answers, under its own idempotency prefix.
- **AC-163**: A repeated request carrying the same `Idempotency-Key` charges once.

Templates

- **AC-164**: Three templates draw an illustration: `object-full` (centred and
  inset, words below), `object-left` (a column beside the words), and
  `character-plus-object` (the creator and the thing in one frame).
- **AC-165**: An illustration is centred in its box rather than bottom-anchored,
  and `object-full` is inset rather than full-bleed.
- **AC-166**: `character-plus-object` places the character on the **right**,
  mirroring `character-left`, and never overlaps the two figures.
- **AC-167**: All three stack rather than split in a portrait frame.
- **AC-168**: A scene renders its words alone while its illustration has not
  decoded, rather than rendering nothing.

Scene Studio

- **AC-169**: An object template is offered to any scene that has a **subject**,
  whether or not an illustration exists yet.
- **AC-170**: A scene on an object template with no illustration is **blocked**,
  with a reason and a way out, rather than unrenderable in silence.
- **AC-171**: `Render all` offers to draw every missing illustration first, as
  one action carrying its total price.
- **AC-172**: `character-plus-object` requires both a character set and a
  subject, and the PATCH route refuses it without both.

## Value sourcing

| Value | Where it comes from |
|---|---|
| `DEFAULT_BROLL_OBJECT_IMAGE_MICROS` = 350,000 ($0.35) | Priced against the character set, not derived. $2.00 buys six images costing $0.84 (~2.4x); one image costs $0.134, so $0.35 holds a comparable multiple on a number a creator can reason about. **Tentative, pending the same client review the character-set price is waiting on.** |
| `BROLL_OBJECT_IMAGE_COST_MICROS` = 134,000 | One image at the `gemini-3-pro-image` Pro tier. The only cost figure in `pricing.ts` that is a single published rate rather than an estimate over one — there is no chain, so there is no anchor image being re-sent each turn. Rots with the tier. |
| `MAX_OBJECT_ATTEMPTS` = 8 | Not protecting the balance (every draw is charged) but a creator stuck redrawing one castle at real cost. Well above real use, well below a runaway. No evidence behind the exact number. |
| `OBJECT_TIMEOUT_MS` = 30,000 | Shorter than the character turn's 40,000. This is one call with a scene pane open, not the sixth of six inside a 300 s route ceiling, so a hung call should surface and refund quickly. |
| `OBJECT_ASPECT_RATIO` = `1:1` | An object has no reliable orientation — a castle is wide, a rocket is tall — so a square wastes least on either. The alpha trim crops to the drawing regardless. |
| `OBJECT_IMAGE_LIMIT` = 60/hour | Sized against the batch action: a twenty-scene plan could legitimately want fifteen at once, so the cap sits above a whole-project draw (~3 projects) and below a script. |
| `OBJECT_LEFT_THEME.columnRatio` = 0.36 | Narrower than `character-left`'s 0.40. A character is read as a person and needs the height; in this template the words are the point and the picture supports them. No measurement behind it. |
| `OBJECT_FULL_THEME.figureInsetRatio` = 0.12 | Enough that the grid backdrop reads as a frame around the object rather than something it covers, and enough to leave the scrim somewhere to sit. Chosen by eye. |

## Consequences

- **`figure-frame.ts` is new, and two existing templates now draw through it.**
  `character-left` and `character-center` each carried a composition body that
  `object-left` and `object-full` needed verbatim. Copying them would have made
  four places a figure's entrance could drift apart, so the bodies moved into one
  module and every figure template became a theme plus a call. The landscape
  output of both character templates is unchanged, and their existing tests hold
  us to that.
- **`drawRenderable` is exhaustive now.** It used to end in a `default` that drew
  `chart-full`, so a template added to the union without a case here drew a chart
  instead of failing — a silent wrong answer in the one place the preview and the
  encoder are meant to be identical. It is a `never` check instead.
- **`api/blob/upload` authorizes two pathname shapes.** A character asset through
  `broll_characters`, an object through `broll_scenes → broll_projects.user_id`.
  Each is recognised only by its own literal prefix segment. This is the most
  security-sensitive file the spec touches: without that check the route is an
  anonymous write endpoint into the store.
- **The pure template facts moved to `scene-schema.ts`.** `visualTypeForTemplate`,
  `CHARACTER_TEMPLATES` and `OBJECT_TEMPLATES` need no knowledge of what can be
  drawn, and the planner reads them — so leaving them in `scene-templates.ts`
  would have dragged `RENDERABLE_TEMPLATES`, and with it every canvas drawer,
  into the planner's server bundle. `scene-templates.ts` re-exports them, so
  there is still one definition and one place to look.
- **`to-renderable.ts` finally has a test.** It is the mapping three surfaces
  share and had none; adding a scene kind was the first change since it was
  centralised.
- **Two migrations, applied in two runs.** `0019` adds the ledger reason, `0020`
  the four `broll_scenes` columns — the same split `0016`/`0015` used, for the
  same add-deploy-then-use reason.

## Follow-up

- [ ] **`@imgly` segmentation has only ever been measured on characters.** Phase
      0 verified clean edges on generated people in both shipping styles; a hero
      object is the same kind of salient foreground, but that is an inference
      rather than a measurement. Check a handful of real objects early. If it
      disappoints, the contained fix is prompting for a flat keyable colour and
      keying it inside `objects.ts`.
- [ ] **A rejected chart does not downgrade its template, and an object now
      does.** `assembleScene` moves an object scene to `text-card` when its
      subject fails, but a `chart-full` scene whose chart was dropped keeps
      `chart-full` and previews as "no renderer yet". That is a pre-existing bug
      this spec deliberately did not fix, because it changes planner behaviour on
      a path with its own tests. The fix is one line beside the object one.
- [ ] The retail price is a guess pending client review, like every other b-roll
      price.
- [ ] `character-plus-chart` is still undrawn. `character-plus-object` is the
      first two-figure composition in the app, and whoever builds that one should
      start from its zoning rather than a blank file.
- [ ] Nothing sweeps orphaned object assets. A scene deleted by hand, or replaced
      by a plan re-run, leaves its illustration in the store. The character sweep
      (`api/cron/character-sweep`) is the precedent, and the Hobby plan's
      once-a-day cron cap applies here too.

## Rationale

The subject trace is the load-bearing decision, and it is worth being explicit
about what it costs. Requiring **every** content word is strict enough to reject
honest subjects: a speaker who says "the old fortress" and a model that proposes
"a castle" will not trace, and that scene falls back to text. The bias is
deliberate and matches `traceChart`'s — dropping a true picture is recoverable by
the creator restyling the scene, publishing a false one under their name is not.

The alternative considered was a semantic check (ask a second model whether the
subject is fairly implied by the line). It was rejected for the reason the
original honesty check gives: a promise kept by ordinary code that cannot
hallucinate is worth more than one kept by a model marking another model's work.
