# 0002. B-Roll data model

**Date**: 2026-08-08
**Status**: In Progress

## Summary

This spec defines every column of the three new b-roll tables (`broll_projects`,
`broll_assets`, `broll_scenes`) and the two changes b-roll needs in the shared
`credit_ledger`. It exists because the document that originally defined them,
`broll-generator-spec.md`, is lost, and the Phase 1 migration cannot be written
without it. The model here is reconstructed from what survives in the repo: the
high level design, its 38 acceptance criteria, the Phase 0 findings, and the UI
brief. No migration SQL and no code, only the target the migration will build.

## Requirements

**User stories**

- As a creator, I want my b-roll project to keep the transcript, the character
  images, and the planned scenes, so that closing the tab does not lose my work.
- As a creator, I want to be charged once for a character set even if I double
  click Generate, so that a slip does not cost me money.
- As the person paying for storage, I want every stored image to be accounted
  for, so that a retention policy is possible later without a painful backfill.

**Acceptance criteria**

The data layer criteria this spec must satisfy already exist in spec
[0001](../0001-high-level-design/verify.md) and keep their numbers. They are
listed here by ID so the contract stays in one place:

- **AC-8**: the migration adds `broll_projects`, `broll_assets`, `broll_scenes`
  and collides with no rough-cut table.
- **AC-9**: `broll_projects.source_project_id` is a nullable foreign key to
  `projects.id` with `onDelete: "set null"`, and a project created from an
  uploaded SRT with no rough-cut project succeeds.
- **AC-10**: `credit_ledger` has a nullable `broll_project_id` foreign key plus a
  CHECK that at most one of `project_id` and `broll_project_id` is non null.
- **AC-16**: every ledger row b-roll writes populates `cost_micros`.
- **AC-18**: stored cutouts are alpha trimmed, so a stored image's dimensions
  match the character's bounding box and not the generation frame.
- **AC-22**: the reference photo is not persisted anywhere.
- **AC-25**: planning is charged on re-runs only; a project's first run is
  bundled.
- **AC-37, AC-38**: every route authorises server side and scopes by `user_id`;
  no cross user access under any path.

This spec adds six criteria, continuing the same numbering (0001 owns 1 to 38):

- **AC-39**: no query that lists projects selects the `transcript` column. A
  document is capped at 5 MB, so a page of twelve projects that selects it moves
  up to 60 MB over the HTTP driver for data no list ever shows.
- **AC-40**: `broll_assets` holds exactly one row per project and emotion,
  enforced by a unique constraint. Regenerating a variant replaces the row and
  deletes the object it superseded, so stored objects stay bounded at one per
  emotion.
- **AC-41**: `broll_projects.plan_runs` distinguishes a first plan run from a
  re-run, which is the value AC-25 bills on.
- **AC-42**: scenes are ordered by `start_ms`, and the number in an exported
  filename is computed from that order at export time, never stored.
- **AC-43**: every statement that moves a balance for b-roll lives in
  `@repo/billing`, never in `apps/broll`, including the reserve and settle pair
  that reads `broll_projects.hold_micros`.
- **AC-44**: the new `credit_ledger_reason` values ship in a migration of their
  own, applied before any deployed code writes them.
- **AC-45**: a repeated plan re-run request (double click, retry) charges once.
  The guard is an idempotency key written into `credit_ledger.stripe_event_id`
  under a `broll_plan:` prefix, the same mechanism `chargeAiCut` already uses,
  and `plan_runs` increments in that same statement.
- **AC-46**: a scene with `origin = 'manual'` stores no source span and no
  planner score, and inserting one succeeds. A manually added scene has no
  transcript line behind it, which is the whole point of the origin field.
- **AC-47**: ~~the `credit_ledger` CHECK is added `NOT VALID` and validated as a
  separate step~~. **Withdrawn 2026-08-08, during the build.** The mechanism does
  not exist: `drizzle-kit` runs every pending migration statement inside one
  transaction (`BEGIN` ... `COMMIT`, its `transactionProxy`), so a `NOT VALID`
  constraint followed by `VALIDATE CONSTRAINT` in the same file holds the lock
  until commit exactly as a plain `ADD CONSTRAINT` would. The split only works
  across two migration files applied in two separate `db:migrate` runs. Both
  `credit_ledger` constraints are therefore added plainly, which is the same call
  migration `0014` made about its index: at this table's size the validation scan
  is milliseconds. The reasoning and the switch threshold are recorded in
  migration `0015` itself, where the next person will actually read them.

