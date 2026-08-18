# Scope: B-Roll Generator

Takes a timed transcript and a photo of the creator, and returns a folder of
short, timecode-named B-roll clips ready to drag into an NLE. The transcript comes
from Rough Cut's export, so this is the second half of one workflow rather than a
separate product. Runs on port 3003.

The output is **not** a finished video. It is a batch of independent assets that
slot into an edit already in progress.

**Build approach:** Tracer Bullet (vertical slices; each feature built end to end
through every layer, working).
**Workflow:** **Beta since 2026-08-12**, when Phase 2 landed and this line's own
condition fired. Beta means `/check verify` then `/test` close a feature. The
risk profile is what makes that the right tier now rather than a formality: this
app spends real money at a vendor, handles a photograph of a person's face, and
writes ledger rows. Rendering is client-side and canvas-based, so a meaningful
share of this app's surface is only checkable in a
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
| 2 | Skeleton: workspace, schema, transcript contract | Phase 1 | done |
| 3 | Character pipeline | Phase 2 | in-progress |
| 4 | Scene planner | Phase 3 | in-progress |
| 5 | One template end to end | Phase 4 | in-progress |
| 6 | Remaining templates + Scene Studio | Phase 5 | in-progress |
| 7 | Batch export, zip, credits | Phase 6 | in-progress |
| 9 | Scene Studio screen design | Phase 7 | in-progress |
| 11 | Character reuse across projects | Phase 7 | in-progress |
| 12 | Visual pass and the Renders view | Phase 7 | in-progress |
| 13 | Vertical output, and the empty transcript guard | Phase 7 | in-progress |
| 14 | The clip's own design, and the cutout download | Phase 7 | in-progress |
| 10 | Blocking and edge states | Phase 7 | planned |
| 8 | Production deploy and error reporting | Deploy | in-progress |

**The next slice is the live verification of Phases 2 and 3.** Features 3 and 4
are both built and both stopped at the same wall: no Gemini image call made by
this code had ever succeeded. **The wall came down on 2026-08-12** when billing
was enabled on the API key's Google Cloud project and a private Blob store was
created. Checked the same day: `apps/broll/.env.local` carries both keys, the
blob token belongs to a **different store from Ruff Cut's**, and the app points
at the dev branch (`ep-holy-hall-aoe13azt`), which is what
[verify.md](../../specs/broll/0004-character-pipeline/verify.md) requires. Two
things that only a real run proves are still unproven: that billing is actually
live on that project, and that the store was created **private** (access cannot
be changed afterwards).

So four open boxes are now runnable, and they should run before anything in
Phase 4 starts: feature 3's verify and test, feature 4's AC-28 tuning, and the
human judgement of the reconstructed prompt. Everything after Phase 4 is
repetition rather than discovery, and building it on money paths and a prompt
nobody has watched run is how a $2.00 charge ships against output no one has
judged.

