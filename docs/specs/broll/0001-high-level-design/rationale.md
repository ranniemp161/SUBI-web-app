# Rationale — B-Roll Generator

Why the design is what it is, and what Phase 0 measured.

The prototype that produced these results lived outside this repo and has been
deleted. **This file is the surviving record.** Numbers here are measured, not
estimated; where something was not tested, it says so.

---

## 1. Phase 0 results

Six experiments, all passing. Nothing forced an architecture change.

| # | Question | Result |
|---|---|---|
| 01 | Can a Worker encode synthesized `OffscreenCanvas` frames? | **PASS** — `avc1.640028` (H.264 High 4.0, hardware), 180 chunks, 651 KB, **1791 ms** for 6 s @ 1080p30 |
| 02 | Clean segmentation on generated characters? | **PASS** — anime *and* 3D, ~4 s/image steady state, verified at 5× zoom on `#000000` |
| 03 | Does identity survive a 6-emotion set? | **PASS** — held in both styles, **~110 s per set** |
| 04 | Does the planner refuse to fabricate numbers? | **PASS** — vague fixture returned `chart: null` on every scene |
| 05 | Does the motion read as broadcast or slideshow? | Renders correctly; final aesthetic judgment deferred to a real timeline |
| 06 | Does it hold up with a character composited in? | **PASS** — good enough to build on |

### Spike 1 was narrower than the spec assumed

Spec §12 called WebCodecs availability "the single biggest technical risk."
`apps/rough-cut/src/workers/export-worker.ts` already ships browser-side
WebCodecs encoding via `mediabunny`, muxed to MP4, with `canEncodeVideo` for
detection. The genuinely open question was only whether *synthesized* frames
(drawn to `OffscreenCanvas`) encode, as opposed to frames decoded from a real
file through mediabunny's `Conversion`. They do.

**First run failed and it was our bug, not the platform's.** The hardcoded codec
string was `avc1.42001f` — Baseline **level 3.1**, which caps at 1280×720@30.
Requesting 1080p from it is an invalid configuration, not a missing capability.

Two lessons, both cheap and both repeated later in Phase 0:

- Before treating a spike failure as an architecture result, confirm you asked a
  valid question. "WebCodecs doesn't work for our users" is a vastly more
  expensive conclusion than "the codec string was wrong."
- **Probe a candidate list; don't hardcode one.** Hardware support varies by
  machine, and knowing *which* codec won is more useful than a boolean.

### Timing caveat

1791 ms is a **floor**. The test frame was flat black with solid-fill bars —
651 KB over 6 s is ~0.87 Mbps against a 6 Mbps request, meaning the encoder never
worked. Real scenes composite a stylized character with gradients and hair
detail. Re-measure with real assets before treating it as a shipping figure.

Extrapolated, a 20-scene batch is ~35–40 s. Batch export is not a UX problem.

---

## 2. Changes to the spec that Phase 0 forced

Nine, none structural, all cheap now and expensive later.

### 2.1 `chart` needs `unit` and `title`

The renderer displayed `80` and `20` for a transcript that said "80%". **A bare
80 next to a bare 20 is a different claim than 80% and 20%.** For a product whose
pitch is numeric honesty this is a correctness bug, not a cosmetic one.

`unit` is traced to the source span exactly like values are, with one documented
alias (`%` ↔ "percent"). `title` was always needed by the renderer, was absent
from the schema, and the model supplied one unprompted.

Shape: `{type, title, values, labels, unit, source_span}`.

### 2.2 The review gate must preview on the scene background

Spec §3.3 says review each cutout on a checkerboard. That is the wrong default
here: characters are generated on **flat light gray**, and the classic
segmentation artifact is a faint *light* fringe. A mid-gray checkerboard sits at
nearly the same value and conceals it — then it glows against near-black at
export.

Judge a cutout on what it composites onto. Offer a background toggle; default to
scene-dark.

### 2.3 Cutouts must be alpha-trimmed before storage

Background removal returns an image the same size as its input. Characters
generated in a landscape frame come back as mostly-empty PNGs, so every template
scales and positions **empty canvas** rather than the character. `character-left`
produced a small figure in the corner — working exactly as written, on the wrong
input.

Trim to the alpha bounding box after segmentation, before upload. Then a template
can say "character fills 40% of the left" and mean it. Also cuts stored bytes
substantially, which matters because every Scene Studio load refetches assets.

This **supersedes** tightening generation framing (§2.4). Do both, but trimming is
the robust fix: it works regardless of how any shot gets framed, and framing will
always vary.

### 2.4 Turn-1 prompt needs aspect and fill instructions

Generated characters occupied roughly a third of a landscape frame. Ask for
portrait or square, head and shoulders filling most of the frame.

### 2.5 Generation must stream per turn

A set takes ~110 s and cannot be parallelized — each turn anchors on the previous
turn's output. Returning all six at once means the user cannot tell working from
hung, and **you cannot see where drift begins.** Spec §3.3 already calls for
progressive population; treat it as a requirement, not a nicety.

### 2.6 Parse the plan scene by scene