## Decision

**Chosen option**: Option 2, three app owned tables plus two additive changes to
the shared ledger.

B-roll gets its own `broll_` prefixed tables in the shared `packages/db` schema,
holding the transcript inline as `jsonb`, one row per character emotion, and one
row per planned scene. Money attribution is a second nullable foreign key on
`credit_ledger` rather than a polymorphic pair, matching what spec 0001 already
decided for app number two.

## Feature design

**Data model sketch**

`broll_projects`

| Column | Type | Null | Default | Why it exists |
|---|---|---|---|---|
| `id` | uuid, primary key | no | random | |
| `user_id` | uuid, FK `users.id` on delete cascade | no | | Ownership. Every query scopes by it (AC-37, AC-38) |
| `name` | text | no | | Project card title |
| `source_project_id` | uuid, FK `projects.id` on delete set null | **yes** | | Null when the transcript was uploaded rather than handed over (AC-9) |
| `transcript` | jsonb | no | | The whole `@repo/transcript` document. Never selected by a list query (AC-39) |
| `edl_fingerprint` | text | **yes** | | Lifted out of the document so the Phase 3 staleness check can compare without parsing 5 MB |
| `duration_ms` | integer | no | | Read constantly (the planner multiplier, project cards). Not worth parsing the document for |
| `style` | text | no | | anime, 3D, and the rest. One style per project |
| `output_width` | integer | no | 1920 | Output setting, chosen once per project |
| `output_height` | integer | no | 1080 | |
| `output_fps_num` | integer | no | 30 | Rational, so 29.97 stays 30000/1001 |
| `output_fps_den` | integer | no | 1 | |
| `hold_micros` | integer | **yes** | | Money reserved before the Gemini call. Doubles as the settle once gate, exactly as `projects.hold_micros` does |
| `gen_claim_at` | timestamptz | **yes** | | Atomic claim. A second Generate finds it non null and charges nothing (AC-15) |
| `plan_runs` | integer | no | 0 | The only value that separates a bundled first run from a charged re-run (AC-25, AC-41) |
| `last_opened_at` | timestamptz | **yes** | | Present from day one so a retention policy needs no backfill |
| `created_at` | timestamptz | no | now() | |
| `updated_at` | timestamptz | no | now() | |

Index `broll_projects_user_created_idx` on `(user_id, created_at)`, the same
shape and for the same reason as `projects_user_created_idx`.

`broll_assets`

| Column | Type | Null | Default | Why it exists |
|---|---|---|---|---|
| `id` | uuid, primary key | no | random | |
| `broll_project_id` | uuid, FK `broll_projects.id` on delete cascade | no | | |
| `emotion` | text | no | | Plain text, validated in application code |
| `r2_key` | text | no | | Stored, not derived, so the key can carry a random element and stay unguessable |
| `width` | integer | no | | The alpha trimmed width. AC-18 asserts against it, and a template positions from it without downloading the image |
| `height` | integer | no | | |
| `byte_size` | integer | no | | Storage accounting, before storage is a problem |
| `attempt` | integer | no | 1 | Bumped on regenerate, so a replaced image cannot serve from a cache |
| `created_at` | timestamptz | no | now() | |
| `updated_at` | timestamptz | no | now() | |

Unique constraint `broll_assets_project_emotion_uq` on
`(broll_project_id, emotion)`. This is what makes replace in place correct
rather than merely intended (AC-40).

`broll_scenes`