> **That is not what happened, and the paragraph above is kept as written rather
> than quietly corrected.** Between 2026-08-12 and 2026-08-13, Phases 4, 5 and 6
> were all built (PRs #141, #142, #143) and Sentry was wired (PR #144), while
> those four boxes stayed open. So the advice was sound and was overtaken, not
> withdrawn: the render path is now large, and every one of the four
> verifications it was waiting on is still owed. Reconciled by `/sync` on
> 2026-08-13, which is also when this scope was first ticked since #140 — three
> shipped features had been sitting here written as `planned`.

> **And the next slice moved again on 2026-08-13, deliberately this time.**
> Feature 9, the Scene Studio screen design, was enrolled and put in front of the
> owed verifications at the engineer's call. The reason is narrow and worth
> keeping: feature 6's `/check verify` came back BLOCKED with every screen box
> unexercised, and those boxes need a human driving the Scene Studio screen. Doing
> the redesign first means driving that screen once rather than twice, and it
> means not verifying a layout that is about to be replaced. **The four
> verifications above are still owed and still unstarted**, and feature 9 does not
> touch them: it is UI composition, no money path, no vendor call. Nothing here
> withdraws the warning two paragraphs up.

> **Read every "landed" claim below against `main`, because `main` stops at PR
> #143.** Checked 2026-08-16. Everything this scope records after that sits in two
> open pull requests: #145 carries the rest of feature 6 and the whole of feature
> 9, and #146 carries feature 11. Both are written, both are green, neither has
> merged. The prose in features 6, 9 and 11 says "landed" and means "built and
> pushed to a branch", which was true when each was written and is not the same
> claim. #145 reports all required checks green and mergeable, so the gap is a
> merge nobody has performed rather than anything failing.

**Where the queue actually stands, 2026-08-16.** Seven `Verify it` boxes are open
across features 3, 4, 5, 6, 7, 9 and 11, and the two written sheets say how far
that is from done: spec 0005's verify page has 17 of 46 boxes ticked, spec 0006's
has 6 of 72. The four verifications owed since 2026-08-12 have now been deferred
three times, once for feature 9, once for feature 11, and once for feature 12
below. Each deferral was reasoned and none was wrong on its own.

**What that does and does not mean, corrected 2026-08-16.** An earlier version of
this paragraph concluded "every phase of this app is built and almost none of it
has been watched running", and that was wrong. The engineer develops by driving
each feature in the browser as it is built, and the character pipeline and the
planner have both been run against live Gemini and work. The open boxes record an
unrun **ritual** — nobody has walked a written acceptance sheet criterion by
criterion and left the evidence behind — which is a real gap but a much smaller
one, and it is worth the most on the criteria that fail silently while the happy
path looks fine (AC-22 and AC-61 in feature 3 are the two clearest). Do not read
an unticked box here as an untested feature; ask.

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

### 2. Skeleton: workspace, schema, transcript contract · done

**Intent**: Wire `apps/broll` end to end through the shared packages, and build the
transcript contract that makes the Rough Cut handoff real rather than aspirational.
**Done when**: a user can create a b-roll project, upload or inherit a transcript,
and see its parsed segments. No AI yet.

- [x] Design it (spec) [_root/0001](../../specs/_root/0001-transcript-contract/index.md)
      for the transcript contract (the two boxes marked `spec 0001` below), and
      [0002](../../specs/broll/0002-data-model/index.md) for the `broll_*` tables
      and the two shared ledger changes. The scaffold is governed by neither: it
      is blocked on the domain, not on a design.
- [x] Build it: /develop broll skeleton — every sub box below is done as of
      2026-08-08, and the feature's **Done when** is met: a user can create a
      b-roll project, upload or inherit a transcript, and see its parsed
      segments. Driven end to end in the real app on both paths. Code in
      [packages/transcript/](../../../packages/transcript/),
      [apps/rough-cut/src/lib/export/](../../../apps/rough-cut/src/lib/export/)
      and [packages/db/src/schema.ts](../../../packages/db/src/schema.ts) plus
      [drizzle/0015_ambitious_martin_li.sql](../../../packages/db/drizzle/0015_ambitious_martin_li.sql)
  - [x] Scaffold `apps/broll` on port 3003, Clerk, `env.ts` (AC-7, AC-13). Built
        2026-08-08 (PR #128). **The domain never blocked this, and open question
        4 overstates it.** It blocks the production *deploy*, not the build:
        rough-cut (3000) and wallet (3001) already share one Clerk development
        instance locally with no satellite domain anywhere in this repo's
        source, because the multi domain SSO set lives in Clerk's Dashboard.
        B-roll on 3003 is the third app doing the same thing. What still needs a
        real domain is registering b-roll as a satellite for production, and
        Founder's Frame cannot supply one: it is a fully static export
        (`output: 'export'`, no API routes), so it can link to b-roll but never
        host it.
  - [x] Transcript intake, both paths (PR #128, #129). Upload an `.srt`, `.vtt`
        or `.json`, or inherit one from Ruff Cut, then see the parsed segments.
        This is what closes the feature's **Done when**. The Ruff Cut path is
        **server to server**, not a browser fetch: b-roll is getting its own
        domain rather than a subdomain, so it is genuinely cross site in
        production, and a credentialed cross origin fetch would then hinge on
        the `SameSite` value Clerk puts on its session cookie, which is Clerk's
        to choose. A server fetch carries no cookie and triggers no CORS.
        Authorization is a forwarded Clerk session token, which works because
        all three apps share one Clerk instance; rough-cut still runs its own
        owner check, so no new trust was created.
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

        **That verification is no longer true of `next dev`, and the date is
        why.** It was run on 2026-08-06, when rough-cut's `dev` script still
        passed `--webpack`; PR #124 removed that flag on 2026-08-07. Re driven
        2026-08-08: under `next dev` every `OPTIONS` on this route answers `404`
        regardless of origin, while `GET` still correctly `401`s. Against a
        production build the original result holds exactly, `204` with the exact
        origin and `credentials: true`, `403` for any other origin and for a
        missing one. So the route is right and the dev server is wrong, which is
        the mirror image of PR #122: that one was invisible in dev and broke
        production, this one is broken in dev and fine in production. Nothing
        depends on it today because the Ruff Cut handoff went server to server,
        and a server fetch triggers no preflight at all. Worth fixing before
        anything does depend on it.
  - [x] Subtitle export (`.srt` and `.vtt`), added on request outside spec 0001.
        Rendered from the same document, so the captions carry the same post cut
        timing and drop straight beside the exported MP4. JSON stays the b-roll
        handoff; the subtitle formats cannot carry the frame rate, the word
        confidence, or the provenance the planner needs.
  - [x] Migration, now governed by spec
        [0002](../../specs/broll/0002-data-model/index.md). **Unblocked
        2026-08-08**: the column inventory the lost `broll-generator-spec.md` was
        meant to supply is reconstructed there, marked Decided or Inferred row by
        row so a later reader can tell evidence from invention. All three sub
        boxes closed; `db:verify` passes against the dev branch, which is the one
        b-roll now reads. The later enum migration `0016` belongs to Phase 2, not
        here: see `_root` feature 6.
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
- [x] Verify it: /check verify broll skeleton. **Closed 2026-08-10.** A runtime
      pass on 2026-08-06 drove the real server: the auth gate holds, the document
      path holds (the package was driven through its public export, and ten real
      projects built clean), and the cross origin preflight now answers correctly
      after the `proxy.ts` fix above.

      **What closed it: the local database stopped being production.** The
      blocker was never the code. `apps/broll/.env.local` pointed at the
      production Neon branch, so nobody could click through the intake without
      writing real rows, and the success path stayed unproven for four days
      because of it. Repointed to the dev branch (`ep-holy-hall-aoe13azt`), which
      already carried migration `0015` from its rehearsal. Sign in provisions the
      `users` row on its own, so no seeding was needed.

      The engineer then drove the upload path in the real app and the feature's
      **Done when** is met: project `0620`, runtime 9:46, 254 parsed segments on
      screen. Every displayed field was traced back to the stored row on the dev
      branch rather than trusted: `duration_ms` 586800, 254 segments in the
      document, `fps` null, `wordsAligned` false, `source.kind` `import`,
      `source_project_id` null, transcript 10 kB.

      Two runtime facts worth keeping. Automated checks on 2026-08-10 confirmed
      the b-roll gate (`/dashboard` 307 to sign in, `/api/*` 401 as JSON not a
      redirect) and AC-15 on rough-cut's route (b-roll origin 204 naming that
      exact origin with credentials, any other origin and a missing one 403, GET
      signed out 401). See spec
      [_root/0001 verify.md](../../specs/_root/0001-transcript-contract/verify.md),
      where AC-1, AC-2, AC-15 and AC-16 are now ticked with their evidence.

      **Still unverified, and now for one reason only:** the Ruff Cut handoff
      cannot be driven locally. Not the foreign key, which was the first guess:
      the dev branch has **zero** rough-cut projects carrying a transcript, an
      EDL and stored fps columns, so there is nothing the route would serve even
      if the insert were allowed. The export modal is unverified too (it needs
      sign in plus a local video reselect). Both paths shipped and are covered by
      unit tests; what is missing is a live click, not a working implementation.
- [x] Test it: /test broll skeleton. Done 2026-08-10. The pure logic here (frame
      math, the collapse, the parsers) is exactly what this workspace's Workflow
      line says carries unit tests, so this box was not optional even at Alpha.
      `@repo/transcript` (96), `transcript-collapse` and the rough-cut transcript
      route were already covered; this pass closed the four that were not. B-roll
      went from 5 tests to 54: `actions.ts` (both intake paths, the gate, the
      validation, and every status Ruff Cut can answer), `projects.ts`, and
      `proxy.ts`. Rough Cut gained 13 on `transcript-document.ts`, which was
      untested while its sibling `transcript-collapse.ts` was not.

      **One gap the tests found, not yet fixed.** Text with no cues in it is not
      a parse failure: `importSrt` finds zero cues, and `documentFromCues` turns
      zero cues into a valid document with no segments and duration 0. So a user
      who picks the wrong file gets a successfully created, silently empty
      project rather than being told. The document contract genuinely permits
      zero segments — the export path relies on it, since a project with
      everything cut still exports a valid empty document — so the parser cannot
      tell "empty subtitle file" from "not a subtitle file". The check that
      could belongs at the intake boundary in `actions.ts` and does not exist.
      Current behaviour is pinned by a test named so it cannot be deleted
      quietly.

**Decision debt carried by this feature** (all from spec 0001's own follow up
list, none blocking the boxes already ticked):

- The byte cap and the segment count cap are placeholders sized by arithmetic, not
  measured against a real ten minute transcript. Two named constants in
  `packages/transcript/src/document.ts`.
- `verify.md` for the b-roll high level design still states AC-11 in its
  unbuildable form (it asks a package to import from an app). Spec 0001 records
  the corrected wording; the older file has not been amended.
- ~~Before b-roll actually fetches a transcript across origins, confirm that
  Clerk's session cookie travels on a credentialed cross origin fetch.~~
  **Closed 2026-08-08 by taking the other path.** The question turned out to be
  unanswerable locally and coupled to a decision nobody had connected to it:
  `localhost:3000` and `localhost:3003` are different *origins* but the same
  *site*, and `SameSite` is site based, so no local test says anything about
  production. Which production behaviour applies depends on the domain b-roll
  gets: a subdomain of `myfirstcut.app` would be same site, its own domain is
  cross site. The engineer confirmed b-roll gets **its own domain**, so the
  browser fetch would have depended on a Clerk setting outside our control. The
  handoff was built server to server instead, which is immune to all of it. The
  coupling between the domain choice and the handoff design is the part worth
  remembering; the high level design does not mention it.

- **Segment granularity differs by intake path, and Phase 3 depends on it.**
  Measured 2026-08-08 across the two paths on real transcripts: a Ruff Cut
  handoff gave **33 segments over 6:35** with 1034 word timings and an exact
  30/1 frame rate, while an uploaded SRT gave **228 segments over 8:12** with no
  word timings and no frame rate. Roughly 12 seconds per segment versus 2. Both
  are correct: `@repo/transcript` says a document's segments run one whole
  utterance long, which is the planner's unit, and the subtitle importers keep
  each cue's own timing rather than inventing merged boundaries. But the planner
  assumes the utterance shape in two places, its `ceil(runtime × 1.2)` scene
  target and the Scene Studio's "identifiable source line". A caption cue reading
  "was the deadline" identifies nothing. ~~Decide in Phase 3 whether the planner
  copes, or whether an import merges cues into utterances before planning.~~
  **Decided and built** as AC-48, in
  [apps/broll/src/lib/utterances.ts](../../../apps/broll/src/lib/utterances.ts):
  an import merges, and it merges in b-roll rather than in `@repo/transcript`,
  so the stored document still carries the file's own cues and only the
  planner's view is merged. Confirmed by reading the module on 2026-08-16 — this
  line had stayed open long after the code closed it, which is how it ended up
  on a list of things still to build. Two constants there are genuinely still
  unmeasured and are the real remainder: `UTTERANCE_GAP_MS` (700ms) and
  `SCENES_PER_MINUTE` (1.2), both tunable only against a live run.

**Bigger than the spec implies.** This phase carries a shared package extraction, a
new export surface in a *different* app, and two shared-schema migrations. Budget
accordingly.

**Blocked on nothing to finish building; blocked on a domain to deploy.** The
original wording said the app "cannot deploy without one", which is true, and
then that was read as blocking the phase, which it was not. Everything in Phase 1
is built and running locally. What the domain gates is the production deploy:
registering b-roll as a satellite in Clerk's Dashboard, and the throw at import
`env.ts` convention. Two more things follow it and neither is code: a fourth
Vercel project, and adding that project's build to branch protection **by hand**,
since that list lives in GitHub settings and has silently stopped gating once
before.

## Phase 2

### 3. Character pipeline · in-progress

**Intent**: Photo to a reviewed set of transparent character PNGs in object
storage, paid for correctly.
**Done when**: a user generates an emotion set, reviews it, and the assets are
stored — with credits reserved and settled, and no double charge on a double-click.

- [x] Design it (spec)
      [0004](../../specs/broll/0004-character-pipeline/index.md), 2026-08-10.
      One streamed Edge route chains six Gemini turns, each anchored on the
      previous output image, and hands every result to the browser, which cuts
      the background out, trims it and uploads it straight to storage. Money is
      reserved before the first call and settled only once all six assets exist.
      **The spec reconstructs the lost `broll-generator-spec.md` §8.1**: the
      prompt text is written down for the first time, and it has never been run.
      Cross checked on a second model, which found eleven gaps, all real. Four
      were load bearing: the prompt text was missing entirely, the commit route
      took a client supplied storage path that could point at another user's
      object, nothing persisted a regenerated variant, and the regeneration cap
      contradicted the paid re-run so a $2 purchase burned half the free
      allowance. All fixed; the reasoning records what changed.
- [x] Build it: /develop character pipeline (AC-14 to AC-22, AC-61 to AC-74).
      Started 2026-08-10, all eight of spec 0004's build plan tasks landed
      2026-08-11. Code in
      [apps/broll/src/lib/](../../../apps/broll/src/lib/) (`asset-path.ts`,
      `storage.ts`, `segmentation.ts`, `character-prompt.ts`, `character.ts`,
      `assets.ts`, `trim.ts`),
      [apps/broll/src/app/api/](../../../apps/broll/src/app/api/) (the four
      character routes, the blob upload route and the sweep cron) and
      [apps/broll/src/app/dashboard/[id]/character-panel.tsx](../../../apps/broll/src/app/dashboard/%5Bid%5D/character-panel.tsx).
      Lint, typecheck and test green, and `next build` compiles every route;
      b-roll went from 170 tests to 287. No migration: every column this feature
      uses shipped in `0015`/`0016`.

      **~~Built, gated, and never once run against the real vendor.~~ Overtaken
      by events, and struck through rather than deleted because the reasoning
      around it still reads as if it were true.** When this was written it was
      correct: the whole suite mocks `fetch`, and no local run had had an image
      capable `GEMINI_API_KEY` or a connected Blob store pointed at it. **The
      engineer has since driven this pipeline against live Gemini and it works,
      confirmed 2026-08-16.** So the prompt wording spec 0004 reconstructed has
      been run and produces usable output, and so has the segmentation on real
      images.

      What is still owed is narrower than "unverified" and worth naming exactly:
      nobody has walked
      [verify.md](../../specs/broll/0004-character-pipeline/verify.md) criterion
      by criterion and recorded the evidence, so the two that fail **silently**
      are the ones still worth a deliberate pass — AC-22 (the reference photo
      exists in no blob, no column and no log line) and AC-61 (the capability
      probe refuses a browser that cannot segment before any money moves).
      Neither of those announces itself while the happy path works.

      **One decision the spec left open, settled during the build and worth
      ratifying.** AC-16 asks the ledger row to carry the Gemini call's real
      reported usage, and the value sourcing table says "usageMetadata summed
      across the six responses" — but `usageMetadata` is tokens and
      `cost_micros` is money, and no rate in this repo converts one to the
      other. The engineer chose to price it by **images actually generated**, at
      a named `IMAGE_OUTPUT_COST_MICROS` of 134,000 taken from the same Pro tier
      $0.134 figure `BROLL_CHARACTER_SET_COST_MICROS` is already built from. So
      a retried turn genuinely costs more than a clean run, and no token rate
      was invented. The figure crosses the stream-to-commit request boundary
      through the browser and is clamped server side; that is safe only because
      `cost_micros` is margin reporting with no balance effect, and the clamp
      test says so.

      **One addition to `@repo/billing`**, because a free regeneration still has
      to be the only writer on the project (AC-72) and `gen_claim_at` is the
      money path's column: `claimBrollGeneration` takes the claim with a **zero**
      hold and writes no ledger row, and `releaseBrollClaim` lets it go. Zero
      rather than NULL is load bearing — `settleBrollHold` and
      `reclaimStaleBrollHold` both qual on `hold_micros IS NOT NULL` and both
      guard their refund insert with `held <> 0`, so the existing release paths
      already handle it with no new SQL, while a NULL hold would be invisible to
      the stale reclaim and would strand the project forever the first time a
      regeneration crashed.
  - [x] Storage seam, server minted paths, and the capability probe that refuses
        a browser which cannot segment **before** any money moves (AC-17, AC-61,
        AC-70). The pathname module is the security piece: it validates the whole
        shape rather than a prefix, so traversal is impossible by construction
        rather than filtered, and the upload route re-derives and re-checks the
        project even though the generate route minted the path. `@vercel/blob`
        2.7.0's signed URL API was verified against the installed types, not the
        docs, before anything was built on it.
  - [x] The prompt module and the thin thread: one turn, end to end through
        Gemini, segmentation, trim, upload and a visible stored asset (AC-67,
        AC-19, AC-74, AC-18, AC-20). `character-prompt.ts` carries the
        reconstructed §8.1 verbatim, and `character-prompt.test.ts` asserts
        AC-74 by checking the style phrases appear in turn 1 and in none of the
        five that follow, which is what makes the identity mechanism a fact
        rather than an intention. The thread itself was built as the whole chain
        rather than one turn, because a one turn version would have needed a
        second pass over the same route to become six. `trim.ts` splits the
        geometry out as a pure function so the off by one that would shave the
        character's outermost column is unit tested without a canvas, and so is
        the alpha floor: trimming at `> 0` keeps segmentation's low alpha halo
        and silently trims nothing at all, which is the failure mode that looks
        like success.
  - [x] The full six turn chain and the money boundary: streaming, retry once
        then abort, reserve, the idempotent commit, settle (AC-21, AC-62, AC-14,
        AC-15, AC-16, AC-63, AC-71). The route tests assert **order**, not
        output, because that is what costs money when it regresses: the rate
        limit and the reserve both land before any Gemini call, a second
        concurrent Generate gets 409 rather than a second charge, and a chain
        that gives up settles as failed with no variant line ever emitted. The
        commit route carries one gate the spec asked for and the first draft
        would have missed: a `set` commit whose hold was already reclaimed
        answers 409, because storing those images would hand over a set the user
        has already had their money back for.
  - [x] The review gate and the remaining edges: per variant regeneration and
        its cap, the claim gate, the paid re-run, rate limits, the photo copy,
        the orphan sweep, and the photo audit (AC-64, AC-69, AC-72, AC-65,
        AC-66, AC-68, AC-73, AC-22).

        **The photo audit found one real thing.** Nothing writes the photo to
        storage, to a column, or to a log line — but `character.ts` logs the
        vendor's error body to help diagnose a rejected call, and turn 1's
        request carried the photo. Google's error bodies are JSON error objects
        rather than echoes, so nothing leaks today; that is an assumption about
        someone else's API, not a property of ours, so `redactImageData` now
        strips any long base64 run before the body is logged and a test pins it.

        **And one latent one, recorded rather than fixed:** `apps/broll` has no
        Sentry init at all (no `instrumentation.ts`, no `sentry.*.config.ts`), so
        `reportError` forwards to a no-op here. Whoever wires Sentry into this
        app must keep request body capture off, or a multipart body carrying a
        face photo reaches Sentry on any error thrown during a generate request.
        AC-22 would break with nothing failing.
- [ ] Verify it: /check verify character pipeline. **Runnable since 2026-08-12**,
      when the two vendor preconditions were met. Both were discovered by trying
      on 2026-08-11 rather than by reading docs, and both stay written down
      because the next person to set this up hits them again. First, every Gemini
      image model's free tier quota is literally `0`, so a key without billing
      enabled on its Google Cloud project answers 429 with
      `free_tier ... limit: 0` and no model id avoids it (`gemini-3-pro-image`,
      `gemini-3.1-flash-image` and `gemini-2.5-flash-image` were all tried, all
      429). Second, the Blob store must be created **private** and must be a
      **different store from Ruff Cut's**: access cannot be changed after
      creation, every read here is a signed URL that a public store would make
      meaningless, and pasting Ruff Cut's public token here would appear to work
      while handing out permanent unauthenticated links to generated faces. Both
      are recorded in [apps/broll/AGENTS.md](../../../apps/broll/AGENTS.md). The
      criteria are written and waiting in
      [verify.md](../../specs/broll/0004-character-pipeline/verify.md), including
      five added by the build; none are ticked yet.

      **This run costs real money and that is the point.** A full set is six
      images at the Pro tier, and the judgement it exists for cannot be automated:
      look at identity across all six emotions and at the cutout edge at high
      zoom, then revise the prompt wording in spec 0004 before the price goes
      live. AC-22 and AC-61 are the two worth the most care, because both fail
      silently: the photo criterion breaks by a file simply starting to exist
      somewhere it should not, and the capability probe breaks by charging someone
      two dollars for a run their browser could never finish.
- [ ] Test it: /test character pipeline. **Two coverage holes are already known,
      so this box has a named starting point rather than a survey.** Four modules
      have no tests at all: `segmentation.ts`, `assets.ts`, the signed URL route,
      and the sweep cron. And the claim pair added to `@repo/billing` for this
      feature is uncovered, which is tracked on the `_root` side: see
      [_root feature 6](../_root/scope.md).

Self-contained and demoable alone.

**Two corrections owed to the specs, which `/architect` owns and `/scope` does
not edit.** Spec [0004](../../specs/broll/0004-character-pipeline/index.md)
requires `BLOB_WEBHOOK_PUBLIC_KEY` as provisioned configuration and no such
Vercel variable exists: measured 2026-08-11 against a project that has had a Blob
store connected for a month, which holds exactly one blob variable. The route
works around it with an inert key and by rejecting `blob.upload-completed`
outright. Separately, the cost derivation settled during the build (pricing by
images actually generated at `IMAGE_OUTPUT_COST_MICROS`, not by token usage) is a
build time decision that the spec's value sourcing table still contradicts. Both
are written down in [apps/broll/AGENTS.md](../../../apps/broll/AGENTS.md) and in
the verify page; neither is in the spec itself.

**Storage is Vercel Blob for now, and that is a deliberate deviation.** Spec
[0001 §5.3](../../specs/broll/0001-high-level-design/index.md) chose R2 and its
reasoning still holds; the engineer chose Blob temporarily pending a conversation
with the client. Verified during the 0004 design and it is worse than §5.3 knew:
Hobby has no overage, exceeding the limit blocks Blob access for thirty days,
Ruff Cut's audio uploads run through Blob on the same account, and a separate
store does not help because the quota is not per store. The swap is contained
behind `apps/broll/src/lib/storage.ts`. **The client conversation blocks general
availability, not this build.**

**One finding that lands outside this feature.** Google now labels the
`generateContent` image and text path Legacy and recommends the Interactions API,
with no deprecation date given. Spec 0003's rationale §3 concluded the opposite
from the docs as they read then, so the planner's pinned decision is worth a
re-read too. Nothing is broken and nothing needs changing today.

**Priced 2026-08-09, tentative pending client review:** a character set is $2.00
and a plan re-run is $0.25, both flat and both env-overridable. The price is set
to be healthy at the **Pro** image tier, which is the one Phase 0 actually
measured, so this phase can start without waiting on the `gemini-3.1-flash-image`
A/B — run that A/B inside this phase instead. Working and the regeneration cap in
spec [0001 §8.1](../../specs/broll/0001-high-level-design/index.md).

**Two things spec [0002](../../specs/broll/0002-data-model/index.md) surfaced
that land here, not in Phase 1.** The `credit_ledger_reason` enum values ship in
their own later migration, because Postgres will not let a value added in a
transaction be used in that same transaction (AC-44). And the money statements
themselves are not a small addition to `@repo/billing`: see the new `_root`
feature 6, which is where that work is tracked.

## Phase 3

### 4. Scene planner · in-progress

**Intent**: Turn a transcript into a ranked scene list that never invents a number.
**Done when**: the planner runs against real transcripts, the multiplier is tuned
against evidence, and the validator provably rejects fabricated charts.

- [x] Design it (spec)
      [0003](../../specs/broll/0003-scene-planner/index.md), 2026-08-10. One
      streamed `generateContent` call on a pinned `gemini-3.6-flash`, with every
      chart value traced in code back to character offsets in the span the model
      cited. Cross checked on a second model, which found two money bugs the
      first draft carried: a charge landing while the write failed, and a claim
      that the idempotency key stops a double charge when it only stops a double
      retry. Both fixed; the reasoning records the correction.
- [ ] Build it: /develop scene planner — built 2026-08-10, everything except the
      selectivity tuning. Code in
      [apps/broll/src/lib/](../../../apps/broll/src/lib/),
      [apps/broll/src/app/api/projects/[id]/plan/route.ts](../../../apps/broll/src/app/api/projects/%5Bid%5D/plan/route.ts)
      and
      [apps/broll/src/app/dashboard/[id]/plan-panel.tsx](../../../apps/broll/src/app/dashboard/%5Bid%5D/plan-panel.tsx).
      Lint, typecheck and test green; b-roll went from 54 tests to 170. Spec
      [0003](../../specs/broll/0003-scene-planner/index.md)'s build plan tasks 1
      to 10 are done, task 11 is not.
  - [x] Merge and contract: cue to utterance merge, plus the Zod scene schema
        the prompt's shape section is generated from (AC-48, AC-23). The
        `responseSchema` is generated from the Zod schema by `z.toJSONSchema`
        rather than written by hand, so a field added to the schema changes the
        model contract with no prose to keep in step — asserted in
        `scene-schema.test.ts`, which is what makes AC-23 a fact rather than an
        intention.
  - [x] The thin thread: the route calls Gemini, parses scene by scene, writes
        the scenes, and a Plan button plus a read only list makes it visible end
        to end (AC-24, AC-50, AC-56, AC-57, AC-58, AC-60)
  - [x] Stream it: Edge runtime, phase lines, heartbeat, terminal line, one
        idempotency key per run (AC-52, AC-59)
  - [x] The guarantees: the honesty trace that drops an untraceable chart but
        keeps its scene, and the atomic replace that keeps manual scenes
        (AC-54, AC-51)
  - [ ] Money, limits and staleness: charge, refund on zero committed scenes,
        the token cap before charging, the rate limit, the model error
        translation, the stale fingerprint warning, and the selectivity tuning
        run against project `0620` (AC-25, AC-53, AC-55, AC-26, AC-27, AC-49,
        AC-28). **Everything here is built except AC-28.** The tuning is a
        measurement, not code: it needs one real run against `0620` with a live
        `GEMINI_API_KEY` to say whether `1.2` scenes per minute survives contact
        with real speech. Until it runs, `SCENES_PER_MINUTE` stays a guess that
        happens to be implemented.
- [ ] Verify it: /check verify scene planner. **Runnable since 2026-08-12**, by
      the same unblock that cleared feature 3. Run the two in one sitting: the
      planner needs a live `GEMINI_API_KEY` and nothing else, and AC-28's
      selectivity tuning against project `0620` is the box that has been waiting
      on it. Until that measurement lands, `SCENES_PER_MINUTE` at `1.2` is a
      guess that happens to be implemented.
- [ ] Test it: /test scene planner

**The decision that gated this is settled, and narrower than it looked.**
`generateContent` stays. Rationale §3 called it deprecated, inferred from a 404
body; Google's current docs do not say that, and `generateContent` "is also
supported" with no timeline. What actually decided it was AC-23: the prompt's
shape must come from the schema, `responseSchema` is the documented way to do
that, and the Interactions API does not yet document an equivalent.

## Phase 4

### 5. One template end to end · in-progress

**Intent**: Prove the whole spine — plan to composited scene to downloadable MP4 —
on exactly one template.
**Done when**: `chart-full` renders one scene to a file a creator can drag into an
NLE.

- [x] Build it: /develop chart-full end to end (AC-29 to AC-34). Landed
      2026-08-12 in PR #141, in two halves. The pure half first, so it runs under
      vitest rather than only in a browser: `clip-filename.ts` (AC-33),
      `chart-label.ts` (AC-34) and `capability.ts` (AC-29). Then the drawing and
      the encode: [apps/broll/src/lib/render/](../../../apps/broll/src/lib/render/)
      and [apps/broll/src/workers/render-worker.ts](../../../apps/broll/src/workers/render-worker.ts),
      with the button in
      [render-scene-button.tsx](../../../apps/broll/src/app/dashboard/%5Bid%5D/render-scene-button.tsx).
      Frames are drawn to an `OffscreenCanvas` and handed straight to the
      encoder, which is exactly the path Phase 0's spike de-risked.

      Three things the build settled that are worth carrying. `clip-filename.ts`
      derives its timecode from `formatTimecode` in `@repo/transcript` rather
      than doing the minutes arithmetic locally, because a clip labelled 2:35
      belonging at 2:35 is the whole product promise and a second implementation
      of that rounding is what the repo rule forbids. Writing its test taught us
      the rule rounds to the nearest frame rather than truncating, so a label
      crosses a second at the half frame; the test documents that now. And AC-29
      is checked **at load**, in front of the spend rather than in front of the
      encoder, which is what its wording actually asks for.
- [ ] Verify it: /check verify chart-full end to end

Deliberately narrow. Everything after this is repetition rather than discovery.

## Phase 5

### 6. Remaining templates + Scene Studio · in-progress

**Intent**: The review UI, and the five templates that make the output worth
shipping.
**Done when**: a user can review, override, exclude, and manually add scenes.

- [x] Design it (spec)
      [0005](../../specs/broll/0005-scene-studio/index.md), 2026-08-13. Written
      after part of the feature had already shipped, which is why it both records
      the build's own reasoning and corrects it. **The rule is one line:
      presentation is editable, claims are not.** A creator may change a scene's
      template, emotion, caption and inclusion, and may add and delete their own
      scenes; chart values and timings are never writable, because both are traced
      back to the transcript and editing them would let someone publish a number
      the app had just refused to invent. The shipped build reached that answer
      through a wider test and locked presentation too.

      Cross checked on a second model, which found eleven gaps, two load bearing,
      both verified against the code before being accepted. The serious one was
      self inflicted: the plan re-run warning counted `overlay_text` and
      `included` as proxies for "the creator edited this", and both are false. The
      planner writes the model's caption at plan time, and AC-85 in this same spec
      makes the planner write `included = false` for surplus scenes. A creator who
      restyled ten scenes would have been told nothing was at risk immediately
      before a re-run deleted all of it. `user_edited_at` now records the fact
      rather than inferring it, which is why the migration carries two columns.
- [x] Build it: /develop scene studio. Finished 2026-08-13 against spec
      [0005](../../specs/broll/0005-scene-studio/index.md); the first two
      changes had shipped ahead of that spec, both 2026-08-12.
      PR #142 added the `character-center` and `text-card` templates, taking the
      reference project from 4 of 12 scenes renderable to 11 of 12; the one left
      is a `chart-full` scene whose chart the honesty check dropped, which is a
      data outcome rather than a missing renderer. PR #143 made the plan
      editable: exclude a scene, and override the burned in caption. Code in
      [apps/broll/src/lib/render/](../../../apps/broll/src/lib/render/),
      [scenes.ts](../../../apps/broll/src/lib/scenes.ts), the
      [scene PATCH route](../../../apps/broll/src/app/api/projects/%5Bid%5D/scenes/%5BsceneId%5D/route.ts)
      and
      [scene-overrides.tsx](../../../apps/broll/src/app/dashboard/%5Bid%5D/scene-overrides.tsx)
      plus [scene-preview.tsx](../../../apps/broll/src/app/dashboard/%5Bid%5D/scene-preview.tsx).

      **Four overrides now, and still not the two that matter.** The build of
      2026-08-12 allowed exactly two and called that a product rule; spec 0005
      found the rule was drawn in the wrong place and widened it. A creator may
      now also change a scene's template and its emotion, because neither
      carries a claim. What stayed locked is what the original reasoning
      actually justified: a scene's timings come from the utterance it cited,
      and its chart only exists because the honesty check traced it back to the
      transcript. Both are measured rather than proposed, and making either
      editable would let a creator put back a number the app had just refused to
      invent. The lock is now a property of the route's shape rather than of a
      list someone has to keep current: the PATCH schema names four fields and
      rejects any body carrying another.

      **The rest of the build, 2026-08-13.** Migration `0017` adds
      `chart_rejection_reason` and `user_edited_at`, both nullable, applied to
      the dev branch and confirmed live by querying
      `information_schema.columns`, not by reading the migration file. New code
      in [scene-templates.ts](../../../apps/broll/src/lib/scene-templates.ts),
      [citation.ts](../../../apps/broll/src/lib/citation.ts), the
      [scenes POST route](../../../apps/broll/src/app/api/projects/%5Bid%5D/scenes/route.ts),
      [add-scene.tsx](../../../apps/broll/src/app/dashboard/%5Bid%5D/add-scene.tsx)
      and
      [scene-citation.tsx](../../../apps/broll/src/app/dashboard/%5Bid%5D/scene-citation.tsx).
      B-roll went from 433 tests to 456; lint, typecheck and the full repo suite
      are green and `next build` compiles both scene routes.

      **Two things the build settled that the spec did not.** The chart
      rejection reason is attributed to a scene **at assembly**, inside
      `assembleScene`, rather than matched back afterwards by `utteranceIndex`
      as the spec describes. That is strictly stronger and cannot mis-attach:
      the scene being assembled is the one whose chart was dropped, whereas an
      `utteranceIndex` match is ambiguous the moment two scenes cite the same
      line and both lose a chart. And `citation.ts` matches figures literally
      while the honesty check accepts word forms, so a chart citing "three
      times" is drawn and traced but its number is not emphasised. That is
      deliberate: the highlight is presentation and decides nothing, and
      underlining a word as a figure reads more into the sentence than the
      offsets support.

      **Two tests corrected the code rather than confirming it**, which is worth
      recording because both had been passing for the wrong reason.
      `fitTextSize` derived its size range from the margin inset box while the
      theme documents those ratios as shares of frame height, so every text card
      rendered smaller than specified. And the test recorder's `measureText`
      charged a tenth of an em per character, so nothing ever wrapped and the
      wrapping and shrinking paths were never exercised at all. A `coverHeight`
      fitting mode added for the full bleed character was then deleted: the test
      proved a portrait cutout in a landscape frame is already height bound
      under `contain`, so the two modes are identical for every image this app
      can generate.
  - [x] The four renderers, the two overrides that shipped (exclude and caption),
        and the live preview canvas. PRs #142 and #143.
  - [x] Migration (`chart_rejection_reason`, `user_edited_at`) plus the editable
        presentation set: the PATCH route on a closed field list, the per scene
        template picker, `visual_type` derived server side, `emotion` cleared off
        a character template, and every write stamping `user_edited_at`
        (AC-75, AC-76, AC-77, AC-78, AC-87, AC-92, AC-93). Migration `0017`,
        applied to the dev branch only; production has no b-roll rows and no
        deploy yet, so it is applied there with the rest of feature 8.
  - [x] Manual scenes: create from a picked transcript segment, delete restricted
        to `origin = 'manual'`, the per project cap evaluated inside the insert,
        and the new fail closed limiter (AC-79, AC-80, AC-81, AC-82, AC-83,
        AC-91). **The cap is narrower than AC-82 claims, and the code says so
        rather than the comment repeating the claim.** The count is a subquery
        of the insert, so no read then write race exists, but under Postgres'
        default read committed isolation two inserts overlapping inside one
        statement's execution can still both see the same count. What this
        closes is every race longer than a statement, which is the shape a
        double click and a retried request take. The Neon HTTP driver gives each
        statement its own transaction, so there is no wider one to serialize
        them in, and a lost race costs one extra row on a path that spends
        nothing.
  - [x] The surplus rule at plan time: rank by strength, keep the planner's own
        target count, uncheck the rest (AC-85). Unchecked, never dropped: the
        model overshooting the target is not evidence the extras are bad, only
        that the creator should choose.
  - [x] The review reads and the three gates: strength on every row, the cited
        quote with its figures highlighted, the per scene downgrade note, preview
        on hover, the re-run warning, and the export gate when nothing is included
        (AC-84, AC-86, AC-88, AC-89, AC-90). The dropped chart count now comes
        from the column rather than from the last run's response, so the
        product's central promise survives a page reload, which was the whole
        reason that column exists.
- [ ] Verify it: /check verify scene studio, against
      [verify.md](../../specs/broll/0005-scene-studio/verify.md). Nothing there
      needs a vendor key or spends money, unlike features 3 and 4.
- [ ] Test it: /test scene studio

**Read rationale §2.9 before starting.** Scene Studio is a live preview canvas
beside editable overrides, which is exactly the shape that produced Phase 0's two
worst rendering bugs. **This was read, and it applied.** Both bugs now have
guards in `scene-preview.tsx`: the transform and alpha reset before every
repaint, and the render loop mounts once and reads the scene through refs, since
listing an editable field in its dependencies tears the loop down on every
keystroke and React's dev double invoke then leaves two loops on one canvas.

## Phase 6

### 7. Batch export, zip, credits · in-progress

**Intent**: Turn a reviewed scene list into a folder of files, and close the
billing loop.
**Done when**: a user exports a batch, retries a single failure, and tops up
through the Wallet without leaving the workflow broken.

- [x] Build it: /develop batch export (AC-35, AC-36). Landed 2026-08-12 in
      PR #142: render every scene in one go and download them as a zip. Code in
      [batch-export.tsx](../../../apps/broll/src/app/dashboard/%5Bid%5D/batch-export.tsx),
      [zip.ts](../../../apps/broll/src/lib/render/zip.ts) and
      [run-render.ts](../../../apps/broll/src/lib/render/run-render.ts). This is
      the step the product description actually names: until now a creator
      pressed twelve buttons and hunted twelve files out of Downloads.

      **AC-32 is the criterion this feature exists for, and it holds**: a run
      where the fourth clip fails still hands over the other eleven and offers to
      retry just that one, with its error shown. Finished clips are held between
      runs so the retry zips alongside them, and clips are zipped in plan order
      rather than completion order so the archive reads like the timeline.

      **AC-35 and AC-36 are both satisfied, but by absence rather than by new
      code, so they are worth stating plainly.** Nothing in the render or export
      path touches the ledger, so rendering and downloading debit nothing
      (AC-35). The Wallet top-up deep link already existed on the project list,
      and this app still contains no Stripe integration at all (AC-36). Neither
      has been driven live.
- [ ] Verify it: /check verify batch export

## Phase 7

### 9. Scene Studio screen design · in-progress · Alpha · Journey

Enrolled by `/scope` on 2026-08-13, from the engineer looking at the screen and
not liking it. That is a legitimate way for a feature to arrive, and this one was
predicted: the UI brief
([design-prompt.md](../../specs/broll/design-prompt.md) B4) calls Scene Studio
"the core screen, design this one most carefully", then leaves its central
question open for whoever designs it, and nobody ever did.

> Key layout question to solve, the user is scanning 10 to 20 scenes and needs to
> judge each in about two seconds. The source line is what makes a scene
> identifiable, so it cannot be truncated into uselessness. Consider a list and
> detail split rather than a grid of equal cards.

So this is not polish and it is not a rewrite. Feature 6 settled **which fields a
creator may change** and built every one of them correctly. It settled nothing
about **composition**, so what shipped is every control the criteria asked for,
stacked vertically inside one list item. Functionally complete, visually a form.

**Intent**: Make the core screen scannable, so a creator can judge twenty
proposed scenes at about two seconds each and change the ones that are wrong,
without the screen fighting them.

**Done when**: a creator can open a planned project, scan every scene and tell
at a glance which are strong, which are excluded and which were downgraded to
text, open one and change it, and reach export, all without scrolling past
anything that is not helping them decide.

- [x] Design it (spec) [0006](../../specs/broll/0006-scene-studio-layout/index.md)
- [x] Build it: /develop scene studio layout. All six of spec 0006's Journey phases
      landed 2026-08-14. Lint, typecheck and the full repo suite are green (456 tests,
      unchanged: this is a recomposition, and every module it moved kept its own
      tests), and `next build` compiles `/dashboard/[id]/scenes` as a route. New code
      in [apps/broll/src/app/dashboard/[id]/scenes/](../../../apps/broll/src/app/dashboard/%5Bid%5D/scenes/)
      plus [scene-strength.ts](../../../apps/broll/src/lib/scene-strength.ts) and
      [render/to-renderable.ts](../../../apps/broll/src/lib/render/to-renderable.ts).
      No migration and no new API route, exactly as AC-113 requires.

      **Nothing here had been watched running when this was written on
      2026-08-14.** The whole feature is "does this read well", which is the one
      question a unit test cannot answer and `/check verify` can. Treat every
      claim below as "built and typechecking" *as of that date* — see the
      correction at the top of this file before concluding it is still unseen,
      and ask rather than assuming.

      **`plan-panel.tsx` and `batch-export.tsx` are gone as files while all of their
      behaviour survives**, so the diff reads much larger than the change is. The
      stream reader, the price confirm, the re-run warning, the one at a time render
      loop, the retry set and the zip builder were all moved, not rewritten.

      **One real behaviour change is hiding in the recomposition, and it is the
      point.** The single scene render button used to construct its own `Worker`
      beside a batch that owned another, so pressing it during "Render all" put two
      encoders on one laptop — which is precisely what the batch was built to avoid.
      Both entry points now enqueue into one `use-render-queue` hook owned by the
      shell, so one encode at a time is a property of there being one queue rather
      than of nobody pressing two buttons (AC-117).
  - [x] **The scan.** The route at `/dashboard/[id]/scenes`, the two pane shell, the
        bar, the row (timecode, source line, strength meter, markers, still, include
        toggle), the filter chips, the project page card, and the parsed segments list
        retired (AC-94 to AC-100, AC-105, AC-112, AC-113). The row still is a canvas
        that draws **once per change of its inputs** and never starts a frame loop, so
        spec 0005's "at most one preview animates" stopped being a module level
        handshake anyone has to maintain and became a fact about the component tree.
        The 55 percent dim on an excluded row is gone: every state is now a word, and
        an excluded row reads as clearly as an included one (AC-99).
  - [x] **The single scene.** Selection with its URL parameter and its independence
        from the filter, the detail pane in its order, the existing controls moved in,
        the keyboard loop, and the provenance block including the manual scene case
        (AC-101 to AC-104, AC-107). Selection is **derived during render** rather than
        corrected by an effect, which is both what AC-103 asks for and what this
        repo's `react-hooks/set-state-in-effect` rule permits; the URL is kept in step
        with `history.replaceState`, because a server round trip per arrow key press
        would make a twenty scene pass unusable.
  - [x] **Add and export.** Add a scene from the bar into the detail pane with a
        searchable picker, the render queue lifted into the shell so one encode runs at
        a time, per row render state, and the zip (AC-106, AC-108, AC-109, AC-117).
        The picker searches the words **and** the timecode: on project `0620` the old
        control was a select holding 254 options, which is a scroll through the whole
        transcript to find one sentence.
  - [x] **The other paths.** The zero state, the locked list during a re-run, the
        freshness marker, the empty filter, the narrow window, and reduced motion
        (AC-110, AC-111, AC-114, AC-115, AC-116). A debounced caption is **settled**
        before a plan run starts rather than dropped, through a flush the shell holds
        a ref to — so the creator's last keystroke is saved instead of discarded to
        protect the run. And a re-run while clips are encoding is refused with a
        sentence saying why, not a disabled button that teaches nothing.
- [ ] Verify it: /check verify scene studio layout, against
      [verify.md](../../specs/broll/0006-scene-studio-layout/verify.md), written by
      `/develop` on 2026-08-14. **Close spec `0005`'s open boxes in the same pass** —
      its verify.md has every screen box unticked, and driving this screen once is the
      whole reason feature 9 was put ahead of them. Only the Re-run plan steps spend
      anything; everything else is free.

**Three things this feature owns, and one it must not touch.**

The list and detail split B4 asks for is the whole of it, and the two second
scan is the measure to design against rather than a nice sentence.

**The parsed segments list has to go, or become something.** It is the plain list
of every transcript line at the bottom of the project page, and it does nothing:
you cannot click it, filter it, or act on it. It is there because feature 2's
**Done when** was literally "see its parsed segments", so it was proof that
intake worked, in Phase 1, when the page held nothing else. It has outlived that.
On project `0620` it is 254 rows, and since the Add Scene picker shipped the same
segments are now listed twice on one page. Retiring it is the obvious call;
folding it into the add flow is the other one worth weighing.

**Where the chart citation belongs is a real product question, not a layout
one.** The brief's B5 describes a **chart confirmation step before render**, with
the quoted span and its highlighted figures as the centrepiece, because "a
fabricated statistic rendered as a clean bar chart gets published under the
creator's name". What shipped puts that citation inline on the scene row. Inline
or its own step is the decision, and it is the screen where this product's one
promise is actually cashed, so it is worth deciding deliberately rather than
inheriting from build order.

**What it must not touch: which fields are editable.** Spec
[0005](../../specs/broll/0005-scene-studio/index.md) settled that, and the rule
is one line: presentation is editable, claims are not. A redesign may move the
chart values control anywhere it likes, including nowhere, but it may never make
them writable. Same for a scene's timings.

**Why it runs before the verification it is queued in front of.** Feature 6's
`Verify it` came back BLOCKED on 2026-08-13 with every screen box unexercised,
and those boxes need a human sitting in front of this exact screen. Redesigning
first means driving it once. Verifying first means driving a layout that is about
to be replaced, then driving it again.

**Alpha, not the project default.** A layout redesign moves no money, changes no
schema, and adds no pure logic worth pinning in a unit test. The risk here is
"does it read well", which `/check verify` answers by watching it and a test
cannot answer at all. If the design turns out to need real logic (a virtualised
list, a filter, a sort), that logic earns its own tests and this tag is worth
revisiting.

**Journey, not the project default.** The value shows up only when one whole path
works: open a planned project, scan, judge, change one scene, export. A thin
slice through the layers buys nothing here, because every layer under this screen
is already built.

### 11. Character reuse across projects · in-progress

Enrolled by `/scope` on 2026-08-14, from the engineer noticing what the character
pipeline costs a returning creator. Today a character set belongs to exactly one
project and dies with it, so somebody who liked their character pays $2.00 again
on the next video for a face they already approved and already reviewed. That is
the kind of charge a user notices, and nothing in the plan covered it.

**Intent**: Let a creator use a character they already generated on a new
project, without paying for it twice and without reviewing it again.

**Done when**: starting a new project, a creator can pick a character set they
already own instead of uploading a photo, the scenes draw with it immediately,
and **no credit is charged for the reuse**. Generating a brand new set still
costs the full price.

- [x] Design it (spec)
      [0007](../../specs/broll/0007-character-reuse/index.md), 2026-08-14. A
      character becomes a row the **user** owns: a new `broll_characters` table,
      the six images hanging off it instead of off a project, and projects
      pointing at one. Reuse is attaching, and it is free. The storage path and
      the rule that authorizes every read and write move from the project to the
      character, which is the part worth the most care and the reason the whole
      first slice is one thread rather than an incremental add.

      **The design found one thing the enrollment notes did not list.**
      `claimBrollGeneration` claims the *project*, which serializes writers
      correctly only while a character belongs to one project. Once two share
      one, two regenerations of the same emotion race and the loser's image
      vanishes with no error, which is the exact failure AC-72 was written to
      prevent. So `broll_characters` carries its own `gen_claim_at` and a
      regeneration claims the character.

      Cross checked on a second model, which found nine things, seven of them
      real gaps now closed. The serious one was in a route the design was barely
      touching: `commit` returns early when the assets are already stored, and
      that early return sits **before** the new write that points the project at
      its character. A commit that stored and settled and then died would have
      left a paid for character with no project pointing at it, and every retry
      would have returned early without fixing it.
- [ ] Build it: /develop character reuse
  - [x] The ownership move, end to end: migration `0018`, the
        `broll/characters/` storage path and the upload route's authorization,
        the new `characters.ts` query module, and generate plus commit creating
        and filling a character (AC-118 to AC-120, AC-127, AC-128, AC-131,
        AC-139, AC-141 to AC-146). Landed 2026-08-14, code in
        [packages/db/drizzle/0018_character_reuse.sql](../../../packages/db/drizzle/0018_character_reuse.sql),
        [apps/broll/src/lib/characters.ts](../../../apps/broll/src/lib/characters.ts),
        `asset-path.ts`, `assets.ts`, `storage.ts`, the three character routes,
        the blob upload route, the sweep cron, and both project pages. The
        migration is applied to the dev branch and confirmed live; the 18 old
        asset rows and 19 stored objects are gone, which is about $6.00 of
        character sets the engineer agreed on 2026-08-14 to re-pay for rather
        than carry two pathname shapes through the security check.

        Task 3 of the spec's build plan is deliberately partial: rename,
        delete, the usage query and the claim pair are left for tasks 6 and 7,
        where their callers land. Four unused functions on the one path whose
        risk is a cross user read is worse than writing them beside their
        callers.
  - [x] Reuse: the picker at project setup and on a project with no character,
        the optional `characterId` on both server actions, the style copy on
        both paths, and attach (AC-121 to AC-126, AC-147, AC-148). Landed
        2026-08-14, code in
        [apps/broll/src/lib/characters.ts](../../../apps/broll/src/lib/characters.ts),
        [character-picker.ts](../../../apps/broll/src/lib/character-picker.ts),
        [ids.ts](../../../apps/broll/src/lib/ids.ts), the
        [character PATCH route](../../../apps/broll/src/app/api/projects/%5Bid%5D/character/route.ts),
        [actions.ts](../../../apps/broll/src/app/actions.ts),
        [dashboard/new/](../../../apps/broll/src/app/dashboard/new/) and
        [character-reuse.tsx](../../../apps/broll/src/app/dashboard/%5Bid%5D/character-reuse.tsx).
        B-roll went from 475 tests to 492; `next build` compiles both screens.

        **Reuse was free in the code and unwatched as of 2026-08-14, when this
        was written.** The queries were driven against the live dev branch with
        seeded rows (five of six stays hidden, the attach copies the style, a
        second attach refuses), but the branch held no real character, because
        migration `0018` deleted them all and generating one costs $2.00. That
        blocker is gone — a live character set has been generated since — so
        whether the reuse path itself has been driven is a question to ask
        rather than to infer from this paragraph.
  - [x] Regeneration on a shared character: the claim on the character, the
        affected projects named before it runs, and the paid re-run forking
        rather than replacing (AC-129, AC-132, AC-133, AC-149). Landed
        2026-08-14, code in
        [characters.ts](../../../apps/broll/src/lib/characters.ts) (the claim
        pair, the ten minute liveness rule and the usage query), the
        [character route](../../../apps/broll/src/app/api/projects/%5Bid%5D/character/route.ts)
        (a new `GET`, and the AC-149 refusal), the regenerate and commit routes,
        and
        [character-panel.tsx](../../../apps/broll/src/app/dashboard/%5Bid%5D/character-panel.tsx).
        B-roll went from 492 tests to 506.

        **The old claim pair was deleted from `@repo/billing`, not left beside
        the new one.** `claimBrollGeneration` and `releaseBrollClaim` claimed the
        *project* with a zero hold; they belonged in that package because
        `broll_projects.gen_claim_at` moves with `hold_micros`. The character
        claim touches no balance, so it lives beside the rows it protects, and
        the two are not allowed to coexist: a second unused claim implementation
        on a money path is the drift `@repo/billing` exists to end. Two lines of
        [packages/billing/AGENTS.md](../../../packages/billing/AGENTS.md) still
        describe the deleted pair, which `/sync` owns.

        **AC-129 turned out to need no new write, only honest copy.** Every run
        already creates a character before turn 1 and the commit already
        repoints only this project, so a paid re-run forks by construction. The
        confirm panel was the part that was wrong: it promised the run "replaces
        all six variants", which is the old model and the opposite of what
        happens now. It now names the character being left behind, and says
        which projects stay on it.

        **The claim and the usage query were driven against the live dev
        branch**, because no unit test proves an interval predicate runs on
        Postgres: claim, refusal, release, an eleven minute old claim taken over,
        another user refused, and the usage list answering one project and never
        a stranger's. Every seeded row was deleted afterwards. **Nobody has
        watched any of this in a browser**, which is `/check verify`'s box.
  - [x] The characters page: list with thumbnails, usage and allowance, rename,
        delete with the in use refusal, and detach (AC-134 to AC-137, AC-140).
        **The write half landed 2026-08-16**, closing AC-135, AC-136, AC-137 and
        AC-140. New code in
        [api/characters/[characterId]/route.ts](../../../apps/broll/src/app/api/characters/%5BcharacterId%5D/route.ts)
        (rename and delete), the detach branch on the
        [project character PATCH](../../../apps/broll/src/app/api/projects/%5Bid%5D/character/route.ts),
        three queries in
        [characters.ts](../../../apps/broll/src/lib/characters.ts), and the
        controls in
        [character-actions.tsx](../../../apps/broll/src/app/dashboard/characters/character-actions.tsx)
        and `character-panel.tsx`. Both destructive controls arm in place rather
        than opening a dialog, which is this repo's established pattern.

        **The in use refusal is inside the `DELETE`, not a read before it.** A
        read then delete can be raced by an attach landing in the gap, and losing
        that race takes the face out of a project that just claimed it — silently,
        because `broll_projects.broll_character_id` is `ON DELETE SET NULL`. The
        `NOT EXISTS` guard makes the refusal a property of the statement. The
        second query naming the projects runs only on the refusal path.

        Objects are deleted after the rows and best effort: once the rows are
        gone the objects are referenced by nothing, which is what the sweep cron
        collects, so a failed object delete is picked up next run rather than
        stranded. Doing it the other way round strands a row pointing at nothing,
        which the creator sees as a broken thumbnail.

        _Superseded note, kept because it dated the gap:_ checked 2026-08-16,
        [dashboard/characters/page.tsx](../../../apps/broll/src/app/dashboard/characters/page.tsx)
        exists uncommitted, 241 lines, and it lists thumbnails, style, the
        regeneration allowance and the projects using each character, which is
        AC-134. It carries no rename, no delete and no detach, so AC-135, AC-136,
        AC-137 and AC-140 are untouched. The box stays open because the three
        writes are where the whole risk of this sub box lives: the in use refusal
        and the best effort object delete are the parts that can lose someone a
        character they paid for.
  - [x] The faceless project: character scenes that say what they need, render
        and export refusing with that reason, and empty characters swept
        (AC-130, AC-138). Landed 2026-08-16, and it became worth doing the same
        day detach shipped: detaching is now the easy way to reach a project
        whose character scenes have nothing to draw.

        **`sceneBlocker` in
        [scene-templates.ts](../../../apps/broll/src/lib/scene-templates.ts) is
        the whole feature, and its input is the load bearing choice.** It reads
        `committedEmotions`, the server's list off `broll_assets`, and never the
        decoded bitmaps. Bitmaps arrive asynchronously and the map starts empty,
        so a blocker keyed to them would announce that every character scene
        needs a character for the first moment of every page load and then
        silently take it back. Three distinct reasons, because the fixes differ:
        no character at all, an emotion the character does not have, and no
        emotion picked.

        **Derived, never stored**, which is what makes the criterion's last
        clause true for free: attaching a character clears every blocked scene
        with no re-plan and no write, because there was never a column recording
        the block.

        The refusal rides on the render job rather than living in a button, so
        it is a property of *enqueueing* — a later entry point cannot start an
        encode that was never going to draw a character. `blocked` is its own
        phase, distinct from `failed`: retrying a failure can work, retrying
        this cannot, and the row says "Skipped" rather than "Failed" for that
        reason.

        **A batch skips and still delivers**, the same shape as AC-32: a run of
        twelve with two faceless scenes hands over ten and zips them. That is
        silent unless something says so, so the bar states the count *before*
        Render all rather than leaving it to be noticed on the timeline.

        AC-130 is a second pass in the same cron and shares no code with the
        above: the existing sweep collects objects with no row, this collects
        character rows with no objects, guarded on age, emptiness and no project
        pointing at them. Empty rows exist because generate creates the character
        before turn 1 and before the money is reserved, so a run that dies in
        that gap counts against `MAX_CHARACTERS_PER_USER` forever.

        **The templates' own missing-cutout fallback is unchanged**: a character
        template handed no image still draws its text rather than failing. That
        covers a bitmap that failed to decode, which is a different thing from a
        project with no character, and the two paths now overlap without
        conflicting.
- [ ] Verify it: /check verify character reuse
- [ ] Test it: /test character reuse

**Done, and it cost about $6.00. Applied 2026-08-14.** Migration `0018` is a
clean break: it deletes every existing `broll_assets` row, because there is no
column to move them to and carrying a second accepted pathname shape through the
security check costs far more than $2.00. The warning that used to sit here said
to run it before the four owed verifications, or expect to pay twice. It ran
after three sets had already been generated: 18 asset rows and 19 stored objects
were deleted on the dev branch, which is three sets at $2.00 that features 3 and
4's verifications will have to buy again. The engineer took that call knowingly
at the start of the build, which is what phase 0 of the spec's migration plan
exists to force. Nothing else was lost, and the four verification boxes are
unaffected apart from the price.

**Priced at zero on purpose, decided 2026-08-14.** The $2.00 buys a reusable
character rather than one project's worth of images, which is a better thing to
sell than a discount nobody can explain. That decision is the engineer's, made
at enrollment; the spec inherits it rather than reopening it, and it belongs in
the same conversation as the wider pricing review that is still open with the
client.

**This is not a small change, and three specific things are why.** None of them
blocks it. They are written down so the spec starts from evidence rather than
rediscovering them.

- **The schema binds a character to one project.**
  `broll_assets.broll_project_id` is `NOT NULL` and cascades on delete, and
  `broll_assets_project_emotion_uq` is unique on (project, emotion). A reusable
  set has to become something the **user** owns that projects point at, which is
  a shared schema change and therefore a `packages/db` migration.
- **The storage path embeds the project id**, `broll/<projectId>/<emotion>-<attempt>-<random>.png`,
  minted by `asset-path.ts`. So either the assets are copied per project or the
  path scheme changes, and the copy option quietly doubles storage on a Blob
  quota the scope already flags as tight.
- **That path is the authorization.** `isCharacterAssetPathname(pathname, projectId)`
  is what proves a signed read or a presigned upload belongs to the caller, and
  `apps/broll/AGENTS.md` calls it the whole security of the upload route. Any
  new scheme has to carry that same property, and it is the part worth a cross
  model critic rather than speed.

**Why it sits here rather than in Phase 2.** It genuinely belongs to the
character pipeline, but it runs late on purpose: the four owed verifications for
features 3 and 4 come first, so the flow gets designed by someone who has just
paid for character sets by hand and knows what the reuse step should feel like.
It is placed ahead of feature 10 for the same reason it is worth doing at all,
and it makes every later test project cheaper, since verification stops costing
$2.00 a time.

### 12. Visual pass and the Renders view · in-progress

Enrolled by `/scope` on 2026-08-16, from work already sitting uncommitted in the
tree rather than from a plan. It arrived the same way feature 9 did, the engineer
looking at the screen and not liking it, which is a legitimate way for a feature
to start and is why it gets a row of its own instead of being folded into a
feature that already carries 66 unverified boxes.

**Intent**: Give the app one visual language instead of per screen styling, and
give a creator somewhere to see their rendered work that is not inside a single
project.

**Done when**: every B roll screen draws its buttons, cards, badges and chips
from one shared set rather than from ad hoc classes, a creator can reach
Characters and Renders from anywhere in the app, and the Renders view answers
"what have I made so far" across all projects.

- [ ] Build it: /develop visual pass and renders view
  - [ ] The shared set and the restyle. Uncommitted as of 2026-08-16, in
        [apps/broll/src/components/ui/](../../../apps/broll/src/components/ui/)
        (`button`, `card`, `badge`, `switch`, `stat-chip`) with the restyle
        rippling through [globals.css](../../../apps/broll/src/app/globals.css),
        [layout.tsx](../../../apps/broll/src/app/layout.tsx), the dashboard, the
        new project form and every Scene Studio file. About 1,568 lines added
        across 18 changed files and 10 new ones.
  - [ ] Top level navigation:
        [nav-links.tsx](../../../apps/broll/src/app/nav-links.tsx), Projects plus
        Characters plus Renders, with the active state derived from the path. It
        is `hidden md:flex` today, so on a phone the app has no navigation at all,
        which is feature 10's small screen refusal arriving as a gap rather than
        as a message.
  - [ ] The Renders view:
        [dashboard/renders/page.tsx](../../../apps/broll/src/app/dashboard/renders/page.tsx),
        scenes across every project the caller owns. Uncommitted.
- [ ] Verify it: /check verify visual pass and renders view
- [ ] Test it: /test visual pass and renders view

**Two things found by reading the page, both fixed 2026-08-16 before the rest of
the feature was built.**

**The thumbnails failed silently, and on this page that read as data loss.**
`presignAssetReads(...).catch(() => [])` swallowed every signing error and fell
through to a per emotion "Empty" tile, so a store hiccup, an expired token or the
wrong store all rendered exactly like a character with no images, on the one
screen whose job is showing a creator the six faces they paid $2.00 for. Nothing
was logged and nothing reached Sentry. Now signed in **one pass for the whole
page**, so one failure is one `reportError` rather than one per character, and
the three states are told apart: an image, "Could not load" for a stored variant
that could not be signed, and "Empty" only when the variant genuinely does not
exist. A banner says the characters are safe and the error was reported.

**The page was an N+1 and is now three statements.** It ran
`listCharacterAssets`, `regenerationsUsed` and `listProjectsUsingCharacter` per
character plus a presign batch each, and the Neon HTTP driver gives every
statement its own round trip, so ten characters was upwards of thirty requests.
`listAssetsByCharacter` and `regenerationsUsedByCharacter` in
[assets.ts](../../../apps/broll/src/lib/assets.ts) and `listProjectsByCharacter`
in [characters.ts](../../../apps/broll/src/lib/characters.ts) each answer the
whole library in one statement, grouped by character id. All three are scoped by
`user_id` in SQL, the same ownership join the per character versions use, so the
batching changed the number of round trips and not who can read what. The per
character functions stay: they are the right shape for a route that already knows
its character.

**Two earlier flags in this row were wrong and are removed rather than left to
mislead.** Checked 2026-08-16 by opening the files. `characters/page.tsx` and
`renders/page.tsx` are **five line redirect stubs** pointing at the
`/dashboard/*` pages, not second implementations, and neither is in
`PUBLIC_ROUTES` so both sit behind the Clerk gate. And the Renders view is
authorized correctly: it selects `broll_projects` by `user_id` first, then scopes
the scene query to that id list with an empty list guard, and every helper the
characters page calls takes a `userId` and filters on it.

**No spec, and that is a judgement not an oversight.** This moves no money, adds
no schema, calls no vendor, and the risk is "does it read well", which is what
`/check verify` answers. If the Renders view grows a filter, a sort or paging,
that logic earns a spec and tests, and this line is worth revisiting. The cross
project read above is the one part that would change the answer.

### 13. Vertical output, and the empty transcript guard · in-progress

Enrolled 2026-08-16, from the engineer asking what was worth building next
rather than from a plan. Two unrelated things share a row because both are
small, both were already half-present in the codebase, and neither is worth its
own ceremony.

**Intent**: Let a creator cut a project for Shorts and Reels rather than only for
YouTube, and stop a wrong file becoming a silently empty project.

**Done when**: a new project can be created in 9:16 and every template that draws
in landscape also draws in portrait; and a transcript with no speech in it is
refused at intake on both paths instead of creating a project with nothing in it.

- [x] Build it, 2026-08-16.
  - [x] **The empty transcript guard.** Both intake paths refuse a document with
        no segments, with wording that differs because the causes do: an upload
        says the file has no subtitles, a Ruff Cut handoff points at the cut.
        `hasSpeech` in
        [actions.ts](../../../apps/broll/src/app/actions.ts) documents why the
        check cannot live in `@repo/transcript` — zero segments has to stay legal
        there, because Rough Cut's own export relies on it, so the parser
        genuinely cannot tell an empty subtitle file from a file that is not one.

        This closes the gap `/test` found on 2026-08-10 and recorded in feature
        2. The test that pinned the broken behaviour said to change it rather
        than delete it quietly when the check landed, and it was changed. Fixing
        it also exposed that the Ruff Cut fixture built a document with
        `segments: []`, so six handoff tests had been asserting the path works
        with an empty transcript.
  - [x] **Vertical output.** `broll_projects.output_width`/`output_height` have
        existed since spec `0002` and nothing ever set them, so every project was
        landscape by default rather than by choice.
        [aspect-ratio.ts](../../../apps/broll/src/lib/aspect-ratio.ts) is the
        picker's vocabulary, with a frame chooser on the new project form and the
        ratio carried through both server actions.

        **Two template problems that only a portrait frame reveals, both fixed.**
        Every template sized its type off the frame **height**, which is correct
        until the height is the long edge: at 1080x1920 `chart-full`'s big number
        (`0.26`) is 499px in a 1080px frame and simply runs off it. `typeScale`
        in [layout.ts](../../../apps/broll/src/lib/render/layout.ts) is the short
        edge, which **equals the height in landscape**, so the swap is provably a
        no-op at 1920x1080 — the existing 512 tests passing unchanged is that
        claim checked rather than asserted.

        And `character-left` needed real recomposition, not a ratio: its whole
        idea is a side by side split, and a 9:16 frame has no side. It now stacks
        in portrait, character along the bottom and words above, travelling in
        from below rather than from the edge. It is the only template that
        branches on orientation, and `character-center` stays full bleed so the
        two remain visually distinct in portrait.
- [ ] Verify it: /check verify vertical output. Nothing here spends anything, and
      the question a test cannot answer is whether a 9:16 clip actually reads
      well — the composition was reasoned and measured, not watched.

**One thing deliberately not built.** There is no way to change a project's frame
after it exists, and the form says so. The columns would allow it and rendering
is client side and free, so the cost is a re-render rather than money; what stops
it being obviously right is that a plan's scenes were composed against one shape.
Worth deciding rather than inheriting from build order.

### 14. The clip's own design, and the cutout download · in-progress

Enrolled 2026-08-17. The trigger was noticing that feature 12 restyled the
**app** while the thing a creator publishes — the MP4 — had never been designed
at all. Both template files said so themselves: "the visual design is a plain
default and is not ratified", "deliberately plain and is not specified
anywhere". `design-prompt.md` gave one line of composition per template and
Phase 0 explicitly deferred aesthetic judgement to a real timeline; nobody came
back to it.

**Intent**: Make the output look like it belongs to this ecosystem, and stop the
cutout step being an unexplained multi-megabyte stall in front of a paid run.

**Done when**: a rendered clip uses only ecosystem colour, a creator's first
character run explains what it is doing while it downloads, and the clip's visual
language is written down rather than being whatever someone typed to get a frame
drawing.

- [x] Design it (spec) [0009](../../specs/broll/0009-clip-visual-language/index.md),
      2026-08-18. Settles motion, chart marks, text setting, depth, and the
      vertical frame. Cross checked on a second model, which found seven gaps
      including a real conflict between the safe area margin and the portrait
      character band; all seven were resolved before acceptance.
- [x] Foundations, done 2026-08-17. The three pieces below landed before the
      design was written, because each was a correction of something plainly
      wrong rather than a decision about how a clip should look.
  - [x] **One palette for the output.**
        [render/theme.ts](../../../apps/broll/src/lib/render/theme.ts) holds the
        brief's §A palette, a series ramp built from Key Yellow and Interactive
        Blue and their shades rather than a third hue, and the 40px grid as a
        ratio so a 9:16 clip gets the same visual density as 16:9. Every
        template drew on an invented navy `#0b0f19` with a periwinkle `#5b8cff`
        figure — three separate violations of the brief's one prohibition, "do
        not introduce new hues". A test now asserts no template theme contains a
        colour outside the palette, because that rule cannot survive on prose.

        The grid's line weight is deliberately not 1px: a one pixel line at 8%
        white is exactly what H.264 turns into shimmer rather than a grid.
  - [x] **The cutout download, halved and explained.** `isnet_fp16` instead of
        the full model, the GPU when `navigator.gpu` exists — which is also what
        moves inference off the main thread, since the library gates its worker
        behind WebGPU — and the library's own `progress` callback surfaced in
        the status line. `isnet_quint8` is smaller still and deliberately unused:
        its artefacts land on the cutout edge, the one thing this product is
        judged on at high zoom. `segmentation.ts` had no tests at all, which was
        a known hole; the pure config now has nine.
  - [x] **The planner stops proposing what it cannot draw.**
        `PLANNABLE_TEMPLATES` is the subset with a renderer, so
        `character-plus-chart` and `split-compare` are no longer offered to the
        model. On the reference project that was one scene of twelve permanently
        stuck on "no renderer yet". Kept as a literal rather than an import, so
        the planner's server bundle does not pull in canvas drawing code to read
        an array of strings; a test asserts the two lists match.
- [x] **Brand typography, done 2026-08-17.** Clips are set in Space Grotesk and
      DM Sans. The blocker was never the work: the app loads both through
      `next/font/google`, which self hosts into the build with no stable public
      URL, and a render **worker** resolves fonts against a set nothing
      populates — so naming the brand face would have rendered correctly in the
      on page preview and silently fallen back in the exported file. Fixed by
      serving both woff2 from `public/fonts/` (the only reason that directory
      exists) and registering them through one module, `render/fonts.ts`, that
      the page and the worker both call. The worker **awaits** it before frame
      zero, because an encode is a single pass; the page treats it as a repaint
      trigger, so a scene appears immediately and sharpens a moment later. The
      test that pinned the gap open now pins the opposite.

      The split follows the brief rather than being invented: Space Grotesk on
      the words a frame is about and on numeric data, DM Sans on the labels that
      support them.
- [ ] Build it: /develop the clip's visual language. Milestones rolled up from
      spec [0009](../../specs/broll/0009-clip-visual-language/index.md)'s build
      plan; the atomic tasks stay there.
  - [ ] **Motion and depth, shared by every template.** One `render/motion.ts`
        replacing the four copies of the same easing, the slow push applied
        centrally in `drawRenderable`, `durationMs` added to the frame object,
        then the grid fade and the figure glow. Covers AC-173 to AC-179, AC-194,
        AC-195.
  - [ ] **The chart, then measure.** Baseline rule, rounded caps, bar stagger,
        line dots, compact notation, title wrap, the formatter returning number
        and unit separately, and the donut as its own step. Then time an encode
        against Phase 0's 1791ms, deliberately here rather than at the end.
        Covers AC-180 to AC-188, AC-198.
  - [ ] **Text setting and creator marked emphasis.** Optical centring off real
        metrics, orphan control with the overflow guard, the gradient scrim, then
        the asterisk syntax with run aware wrapping. Covers AC-189 to AC-193.
  - [ ] **The vertical frame.** Safe area insets applied to text and marks but
        deliberately not to figures, and the guide drawn on the preview only.
        Covers AC-196, AC-197.
- [ ] Verify it: /check verify the clip's design, against
      [verify.md](../../specs/broll/0009-clip-visual-language/verify.md). This is
      the one feature on this scope where a unit test can say almost nothing —
      every question is "does the clip look right", which needs a real render
      watched at full size. That sheet opens with the judgement step before any
      criterion, for exactly that reason.
- [ ] Test it: /test the clip's visual language. The suite locks the structural
      proxies (no template defines its own easing, two durations reach the same
      final scale, no portrait draw call enters the reserved margins) and can say
      nothing about whether the result looks produced.

**Still on a third party CDN, and now cheaper rather than fixed.** `@imgly`
fetches its weights from `staticimgly.com` on every cold browser. `publicPath`
can point at self hosted files; what stops it is that the weights are tens of
megabytes, which is a hosting decision rather than a code one. Halving the
download and explaining it buys time; it does not remove the dependency, and
spec `0001` still does not record it as an accepted one.

### 10. Blocking and edge states · planned · from spec 0006

Enrolled by `/architect` on 2026-08-13, out of spec
[0006](../../specs/broll/0006-scene-studio-layout/index.md)'s follow-ups. The UI
brief's B8 lists three refusals this app owes and none of them has a home: an
unsupported browser (no WebCodecs, detected at load and refused **before** any
credit is spent), running out of credits mid flow with a path to top up in the
Wallet app and back, and the small screen message, since this is a canvas review
UI that does not work on a phone.

Part of it exists already and is worth not rebuilding: the capability probe runs
on mount in `render-scene-button.tsx`, and `capability.ts` probes a candidate
profile list at the real output size. What is missing is the screen level
refusal, the credits path, and the mobile message. Spec `0006` AC-110 stops
deliberately at a narrow desktop window and leaves the genuine mobile refusal
here.

**Intent**: Refuse honestly and early, in the three cases where continuing would
waste a creator's money or their time.

**Done when**: a browser without WebCodecs is told so at load with a specific
reason rather than a generic error, a creator who runs out mid flow can top up
and come back to where they were, and a phone gets a plain message instead of a
broken canvas.

- [ ] Design it (spec): /architect blocking and edge states

## Deploy

### 8. Production deploy and error reporting · in-progress

Enrolled by `/scope` on 2026-08-12. Every piece of this already existed as prose
scattered through feature 2's blocker paragraph and the Phase 2 build notes, and
prose does not get ticked. Half of it is not code at all, which is exactly why it
needs a row: a step nobody can run a command for is the step that gets forgotten.

**Intent**: Make this app deployable and observable, on its own domain, without
the observability wiring quietly breaking the one privacy promise the character
pipeline makes.
**Done when**: b-roll runs on a real production domain as a Clerk satellite, its
Vercel build gates `main` alongside the other three, and an error in a generate
request reaches Sentry carrying no request body.

- [x] Wire Sentry into `apps/broll`, **with request body capture off**. Done
      2026-08-12 in PR #144. This was the one item here that was a live risk
      rather than a launch gate, and it is the reason the row was never simply
      "deploy it": before this there was no Sentry init in the app at all, so
      `reportError` forwarded to a no-op and the AC-22 promise (the reference
      photo exists in no blob, no column and no log line) held partly by
      accident.

      **The body is now removed two independent ways**, which is the part worth
      keeping. `sendDefaultPii` is off and `maxRequestBodySize` is `none`, so a
      body is never collected; `beforeSend` then scrubs `request.data`, the
      cookies and the auth header anyway. The second is not redundant: it
      survives an SDK default changing, an integration attaching request data on
      its own, and someone later turning PII on for a good reason without
      knowing that a character generate `POST` carries a photograph of someone's
      face. The scrubber is pure and unit tested against the exact multipart
      shape that route receives, because an untested privacy guard is a comment.

      Two smaller calls came with it. Query strings are stripped from event URLs,
      since this app mints signed asset URLs whose query carries a token. And
      there is deliberately no Sentry feedback widget here, unlike Rough Cut: a
      free text box on a page holding someone's face is not a control this app
      should offer yet. The four Sentry variable names the build reads are in
      `turbo.json`'s `build` env array, and `.env.example` gained the Sentry
      block plus `CRON_SECRET`, which it had never documented even though the
      sweep route hard requires it and answers 500 without it.
- [ ] Production domain, then register b-roll as a Clerk satellite in the Clerk
      Dashboard. The domain choice is settled: b-roll gets **its own domain**, not
      a subdomain of `myfirstcut.app`, which is what made the Ruff Cut handoff
      server to server in the first place. Founder's Frame cannot supply one, it
      is a fully static export.
- [ ] Fourth Vercel project, with every server variable the build needs listed by
      name in `turbo.json`'s `build` env array. A secret set in Vercel and missing
      from that list reads as `undefined` during `next build` with no error;
      `BLOB_READ_WRITE_TOKEN` and `BROLL_IMAGE_MODEL` are the ones this app added.
- [ ] Add that Vercel build to branch protection **by hand**. That list lives in
      GitHub settings, not in this repo, and it has silently stopped gating once
      before.
- [ ] Settle the storage vendor with the client (Vercel Blob today, R2 in spec
      0001 §5.3). Tracked in full under feature 3; it blocks general availability
      rather than any build, and the swap is contained behind
      `apps/broll/src/lib/storage.ts`.

## Legend

- **Next step** = the first unticked box.
- **needs a decision** = run `/architect` first; otherwise straight to `/develop`.
- **Status** `planned` → `in-progress` → `done`, plus `existing` and `dropped`.
- **Workflow tier tag** beside a heading overrides the project default for that
  one feature; no tag means it inherits.