One scene with an out-of-enum `emotion` failed the entire plan and discarded
every valid scene with it. Spec §4 already states the right principle for
rendering — *"one scene failing never blocks the batch."* **Planning deserves the
same rule.**

General principle worth carrying: **strict about claims, lenient about shape.**
Charts, numbers, units, and source spans get zero tolerance — they are assertions
published under a creator's name. Missing optional keys and invented emotion
labels get coerced, because they are not truth claims. Conflating the two costs
you good plans.

### 2.7 Keep PNG end to end

Test inputs round-tripped through JPEG, whose ringing artifacts land exactly on
the high-contrast character/background boundary. Segmentation worked *despite*
that. Gemini → browser → R2 should stay PNG throughout.

### 2.8 Prompt and schema will drift unless generated from one source

Four separate runtime failures, one root cause — a hand-written prompt and a
hand-written zod schema describing the same contract:

| Symptom | Cause |
|---|---|
| `source_text` missing | Never named in the prompt |
| `chart_type` vs `type` | Two sources of truth for one field name |
| `visual_type: "split-compare"` | A layout name in a visual-type field; the prompt never said they differ |
| `emotion` out of enum | The six valid emotions were never listed |

Every one surfaced at runtime, against a paid API call. **Phase 3 must generate
the prompt's shape section from the schema, or pass a `responseSchema`.** Prose
describing a schema is a copy, and copies rot.

### 2.9 Canvas discipline for Scene Studio

Two rendering bugs that will recur in Phase 5, where a live preview canvas sits
beside editable overrides:

- **Reset context state before clearing.** A 2D context is long-lived mutable
  state; a stray transform or a `globalAlpha` below 1 makes the *clear itself*
  scaled or translucent and the previous frame bleeds through. Presents as
  compositing ghosting, is actually bookkeeping.
- **A render loop mounts once and reads current values from a ref.** Listing
  editable fields in an effect's dependency array tears the loop down and starts
  a new one on every keystroke; under React's dev double-invoke that leaves two
  loops driving one canvas. With twenty scenes it presents as flicker and a hot
  fan rather than obvious ghosting.
- **`close()` is `free()`.** `ImageBitmap`, `VideoFrame`, and `OffscreenCanvas`
  are all detachable and all in the render path. Closing a bitmap and then
  `await`ing its replacement leaves a window where a 60 fps loop draws freed
  memory. Null the reference, build the replacement, install it, *then* close.

---

## 3. Operational findings

### Model IDs rot, and "listed" ≠ "callable"

`gemini-3-pro-preview` returned 404 as retired **while still appearing in
`models.list()` output with `generateContent` among its methods.**

Production needs a runtime capability check with a clear error, not a model ID
baked into an env var and assumed good. Pin exact IDs — never the `-latest`
aliases, which Google repoints, silently invalidating any measurement taken
against them.

Phase 0 used `gemini-3.6-flash` for planning and a pinned `gemini-3-pro-image`
for generation.

### ~~`generateContent` is being deprecated~~ Google recommends the Interactions API

The 404 body recommended migrating to an Interactions API. Not urgent, but
building Phase 3 on an endpoint Google is actively migrating away from is a
decision, not a default. Evaluate what it means for structured JSON output before
fixing a call shape.

**Corrected 2026-08-10.** "Deprecated" was inferred from that 404 body and
overstates it. Google's current documentation says the Interactions API "is now
generally available" and is **recommended**, and in the same breath that "the
GenerateContent API is also supported; the same configuration options and
recommendations apply". There is no deprecation notice and no timeline, so this
was never the race it reads as.

The evaluation this note asked for has now happened, in spec
[0003](../0003-scene-planner/index.md): `generateContent` stays, because AC-23
needs the prompt's shape generated from the schema, `responseSchema` is the
documented way to do that, and the Interactions API does not yet document an
equivalent. The paragraph above is kept rather than deleted because the lesson
under it holds, a vendor's own error body is a signal worth acting on. Only the
word "deprecated" was wrong.

### Image generation is the cost lever

Six image calls per character set at ~18 s each is the dominant cost and the
input to pricing (§8, open question 2). `gemini-3.1-flash-image` is worth an A/B
against the Pro tier: if Flash holds identity across six turns the unit economics
change materially; if it drifts, Pro is load-bearing and pricing follows.

---

## 4. What Phase 0 did NOT answer

- **Planner selectivity.** Three transcript lines produced three scenes; nothing
  was skippable. The `ceil(runtime × 1.2)` multiplier is untested and remains a
  guess. Needs a real ten-minute transcript, judged by what it *doesn't* pick.
- **Whether the output looks good on a timeline.** Motion that reads fine in a
  browser can look cheap cut against a talking head. Export a clip and watch it
  in an NLE next to real footage.
- **Safari.** Phase 0 ran on Windows. Safari is the browser most likely to force
  a narrower support gate; it needs a Mac, a borrowed machine, or a conscious
  decision to scope v1 to Chromium and Firefox and say so in the load-time gate.
- **Chart honesty beyond two fixtures.** The interesting boundary case is
  number-adjacent language with no digits — "roughly a third", "one in five".