| Column | Type | Null | Default | Why it exists |
|---|---|---|---|---|
| `id` | uuid, primary key | no | random | |
| `broll_project_id` | uuid, FK `broll_projects.id` on delete cascade | no | | |
| `start_ms` | integer | no | | The timecode, and the sort key (AC-42) |
| `duration_ms` | integer | no | | Four to ten seconds (raised from eight on 2026-08-12; the ceiling lives in `MAX_SCENE_DURATION_MS`, never here) |
| `source_text` | text | **yes** | | The verbatim transcript line that triggered the scene. What makes a scene identifiable in a two second scan. **Null exactly when `origin = 'manual'`**, because a hand added scene has no line behind it (AC-46) |
| `source_start_ms` | integer | **yes** | | Where that line sits, for provenance. Null on a manual scene |
| `source_end_ms` | integer | **yes** | | |
| `visual_type` | text | no | | character, infographic, or text |
| `emotion` | text | **yes** | | Which variant to composite. Null on a chart only or text only scene |
| `layout_template` | text | no | | One of the six templates |
| `overlay_text` | text | **yes** | | On screen text |
| `chart` | jsonb | **yes** | | `{type, title, values, labels, unit, source_span}`. **Null is the meaningful case**: vague quantification must produce no chart |
| `strength` | real | **yes** | | The planner's score, 0 to 1. Null on a manual scene, which no planner scored (AC-46). Kept for display and for retuning the planner later, never for deciding `included` |
| `included` | boolean | no | true | **Written by the planner directly**, then owned by the user. Not derived from a `strength` threshold: no such threshold has any evidence behind it yet, and inventing one puts a made up number on the critical path |
| `origin` | text | no | `'planner'` | planner or manual |
| `render_status` | enum `broll_render_status` | no | `'pending'` | pending, rendered, failed |
| `rendered_at` | timestamptz | **yes** | | |
| `created_at` | timestamptz | no | now() | |
| `updated_at` | timestamptz | no | now() | |

Index `broll_scenes_project_start_idx` on `(broll_project_id, start_ms)`, the
Scene Studio list query and the export order in one.

`credit_ledger`, two additive changes

| Change | Detail |
|---|---|
| New column | `broll_project_id` uuid, nullable, FK `broll_projects.id` on delete set null |
| New CHECK | `credit_ledger_one_project_ref`: not both `project_id` and `broll_project_id` non null. Both null stays legal, since purchases and grants point at no project |
| Enum values | `credit_ledger_reason` gains `broll_character_set` and `broll_plan_rerun` |

**One typing rule, applied throughout.** A lifecycle state becomes a `pgEnum`
(`render_status`, like the existing `transcript_status`). A taxonomy still being
tuned stays `text` validated in application code (`emotion`, `style`,
`visual_type`, `layout_template`). Phase 0 asks for leniency on labels that are
not truth claims, and every enum change is a migration against a branch that
Preview also reads.

**What is deliberately not stored**

- **The reference photo.** It is the creator's real face and it is only ever a
  Turn 1 input, since every later turn anchors on the previous output image
  (AC-22). It reaches neither the database nor R2.
- **A `credits` column on `users`.** The ledger is the source of truth and
  `balance_micros` is its cache. Spec 0001 deleted this from the lost spec.
- **Render progress percentage.** Rendering is free, client side, and
  repeatable. Only the settled per scene outcome is worth a row.
- **A stored scene number.** Computed at export from `start_ms` order (AC-42),
  so excluding or adding a scene costs no renumbering write.

**State transitions**

Character generation, per project:

    idle (gen_claim_at NULL, hold_micros NULL)
      -> claimed   (gen_claim_at set, atomic UPDATE ... WHERE gen_claim_at IS NULL OR stale)
      -> reserved  (hold_micros set, balance debited, CHECK 23514 rejects an overdraft here)
      -> settled   (hold reconciled against real usage, ledger row written)
      -> idle      (claim released)

A crash between reserved and settled leaves a stale hold, recovered by the same
`reclaimStaleHold` path rough-cut already uses.

**B-roll's stale window is 10 minutes, not the existing `STALE_HOLD_MS`.** That
constant is 10 seconds, sized for transcription. A character set takes about 110
seconds (measured in Phase 0), so 10 seconds would reclaim a generation that is
still running and hand the user a second charge. Ten minutes is roughly five
times the measured run, which leaves a slow machine room without stranding a
real crash for long.

Plan runs have **no claim column and no hold**. A plan run is one synchronous
call, so it takes the eager charge shape `chargeAiCut` already uses: charge
keyed on an idempotency key, do the work, refund on failure (AC-45).

Scene render, per scene: `pending -> rendered`, or `pending -> failed -> pending`
on retry.

**API surface**

This spec settles the data layer. The full route design belongs to the phase
specs that build them. The routes that read or write these tables in Phase 1:

| Endpoint | Method | Key inputs | Key outputs | Auth | Key errors |
|---|---|---|---|---|---|
| `/api/projects` | POST | `name:text` (req), `transcript:json` (req), `sourceProjectId:uuid` (opt), `style:text` (req) | `id` | Clerk session | 400 invalid document, 413 over 5 MB |
| `/api/projects` | GET | `limit`, `cursor` | project list, **no transcript column** | Clerk session | 400 bad cursor |
| `/api/projects/[id]` | GET | | project plus transcript | Clerk session | 403, 404 |

**Value sourcing**

| Action | Value produced or displayed | Source |
|---|---|---|
| List projects | scene count | `COUNT(broll_scenes)`, computed at read, never stored |
| List projects | render status on the card | computed at read from the included scenes' `render_status`, by this rule: any `failed` wins and shows needs attention; else all `rendered` shows rendered; else not rendered |
| List projects | character thumbnail | `broll_assets.r2_key` for the neutral emotion, presigned at read |
| Plan a project | is this run charged? | `broll_projects.plan_runs > 0` (AC-25, AC-41) |
| Plan a project | the idempotency key that stops a double charge | client supplied request key, stored as `broll_plan:<key>` in `credit_ledger.stripe_event_id`, whose unique index is the guard (AC-45) |
| Regenerate one variant | is it charged again? | No. The emotion set was paid for as a whole, and regeneration is the review gate's correction path, not a new purchase |
| Regenerate one variant | may this request proceed? | the project's own `gen_claim_at`, so a regenerate cannot overlap a full set run |
| Regenerate one variant | ordering of the storage swap | upload the new object, swap `r2_key` and bump `attempt`, then delete the old object. In that order, so a crash leaves an orphaned object rather than a row pointing at a key that no longer exists |
| Add a scene by hand | `source_text`, `source_start_ms`, `source_end_ms`, `strength` | none. All four are null when `origin = 'manual'` (AC-46) |
| Show a scene list | is a scene checked? | `included`, written by the planner and then owned by the user. No threshold is applied at read |
| Plan a project | how many scenes to propose | `ceil(duration_ms / 60000 * 1.2)`, from `duration_ms`. **Corrected 2026-08-10**: this read `/ 1000`, which is 1.2 scenes per *second* and would target 703 scenes for a 9:46 transcript. The high level design's `ceil(runtime × 1.2)` only makes sense with runtime in minutes, giving about 12, which matches its own talk of a twenty scene batch. Spec [0003](../0003-scene-planner/index.md) AC-50 carries the fixed form, and AC-60 makes it prompt guidance rather than a validation rule. The multiplier itself is still a guess, open question 5 in spec 0001 |
| Generate a set | may this request proceed? | `gen_claim_at IS NULL OR stale`, the atomic claim |
| Generate a set | the price | `@repo/billing/pricing`. **$2.00 flat** (`2_000_000` micros), env-overridable — decided 2026-08-09, tentative pending client review. Working in spec 0001 §8.1 |
| Plan a project, re-run | the price | `@repo/billing/pricing`. **$0.25 flat** (`250_000` micros), env-overridable. Same decision |
| Generate a set | `cost_micros` on the ledger row | the Gemini call's real reported usage (AC-16) |
| Store a cutout | `width`, `height` | the alpha bounding box measured after trimming, before upload (AC-18) |
| Store a cutout | `r2_key` | generated at upload, carrying a random element, then stored |
| Export a batch | the number in `scene_04__02-35.mp4` | position in `ORDER BY start_ms, id` among included scenes, computed at export (AC-42) |
| Export a batch | the timecode in that filename | `start_ms` rendered through `@repo/transcript`'s frame math at the project's `output_fps_num/den` |

**Key invariants**

1. A list query never selects `transcript` (AC-39).
2. At most one of `project_id` and `broll_project_id` is non null on a ledger
   row (AC-10).
3. One `broll_assets` row per project and emotion (AC-40).
4. Every statement that moves a balance lives in `@repo/billing` (AC-43). This is
   the repo's standing rule, and the reason it exists is that two copies of the
   ledger drifted in silence once already.
5. `gen_claim_at` and `hold_micros` are set and cleared as a pair. A row holding
   money with no claim, or a claim with no money, is a bug.
