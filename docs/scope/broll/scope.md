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
| 5 | One template end to end | Phase 4 | planned |
| 6 | Remaining templates + Scene Studio | Phase 5 | planned |
| 7 | Batch export, zip, credits | Phase 6 | planned |
| 8 | Production deploy and error reporting | Deploy | planned |

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
  "was the deadline" identifies nothing. Decide in Phase 3 whether the planner
  copes, or whether an import merges cues into utterances before planning.

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

      **Built, gated, and never once run against the real vendor.** Not a single
      Gemini image call has been made by this code: the whole suite mocks
      `fetch`, and no local run has had an image capable `GEMINI_API_KEY` or a
      connected Blob store pointed at it. So the prompt wording spec 0004 wrote
      down for the first time is still unjudged, exactly as its Follow up says,
      and so is the segmentation quality on real output. Everything below
      describes code that typechecks and is unit covered, not behaviour anyone
      has watched.

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

## Deploy

### 8. Production deploy and error reporting · planned

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

- [ ] Wire Sentry into `apps/broll`, **with request body capture off**. There is
      no Sentry init here today: no `instrumentation.ts` and no
      `sentry.*.config.ts`, while `apps/rough-cut` carries four such files. So
      `reportError` forwards to a no-op in this app, and the AC-22 promise (the
      reference photo exists in no blob, no column and no log line) currently
      holds partly by accident. A default Sentry setup with body capture on would
      send a multipart body carrying a face photo on any error thrown during a
      generate request, with nothing failing and nothing to notice. This is the
      one item here that is a live risk rather than a launch gate, and it is the
      reason the row is not simply "deploy it".
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
