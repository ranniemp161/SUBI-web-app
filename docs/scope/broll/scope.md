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
| 2 | Skeleton: workspace, schema, transcript contract | Phase 1 | in-progress |
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

### 2. Skeleton: workspace, schema, transcript contract · in-progress

**Intent**: Wire `apps/broll` end to end through the shared packages, and build the
transcript contract that makes the Rough Cut handoff real rather than aspirational.
**Done when**: a user can create a b-roll project, upload or inherit a transcript,
and see its parsed segments. No AI yet.

- [x] Design it (spec) [_root/0001](../../specs/_root/0001-transcript-contract/index.md)
      for the transcript contract (the two boxes marked `spec 0001` below), and
      [0002](../../specs/broll/0002-data-model/index.md) for the `broll_*` tables
      and the two shared ledger changes. The scaffold is governed by neither: it
      is blocked on the domain, not on a design.
- [ ] Build it: /develop broll skeleton — code in
      [packages/transcript/](../../../packages/transcript/),
      [apps/rough-cut/src/lib/export/](../../../apps/rough-cut/src/lib/export/)
      and [packages/db/src/schema.ts](../../../packages/db/src/schema.ts) plus
      [drizzle/0015_ambitious_martin_li.sql](../../../packages/db/drizzle/0015_ambitious_martin_li.sql)
  - [ ] Scaffold `apps/broll` on port 3003, Clerk, `env.ts` (AC-7, AC-13).
        **Not started: needs the production domain**, which is the b-roll high
        level design's open question 4 and is marked blocking Phase 1.
  - [x] `@repo/transcript`: the package, the frame math moved out of rough-cut
        behind re-export shims, and the Zod document schema
        (AC-11; spec 0001 AC-1 to AC-6, AC-14, AC-16)
  - [x] Frame rate made durable: `projects.source_fps_*` columns, written by the
        browser at reselect (spec 0001 AC-7). Migration `0013` applied to both
        Neon branches and verified live.
  - [x] rough-cut's post-EDL transcript export: the clamp aware collapse, the
        builder, the export modal entry, and the route b-roll calls
        (AC-12; spec 0001 AC-8 to AC-13). Verified against ten real projects.
  - [x] Cross origin preflight fixed (AC-15; spec 0001 AC-15). Found by running
        the app on 2026-08-06: `proxy.ts` answered every `OPTIONS` with `401`
        before the route ran, so the preflight handler was unreachable and its
        unit tests passed only because they called it directly. `proxy.ts` now
        lets a preflight on this one path through, because a CORS preflight
        carries no credentials by spec and Clerk can therefore never authorize
        one. Re driven live: allowed origin `204` with the origin named and
        credentials allowed, any other origin and a missing origin `403`, `GET`
        still `401`, and sibling routes plus path tricks
        (`/transcript/extra`, `/transcript/../../credits`) all still `401`.
  - [x] Subtitle export (`.srt` and `.vtt`), added on request outside spec 0001.
        Rendered from the same document, so the captions carry the same post cut
        timing and drop straight beside the exported MP4. JSON stays the b-roll
        handoff; the subtitle formats cannot carry the frame rate, the word
        confidence, or the provenance the planner needs.
  - [ ] Migration, now governed by spec
        [0002](../../specs/broll/0002-data-model/index.md). **Unblocked
        2026-08-08**: the column inventory the lost `broll-generator-spec.md` was
        meant to supply is reconstructed there, marked Decided or Inferred row by
        row so a later reader can tell evidence from invention.
    - [x] Schema: the three tables, the two indexes, the assets unique
          constraint that makes replace in place true, and the
          `broll_render_status` enum (AC-8, AC-9, AC-40, AC-41, AC-42, AC-46).
          Defined in `packages/db/src/schema.ts` 2026-08-08, lint, typecheck and
          test green. **Defined, not live in any database.**
    - [x] Ledger: `credit_ledger.broll_project_id` plus the
          `credit_ledger_one_project_ref` CHECK (AC-10). Added plainly, not
          `NOT VALID`: **AC-47 was withdrawn during the build** because
          `drizzle-kit` runs all pending migration statements in one
          transaction, so the split buys nothing inside a single migration
    - [x] Apply migration `0015_ambitious_martin_li.sql` to the dev branch, then
          to production behind the preflight prompt (AC-8). **Applied to both on
          2026-08-08**, dev first as a rehearsal. `db:verify` passes on both, and
          the objects that actually enforce the invariants were confirmed live on
          each: the `credit_ledger_one_project_ref` CHECK (validated, not
          `NOT VALID`), all three foreign keys with the right delete behavior
          (cascade, cascade, set null), `broll_assets_project_emotion_uq`, both
          query indexes, the three enum values, and every load bearing nullable
          column. Production carried 191 ledger rows and 45 projects, so the
          validation scan we chose to accept was microseconds
- [ ] Verify it: /check verify broll skeleton. A runtime pass on 2026-08-06 drove
      the real server: the auth gate holds, the document path holds (the package
      was driven through its public export, and ten real projects built clean),
      and the cross origin preflight now answers correctly after the `proxy.ts`
      fix above. **Still unverified: the route's success path.** Reaching a `200`
      needs a real Clerk session, and this repo deliberately keeps its end to end
      suite signed out because preview and local both talk to the production
      database. The export modal is unverified for the same reason (it needs sign
      in plus a local video reselect).
- [ ] Test it: /test broll skeleton. The pure logic here (frame math, the collapse,
      the parsers) is exactly what this workspace's Workflow line says carries
      unit tests, so this box is not optional even at Alpha.

**Decision debt carried by this feature** (all from spec 0001's own follow up
list, none blocking the boxes already ticked):

- The byte cap and the segment count cap are placeholders sized by arithmetic, not
  measured against a real ten minute transcript. Two named constants in
  `packages/transcript/src/document.ts`.
- `verify.md` for the b-roll high level design still states AC-11 in its
  unbuildable form (it asks a package to import from an app). Spec 0001 records
  the corrected wording; the older file has not been amended.
- Before b-roll actually fetches a transcript across origins, confirm that Clerk's
  session cookie genuinely travels on a credentialed cross origin fetch from the
  b-roll origin to `myfirstcut.app`. Multi domain SSO is configured, but whether
  the cookie rides a cross site request depends on its `SameSite` setting, which
  is Clerk's to set and not ours. If it does not travel, switch to the server to
  server variant carrying a forwarded token: that fallback is already weighed in
  the rationale and needs no new spec. Enrolled 2026-08-08 from spec 0001's follow
  up list, which had it and this scope did not.

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

**Two things spec [0002](../../specs/broll/0002-data-model/index.md) surfaced
that land here, not in Phase 1.** The `credit_ledger_reason` enum values ship in
their own later migration, because Postgres will not let a value added in a
transaction be used in that same transaction (AC-44). And the money statements
themselves are not a small addition to `@repo/billing`: see the new `_root`
feature 6, which is where that work is tracked.

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
