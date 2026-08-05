# Scope: B-Roll Generator

Takes a timed transcript and a photo of the creator, and returns a folder of
short, timecode-named B-roll clips ready to drag into an NLE. The transcript comes
from Rough Cut's export, so this is the second half of one workflow rather than a
separate product. Runs on port 3003.

The output is **not** a finished video. It is a batch of independent assets that
slot into an edit already in progress.

**Build approach:** Tracer Bullet (vertical slices; each feature built end to end
through every layer, working).
**Workflow:** Alpha until Phase 2 lands, then Beta. Rendering is client-side and
canvas-based, so a meaningful share of this app's surface is only checkable in a
browser — but the pure logic (planner validator, frame math, credit reserve and
settle) carries unit tests and those are not optional. The repo-wide gates apply:
`lint`, `typecheck`, and `test` run for this workspace in the required `check`
job, and this app's Vercel production build becomes a required check on `main`.

_You are in charge. Every box below is a suggestion, not a gate: run any, skip
any, and mark a feature `done` when you decide it is._

## At a glance

| # | Feature | Phase | Status |
|---|---------|-------|--------|
| 1 | Spikes: client-side encode + segmentation | Phase 0 | done |
| 2 | Skeleton: workspace, schema, transcript contract | Phase 1 | planned |
| 3 | Character pipeline | Phase 2 | planned |
| 4 | Scene planner | Phase 3 | planned |
| 5 | One template end to end | Phase 4 | planned |
| 6 | Remaining templates + Scene Studio | Phase 5 | planned |
| 7 | Batch export, zip, credits | Phase 6 | planned |

## Phase 0

### 1. Spikes: client-side encode + segmentation · done

**Intent**: Retire the two risks that would change the architecture — whether the
browser can encode synthesized frames, and whether segmentation is clean enough on
generated characters to skip a manual touch-up path.
**Done when**: both answered with measurements, and the findings live somewhere
versioned.

- [x] Design it (spec) [0001](../../specs/broll/0001-high-level-design/index.md)
- [x] Build it: throwaway prototype, outside this repo, deliberately kept off the
      required-checks gate
- [x] Verify it: AC-1 to AC-6 in
      [verify.md](../../specs/broll/0001-high-level-design/verify.md)
- [x] Record it: [rationale.md](../../specs/broll/0001-high-level-design/rationale.md)

**Both passed. No architecture change.** Client-side rendering holds, no
server-side fallback is needed, and no manual cutout touch-up path is needed.
Nine spec changes came out of it — see rationale §2.

The prototype has been deleted. That was the deal: what transfers is knowledge,
not code.

## Phase 1

### 2. Skeleton: workspace, schema, transcript contract · planned

**Intent**: Wire `apps/broll` end to end through the shared packages, and build the
transcript contract that makes the Rough Cut handoff real rather than aspirational.
**Done when**: a user can create a b-roll project, upload or inherit a transcript,
and see its parsed segments. No AI yet.

- [ ] Build it: /develop broll skeleton
  - [ ] Scaffold `apps/broll` on port 3003, Clerk, `env.ts` (AC-7, AC-13)
  - [ ] Extract `@repo/transcript` — type, parser, and the **hoisted** frame math
        from rough-cut's `timebase.ts` / `frame-math.ts` (AC-11)
  - [ ] Build rough-cut's post-EDL word-level transcript JSON export (AC-12)
  - [ ] Migration: `broll_*` tables, `credit_ledger.broll_project_id` + CHECK,
        `credit_ledger_reason` values (AC-8, AC-9, AC-10)
- [ ] Verify it: /check verify broll skeleton

**Bigger than the spec implies.** This phase carries a shared package extraction, a
new export surface in a *different* app, and two shared-schema migrations. Budget
accordingly.

**Blocked on:** a production domain — Clerk multi-domain config plus the
throw-at-import `env.ts` convention means the app cannot deploy without one.

## Phase 2

### 3. Character pipeline · planned

**Intent**: Photo to a reviewed set of transparent character PNGs in R2, paid for
correctly.
**Done when**: a user generates an emotion set, reviews it, and the assets are
stored — with credits reserved and settled, and no double charge on a double-click.

- [ ] Build it: /develop character pipeline (AC-14 to AC-22)
- [ ] Verify it: /check verify character pipeline

Self-contained and demoable alone.

## Phase 3

### 4. Scene planner · planned

**Intent**: Turn a transcript into a ranked scene list that never invents a number.
**Done when**: the planner runs against real transcripts, the multiplier is tuned
against evidence, and the validator provably rejects fabricated charts.

- [ ] Build it: /develop scene planner (AC-23 to AC-28)
- [ ] Verify it: /check verify scene planner

**Needs a decision first:** whether to build on `generateContent` or the
Interactions API that Google is steering toward. See rationale §3.

## Phase 4

### 5. One template end to end · planned

**Intent**: Prove the whole spine — plan to composited scene to downloadable MP4 —
on exactly one template.
**Done when**: `chart-full` renders one scene to a file a creator can drag into an
NLE.

- [ ] Build it: /develop chart-full end to end (AC-29 to AC-34)
- [ ] Verify it: /check verify chart-full end to end

Deliberately narrow. Everything after this is repetition rather than discovery.

## Phase 5

### 6. Remaining templates + Scene Studio · planned

**Intent**: The review UI, and the five templates that make the output worth
shipping.
**Done when**: a user can review, override, exclude, and manually add scenes.

- [ ] Design it (spec): `/architect scene studio`
- [ ] Build it: /develop scene studio
- [ ] Verify it: /check verify scene studio

**Read rationale §2.9 before starting.** Scene Studio is a live preview canvas
beside editable overrides, which is exactly the shape that produced Phase 0's two
worst rendering bugs.

## Phase 6

### 7. Batch export, zip, credits · planned

**Intent**: Turn a reviewed scene list into a folder of files, and close the
billing loop.
**Done when**: a user exports a batch, retries a single failure, and tops up
through the Wallet without leaving the workflow broken.

- [ ] Build it: /develop batch export (AC-35, AC-36)
- [ ] Verify it: /check verify batch export

## Legend

- **Next step** = the first unticked box.
- **needs a decision** = run `/architect` first; otherwise straight to `/develop`.
- **Status** `planned` → `in-progress` → `done`, plus `existing` and `dropped`.
- **Workflow tier tag** beside a heading overrides the project default for that
  one feature; no tag means it inherits.