6. `chart IS NULL` is a valid, meaningful state and never an error.
7. The reference photo appears in no row and no object (AC-22).
8. A scene has a source span and a `strength`, or it has `origin = 'manual'`.
   Never neither, never both (AC-46).
9. A stored object is written before the row that names it, and deleted after
   the row stops naming it. The failure this orders against is a row pointing at
   a key that is gone, which breaks a render. An orphaned object is the safe
   direction to fail in, since it costs storage and nothing else.
10. Every charged action carries an idempotency key before it does the work,
    whether it holds money first (a character set) or charges eagerly (a plan
    re-run, AC-45).

**Security model**

Every row is owned through `user_id` on `broll_projects`; assets and scenes
inherit ownership through their cascade parent. No route accepts a `user_id`
from the client (AC-37). R2 keys carry a random element and are only ever handed
out as short lived presigned URLs, so knowing a project id does not yield an
object (AC-38).

Compliance scope: the reference photo is biometric grade personal data (a real
face). Not persisting it is the control, which is why AC-22 is a data model
requirement and not a UI preference.

**Configuration required**

No new environment variable is needed for the migration itself. The columns
assume these exist before Phase 2 writes to them:

- `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`: the
  bucket that `r2_key` addresses.
- `GEMINI_API_KEY`: the generation call whose usage fills `cost_micros`.

**Critical test scenarios**

- Happy path: a project is created from an uploaded SRT with no
  `source_project_id`, and its transcript reads back field for field, verifies
  **AC-9**.
- Failure case: two Generate requests arrive together; the second finds
  `gen_claim_at` non null, returns without calling Gemini, and exactly one
  ledger row exists, verifies **AC-15**, **AC-43**.
- Failure case: inserting a ledger row with both `project_id` and
  `broll_project_id` set is rejected by the CHECK, verifies **AC-10**.
- Failure case: regenerating one emotion twice leaves one row and one stored
  object for that emotion, verifies **AC-40**.
- Auth: a signed in user requesting another user's project id receives 404, not
  403, so project ids are not confirmed to strangers, verifies **AC-38**.

## Build plan

Ordered for Tracer Bullet: the Phase 1 thread is a project that can be created
and read back, so its schema lands whole and the money enum waits for the phase
that spends money.

1. **[done 2026-08-08]** Add `broll_projects`, `broll_assets` and `broll_scenes` to
   `packages/db/src/schema.ts` with the columns above, plus the two indexes and
   the `broll_assets` unique constraint, satisfies **AC-8**, **AC-9**,
   **AC-22** (by holding no photo column), **AC-40**, **AC-41**, **AC-42**,
   **AC-46** (the nullable source span and score), and supplies the `plan_runs`
   column **AC-25** bills on.
2. **[done 2026-08-08]** Add `credit_ledger.broll_project_id` and the
   `credit_ledger_one_project_ref` CHECK, plainly, satisfies **AC-10**. Every existing row passes. The
   availability cost is a validation scan under lock, accepted deliberately and
   documented in the migration file with the threshold at which to switch to the
   two migration form. See the withdrawn AC-47 above for why the split was not
   used.
3. **[done 2026-08-08]** Generated as `0015_ambitious_martin_li.sql`, reviewed,
   and applied to the dev branch and then production behind the preflight
   prompt, satisfies **AC-8**. `db:verify` passes on both, and every constraint,
   index and enum value was confirmed live rather than inferred from the
   migration file.
4. **[done 2026-08-08]** Add the `broll_render_status` enum with the tables in
   step 1; it is new, so it carries no ordering constraint.
5. **A separate, later migration** adds the two `credit_ledger_reason` values,
   applied before any deployed code writes them, satisfies **AC-44**. The reason
   is the repo's add, deploy, then use rule, not a Postgres limit. An earlier
   draft of this spec said Postgres will not let a value added in a transaction
   be used in that same transaction, which is true but does not apply here: no
   migration statement uses the value, only application code does, later. Worth
   knowing either way, since `drizzle-kit` runs all pending migrations in one
   transaction, so a separate file is only a separate transaction when the
   earlier migration has already been applied.
