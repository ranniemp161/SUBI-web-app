# B-Roll Generator — UI/UX design prompt

For pasting into Claude Design (or any design tool that takes a written brief).

**How to use this:** paste §A (context + design system) once at the start of the
session. Then paste **one** screen block from §B per request. Pasting all screens
at once reliably produces generic output — the model averages across them instead
of committing to any one.

---

## §A — Paste this first

### Product

I'm designing **B-Roll Generator**, a desktop web app for YouTube creators who
make talking-head videos. It solves one problem: a viewer won't watch ten minutes
of one static shot, so creators need cutaways — charts, stylized character shots,
on-screen text — and each one currently takes 15+ minutes of manual work in After
Effects.

The app takes **a timed transcript** and **a photo of the creator**, and returns a
folder of short, timecode-named B-roll clips they drag into their existing edit.

The mental model, in one line:

> "You talked about Nigeria's fuel imports at 2:35 — here's a clip for it."

The output is **not** a finished video. It's a batch of independent 4–8 second MP4
assets that slot into an edit already in progress. The app never sees the
creator's video file.

### Who's using it

Solo creators and small production teams. They're comfortable in an NLE (Premiere,
Resolve, Final Cut) but are **not** motion designers. They're doing this on a
desktop with a real monitor, mid-edit, and they want to be out of this app fast.
Speed of review matters more than depth of control.

### The one UX principle everything follows

**The AI proposes, the user disposes.** The app decides what B-roll is needed and
where it goes; every one of those decisions is overridable and none are mandatory
to touch. A user who clicks "generate" and then "export all" should get usable
output. A user who wants to adjust every scene should be able to. Default output
must be good enough to ship untouched — manual arrangement is a fallback, not the
primary flow.

Corollary: **zero manual positioning.** There is no freeform canvas, no drag
handles, no layer panel. Layout is *selected* from six templates, never computed
by the user.

### Design system — use these exact values

This app is the fourth in an existing ecosystem and must look like a sibling of
the others. Do not introduce new hues.

**Palette (dark only — there is no light mode)**

| Token | Value | Use |
|---|---|---|
| `--background` | `#000000` | Page background |
| `--surface` | `#0c0c0e` | Panels, cards, raised surfaces |
| `--surface-alt` | `#2c2c2c` | Inputs, secondary fills, dividers |
| `--foreground` | `#ffffff` | Primary text |
| `--muted` | `#aaaaaa` | Secondary text, metadata, timecodes |
| `--accent` | `#fffc00` | **Key Yellow** — brand, primary actions, active state |
| `--accent-foreground` | `#111111` | Text *on* yellow |
| `--accent-hover` | `#2997ff` | **Interactive Blue** — hover, focus ring, links |
| `--accent-shadow` | `rgba(255,252,0,0.25)` | Glow behind brand elements |
| `--brand-muted` | `rgba(255,252,0,0.2)` | Brand borders at low emphasis |

**Deliberate quirk — do not "fix" this:** the hover state shifts *hue*
(yellow → blue), not lightness. It's the established ecosystem behavior. Primary
buttons are Key Yellow with near-black text and go Interactive Blue on hover.

**Type**

- Headings: **Space Grotesk**
- Body / UI: **DM Sans**
- Timecodes and any numeric data: tabular figures, so columns of `02:35` align

**Surface treatment** (this is what makes it feel like the existing apps)

- **Glass panel:** `rgba(255,255,255,0.02)` fill, `backdrop-filter: blur(16px)`,
  `1px solid rgba(255,255,255,0.08)` border
- **Glow panel** (for the one focal element on a screen): same, but a Key Yellow
  border and `box-shadow: 0 0 40px -10px rgba(255,252,0,0.2)`
- **Grid background:** 40px × 40px lines at `rgba(255,255,255,0.08)`, used behind
  hero/empty areas
- Borders do the work, not drop shadows. Panels sit on near-black; separation
  comes from a 1px hairline and a 2% white fill, not elevation shadow.

**Motion**

- Slow ambient float/breathe on decorative elements (6–10s loops)
- AI-working states pulse Key Yellow, not a generic spinner
- Skeleton loaders shimmer left-to-right
- Everything respects `prefers-reduced-motion`

**Accessibility**

- Keyboard focus ring: `2px solid #2997ff`, `2px` offset
- Never encode meaning in color alone — scene strength, render status, and
  chart-validation state each need a shape or label too
- Yellow on near-black is high contrast; white-on-yellow is not — always use
  `#111111` for text on yellow fills

---

## §B — Screen blocks (paste one at a time)

### B1. Dashboard

The list of projects. One project = one source video's B-roll batch.