6. Add b-roll's money statements to `@repo/billing`, inside the package,
   satisfies **AC-43**, **AC-16**, **AC-45**. This is **new sibling functions,
   not an extension of the existing ones**, and the spec says so because the
   phrase "reuse what is proven" would otherwise mislead: `reserveCredits`,
   `reclaimStaleHold` and `settleHold` each hardcode `UPDATE projects` in their
   SQL, and `reclaimStaleHold` also hardcodes `transcript_status <>
   'processing'`. None of them can be pointed at another table. Expect
   `reserveBrollHold` and `settleBrollHold` beside them, plus an eager
   `chargeBrollPlanRerun` shaped like `chargeAiCut`.
7. Add a flat rate pricing primitive to `@repo/billing/pricing`. Every existing
   one prices per second (`chargeMicrosForSeconds`,
   `TRANSCRIPTION_COST_MICROS_PER_SECOND`), because everything charged so far has
   been video duration. A character set is priced per image call, so it has no
   slot to plug into today.
8. Enforce the list query rule where the queries are written: the project list
   selects an explicit column set that excludes `transcript`, satisfies
   **AC-39**.

Steps 1 to 4 are Phase 1. Steps 5 to 7 belong to Phase 2, with the first spend.
Step 8 lands with whichever step first writes a list query.

**Three inherited criteria are deliberately not tasks here.** AC-18 (cutouts are
alpha trimmed) and AC-37 and AC-38 (route authorisation and no cross user
access) are satisfied by code in the phases that write it, not by schema. This
spec's job for them is to make them possible: `width` and `height` exist for
AC-18 to assert against, and `user_id` with the cascade chain is what AC-37 and
AC-38 scope by. They stay listed in Requirements because a reader checking this
model against the contract needs to see they were considered, not skipped.

## Consequences

**Positive**

- The Phase 1 migration is now writable. It was blocked on exactly this.
- Storage stays bounded at one object per emotion per project, which keeps the
  undecided retention policy from becoming urgent.
- `plan_runs` and `cost_micros` mean the pricing question can be answered later
  with real data instead of another guess.

**Negative and tradeoffs**

- **`transcript` as `jsonb` puts a document of up to 5 MB in a row.** The
  protection is a convention (AC-39), not a constraint the database enforces. A
  careless `select()` in a list query is a real performance incident, and
  nothing will fail loudly when it is written.
- **Replace in place loses history.** A user who regenerates a variant and
  preferred the previous one cannot get it back. Accepted because storage here
  is permanent recurring cost and the retention policy is still undecided.
- **Four taxonomy columns are `text`, so the database will accept a typo.**
  Validation lives in application code. The bet is that the sets are still being
  tuned and a migration per tuning change costs more than it protects.
- **`@repo/billing` gains more than a second table to know about.** Its three
  hold functions hardcode `UPDATE projects`, so b-roll needs new sibling
  functions rather than a parameter, and its pricing is entirely per second
  while a character set is priced per call. That is more Phase 2 work than
  "reuse the proven path" suggests. The alternative is still worse: a local copy
  in `apps/broll`, which is exactly the drift that rule exists to prevent.
- **Two charged paths with two different shapes.** A character set holds money
  first, because it calls a slow external service. A plan re-run charges eagerly
  and refunds on failure, because it is one synchronous call. Both are correct
  for what they guard, and both already exist in the codebase, but a reader has
  to learn which is which.

**Neutral**

- Two migrations, not one, and the second is gated on the deploy of the first.
- The model is reconstructed from surviving evidence, so some columns will be
  found wrong in Phase 2. See the premise note in the rationale.

## Follow-up

- [ ] Decide the character set price in micros, and the image model tier that
      feeds it (open questions 2 and 7 in spec 0001). Blocking Phase 2, and the
      `cost_micros` column is useless until it is answered.
- [ ] Decide the transcript staleness policy (open question 1). `edl_fingerprint`
      is reserved for it and this spec picks no policy.
- [ ] Decide the R2 retention policy before general availability.
      `last_opened_at` and `byte_size` exist so the decision has data.
- [ ] Confirm in Phase 2 whether `broll_assets` needs a `kept` flag. The review
      gate is keep or regenerate today, with no reject and leave empty state, so
      none is specced.
- [ ] Amend AC-11 in spec 0001's `verify.md`, which still states the
      unbuildable wording. Carried over from spec `_root/0001`, still open.

## Rationale

Reasoning, the options weighed, the reconstruction record, and what evidence
each column rests on: see [rationale.md](rationale.md).