Needs: project cards (name, thumbnail of the character if generated, scene count,
last opened, render status), a prominent "New project" action, and a **credit
balance** indicator in the header. Credits are USD-denominated and bought in a
separate billing app, so the balance is a read-only display with a "Top up" link
that leaves this app.

Show three states: populated (5–6 projects), empty (first-time user), and loading
(skeletons). The empty state is the one that matters — it has to teach the
premise in one screen.

### B2. Project setup

Two required uploads before anything else can run: a **timed transcript**
(SRT/VTT, or a JSON export from the creator's rough-cut app) and a **reference
photo** of the creator.

Also here: a style picker (fixed list — anime, 3D, and a few others, shown as
visual swatches not a dropdown) and output settings (resolution + fps, default
1080p30, set once per project).

Design the dependency clearly: planning can't run until both uploads exist. Show
the partially-complete state — transcript uploaded, photo missing.

One sensitive detail worth designing for: the reference photo is the creator's
actual face. The upload control should say plainly what happens to it and how
long it's kept.

### B3. Character generation + review gate

The app generates a full set of emotion variants (neutral, happy, surprised,
thoughtful, skeptical, excited — ~6–8) from the reference photo in the chosen
style, then removes the background so each is a transparent PNG.

**The review gate is the screen.** Each cutout is shown on a **checkerboard**
background so the user can judge the transparency cutout quality — especially at
hair and glasses edges, which is where background removal fails. Per variant:
keep or regenerate. Regenerating one variant must not redo the set.

Design the in-progress state too: generation is multi-turn and takes real time, so
variants should populate progressively rather than all appearing at once.

### B4. Scene Studio — the core screen

This is where users spend their time. Design this one most carefully.

A list of proposed scenes, each with:

- **Timecode** (`02:35`) and duration
- The **source line** from the transcript that triggered it
- A **strength score** — strong scenes are checked by default, weak ones appear
  unchecked but visible
- A **preview** that plays at the scene's real duration
- Per-scene overrides: visual type (character / infographic / text), emotion,
  layout template, on-screen text, chart values
- Exclude from batch

Plus: manually add a scene at a chosen timecode.

Key layout question to solve — the user is scanning 10–20 scenes and needs to
judge each in about two seconds. The source line is what makes a scene
identifiable ("oh, that's the fuel imports bit"), so it can't be truncated into
uselessness. Consider a list/detail split rather than a grid of equal cards.

Show a scene in each visual type, and show one excluded.

### B5. Chart confirmation

Charts render from real numeric data and are **never AI-drawn**. Before render,
the user confirms the values.

The critical design element: each chart's data must be traceable to a **verbatim
quote** from the transcript. Show the quoted span alongside the numbers, with the
figures highlighted inside the quote. This exists because a fabricated statistic
rendered as a clean bar chart gets published under the creator's name — the UI
should make "where did this number come from" answerable at a glance.

Also design the rejection state: when the transcript only quantifies vaguely
("most", "a huge share"), there's no chart and the scene falls back to text. Show
that as an explained downgrade, not an error.

### B6. Layout template picker

Six templates, shown as visual thumbnails:

| Template | Composition |
|---|---|
| `character-left` | Character 40% left, text right |
| `character-center` | Character centered, full bleed |
| `chart-full` | Chart fills frame |
| `character-plus-chart` | Chart main, character small bottom-right |
| `text-card` | Large text only |
| `split-compare` | Two elements side by side |

A template is positions *plus motion* — entrance (character slides in, text fades
up, chart bars grow from zero), a slow idle drift, optional exit. The thumbnails
should hint at the motion, not read as static slides.

### B7. Batch export

Each scene renders independently in the browser. Needs: per-scene progress, a
clear indication that one failed scene doesn't block the others, retry-one,
and download individually or as a zip. Filenames carry the timecode
(`scene_04__02-35.mp4`).

Design the mixed state: some scenes done, one rendering, one failed, one queued.

### B8. Blocking and edge states

- **Unsupported browser.** The app needs WebCodecs to render. This is detected at
  load and must refuse clearly *up front* — never mid-export, after the user has
  spent credits. Design this as an honest, specific explanation, not a generic
  error page.
- **Out of credits**, mid-flow, with a path to top up in the separate billing app
  and return.
- **Mobile.** Desktop only — this is a canvas review UI. Design the small-screen
  message.

---

## Notes for whoever runs this

- Ask for **one screen at a time**, then iterate on it before moving on.
- Give real content, never lorem ipsum — the sample transcript line
  ("Nigeria imports about 80% of its refined fuel") exercises the chart path,
  the quote-provenance UI, and the `chart-full` template all at once.
- The design system section (§A) is copied from
  `packages/ui/src/styles/theme.css` and `apps/rough-cut/src/app/globals.css`.
  If those change, this drifts — re-derive rather than trusting this copy.
