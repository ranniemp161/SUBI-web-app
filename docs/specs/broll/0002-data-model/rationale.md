# Rationale — B-Roll data model

Why the model is what it is, and what each column rests on.

## Context

> ⚠️ Premise note: this model is reconstructed, not recovered. The document that
> defined it, `broll-generator-spec.md`, is gone, and the evidence that survives
> is a high level design that deliberately covers only what that document did
> not, a set of 38 acceptance criteria, the Phase 0 findings, and a UI brief
> written for a design tool. A data model inferred from screens is a good model
> of the screens, which is not the same thing as a good model of the domain.
> Expect Phase 2 to find a column that is wrong or missing, and route that back
> through `/architect` rather than letting the build quietly reshape the schema.
> The alternative, waiting for a document that no longer exists, blocks Phase 1
> permanently.

`apps/broll` cannot be built without its tables, and its tables cannot be
written without a column inventory. Spec 0001 names the three tables and about
four of their columns, then points at a companion document for the rest. That
document is not in the repo and cannot be produced. The Phase 1 scope row has
carried "not started: the column inventory has no source" since it was written.

Three forces shape the model beyond the missing document.

**The shared schema is not b-roll's to reshape.** `users`, `projects` and
`credit_ledger` are live, carry real money, and serve two deployed apps. Every
change b-roll needs there must be additive and backward compatible, because
Vercel Preview reads the production branch, so old code keeps serving traffic
against the new schema.

**Storage here is permanent recurring cost.** Rough-cut's blobs are ephemeral
audio with a sweep cron. B-roll's are character images that exist to be
composited into published videos, and the retention policy is explicitly
deferred. Every choice that lets stored objects multiply without a bound is a
bill that grows quietly.

**Money and identity have exactly one home each.** The repo learned this the
hard way: the ledger logic lived twice, once per app, and the copies drifted in
silence until one had an idempotency guard and the other had a bare UPDATE. The
same happened to the authorization code. Anything in this model that touches a
balance has to route through `@repo/billing`, not sit in `apps/broll`.

## Options considered

### Option 1: b-roll owns its own tables and its own users row

Give b-roll a self contained schema, close to what the lost spec proposed: its
own `users` with a `credits` integer, its own `projects`, `assets`, `scenes`.

**Pros**

- No coordination with rough-cut's schema at all, and no risk of breaking it.
- The app could ship without touching a table that carries live money.

**Cons**

- Two user tables and two balances for one person, in an ecosystem whose whole
  premise is one wallet spent across many apps.
- The table names collide with what `packages/db` already defines, so they
  cannot coexist in the shared schema anyway.
- A `credits` integer reintroduces the token era the wallet work spent a whole
  ADR removing.

### Option 2: b-roll tables in the shared schema, additive ledger changes

Three `broll_` prefixed tables alongside the existing ones, the shared `users`
row for identity and balance, and two additive changes to `credit_ledger` so
b-roll spend keeps per project attribution.

**Pros**

- One user, one balance, one audit trail, which is what the ecosystem was
  designed for.
- Every change to a live table is additive, so it satisfies the backward
  compatibility rule without ceremony.
- Reuses the reserve, settle and claim machinery that is already proven in
  production rather than inventing a second one.

**Cons**

- `@repo/billing` has to learn about a second table that can hold money.
- A second nullable foreign key on the ledger is not the shape that scales past
  a handful of apps.

### Option 3: shared tables with a polymorphic owner pair

Replace `credit_ledger.project_id` with a `(source_app, source_id)` pair, so any
app can attribute a ledger row without a new column each time.

**Pros**

- Scales cleanly to app number five without another migration.
- One shape to learn instead of a growing list of nullable foreign keys.

**Cons**

- Loses referential integrity: `source_id` cannot be a foreign key to two
  different tables, so nothing stops a row pointing at a project that no longer
  exists.
- Migrating an append only ledger of real money to a new shape is work that gets
  strictly harder over time, and there is no second spending app in flight to
  justify paying it now.

## Rationale

Option 2, because the forces above point one way. The ecosystem exists to give
one person one balance across many apps, which rules out Option 1 immediately;
its own high level design already deleted the standalone `users` table for that
reason. Option 3 is very likely the eventual shape, and the spec 0001 note
saying so still stands, but it trades referential integrity for a scaling
property nothing needs yet. At app number two, a nullable foreign key with a
CHECK keeps the database able to enforce the relationship, and the ledger is
still small enough to reshape later. Revisit at app number three, as 0001 says.

Within Option 2, four choices were live and each was made against a specific
force.

**The transcript is stored inline as `jsonb`.** The alternative that looked
tidiest, keeping only a pointer and refetching from rough-cut, fails the case
the model has to serve: `source_project_id` is nullable precisely because
somebody can upload a plain SRT and never have used rough-cut at all. A pointer
model has nothing to point at for those users. Storing the document also matches
the precedent already in the schema, where `projects.transcript` holds raw
Deepgram JSON the same way. The cost is real and is written down as AC-39: a
document can reach 5 MB, so a list query that selects it moves tens of megabytes
for data no list displays. That is a convention, not a constraint, and it is the
weakest point in this model.

**A regenerated variant replaces its row.** Keeping history would follow the
`ai_cut_runs` precedent, where paid results are kept so a user can compare them.
The difference is what the artifact costs to keep: an `ai_cut_runs` row is a
small JSON blob in Postgres, while a character variant is an image in object
storage that nobody has yet decided when to delete. With retention undecided,
the bounded option is the honest one. The unique constraint on
`(broll_project_id, emotion)` is what makes it true rather than merely intended,
and `attempt` exists so a replaced image cannot serve from a stale cache.

**Four taxonomy columns are `text`, not `pgEnum`.** This breaks the schema's own
convention, which uses an enum wherever a value is constrained, so it needs a
reason. Phase 0 found that a plan with one out of enum `emotion` failed the
entire plan and discarded every valid scene with it, and drew the general rule
from it: strict about claims, lenient about shape. An emotion label is not a
truth claim. The set is also still being tuned, and every enum change is a
migration against a branch Preview reads. `render_status` stays an enum because
a lifecycle state is a different kind of value: it is closed, it is stable, and
an invalid one is a bug rather than a label nobody standardised yet.

**Scenes carry no stored number.** The `ai_cut_runs` table keeps its
`run_number` contiguous and renumbers on delete, and that comment is a warning
as much as a precedent. Scene lists change constantly, since excluding a weak
scene and adding a manual one at 04:12 are both routine, and each would trigger
a renumbering write across the whole project. Ordering by `start_ms` and
computing the export number gives stable filenames with no write at all.

## Reconstruction record

What each part of the model rests on, so a later reader can tell a decision from
an inference.

| Part of the model | Basis | Confidence |
|---|---|---|
| Three table names, the `broll_` prefix | Spec 0001 §5.1, an explicit decision | Decided |
| `source_project_id` nullable, set null | Spec 0001 §5.1, AC-9 | Decided |
| `gen_claim_at` | Spec 0001 §2, shaped after `projects.ai_cut_claim_at` | Decided |
| `hold_micros` | Spec 0001 §2's reserve then settle flow | Decided |
| `last_opened_at` | Spec 0001 §5.3, named explicitly | Decided |
| `chart` jsonb shape with `unit` and `title` | Spec 0001 §5.1 plus Phase 0 rationale §2.1, measured | Decided |
| `credit_ledger` column, CHECK, enum values | Spec 0001 §5.2, AC-10 | Decided |
| No reference photo anywhere | Spec 0001 §5.4, AC-22 | Decided |
| No `credits` column | Spec 0001 §5.2 | Decided |
| Alpha trimmed `width` and `height` | Phase 0 rationale §2.3, plus AC-18 | Decided |
| Six layout templates | Design brief §B6, a fixed list | Decided |
| `plan_runs` | Inferred. AC-25 bills re-runs only, and nothing else in the evidence can tell a first run from a re-run | Inferred, load bearing |
| `strength` and `included` as two fields | Inferred from design brief §B4, "strong scenes checked by default, weak ones unchecked but visible" | Inferred |
| `source_text`, `source_start_ms`, `source_end_ms` | Inferred from design brief §B4 and §B5, the provenance the product sells | Inferred |
| `render_status`, `rendered_at` | Inferred from design brief §B1 and §B7, which show render status on cards and a mixed state batch screen | Inferred |
| `style`, output width, height, fps | Inferred from design brief §B2, "set once per project" | Inferred |
| `byte_size` | Inferred. Nothing asks for it, but the retention decision needs data and it costs one integer | Inferred, cheap |
| `edl_fingerprint` promoted to a column | Inferred. The field exists in the transcript document; lifting it out avoids parsing 5 MB for a comparison | Inferred |
| `emotion` nullable on a scene | Inferred. A chart only or text only scene composites no character | Inferred |
| Source span and `strength` nullable on a manual scene | Design brief §B4 asks for manual scenes, which have no source line. The first draft made these `NOT NULL`, which made a manual insert impossible | Corrected, was a bug |
| Plan re-run charged eagerly under a `broll_plan:` idempotency key | Inferred. AC-25 charges re-runs and nothing said how a double click is stopped. Shape copied from `chargeAiCut`, which solves the same problem | Inferred, load bearing |
| `included` written by the planner, not derived from a threshold | Inferred. The design brief implies a threshold; no evidence anywhere fixes its value, so the number is not invented here | Inferred |
| Stale claim window of 10 minutes | Inferred from the Phase 0 measurement of about 110 seconds per set. The existing `STALE_HOLD_MS` of 10 seconds would reclaim a live run | Inferred |
| Regenerating one variant is not charged again | Inferred. The review gate is a correction path on work already paid for, not a new purchase | Inferred, product judgment |
| Upload, swap, then delete ordering | Inferred. Chooses an orphaned object over a dangling key, because one costs storage and the other breaks a render | Inferred |
| Project card render rollup rule | Inferred from design brief §B1 and §B7. Any failed wins, else all rendered, else not rendered | Inferred |

Every row marked Inferred is a place where the lost document may have said
something different. `plan_runs` and the plan re-run charge shape are the ones to
check first if that document ever resurfaces, because a wrong answer there is a
billing bug rather than a cosmetic one.

## What the cross check changed

A read only critique on a different model reviewed the first draft. It found
seven gaps, all real, and all were applied before this spec was accepted. Two
were billing bugs waiting to happen: plan re-runs had no idempotency guard at
all, and the reference to reusing `@repo/billing` hid the fact that its three
hold functions hardcode `UPDATE projects` and cannot be pointed at another
table. One was a plain error: three `NOT NULL` columns made a manually added
scene impossible to insert, which the design brief explicitly requires. One was
an availability mistake in the first draft's own reasoning, recorded here because
it is the kind of error worth remembering: the draft called the new
`credit_ledger` CHECK "additive and passes against every existing row" and
treated that as proof it was safe. It is proof of correctness and says nothing
about availability. A plain `ADD CONSTRAINT` takes an `ACCESS EXCLUSIVE` lock for
the whole validation scan of a table both live apps write to continuously.

**And then the build found the fix did not work either.** The corrected spec said
to add the constraint `NOT VALID` and validate it as a separate statement.
`drizzle-kit` runs every pending migration statement inside one transaction, so
the lock is held until commit whichever form is used, and the split only means
anything across two migration files applied in two separate runs. The constraint
went back to the plain form, deliberately this time, with the reasoning and the
switch threshold recorded in migration `0015` rather than in a spec nobody reads
at migration time. Worth keeping as a pattern: the cross check caught a real risk,
the first fix for it was wrong, and only running the tooling revealed that. Design
review and build are different instruments.

## References

**Project sources**

- `docs/specs/broll/0001-high-level-design/index.md`, §2, §5.1 to §5.4, and the
  open questions list.
- `docs/specs/broll/0001-high-level-design/verify.md`, AC-8 to AC-10, AC-16,
  AC-18, AC-22, AC-25, AC-37, AC-38.
- `docs/specs/broll/0001-high-level-design/rationale.md`, §2.1, §2.3, §2.6.
- `docs/specs/broll/design-prompt.md`, §B1 to §B7.
- `packages/db/src/schema.ts`, the existing `users`, `projects`,
  `credit_ledger`, `ai_cut_runs` definitions and their column comments.
- `packages/db/AGENTS.md`, the backward compatibility rule and the two Neon
  branches.
- Root `AGENTS.md`, the rule that every balance mutation lives in
  `@repo/billing`.

**Practices and standards**

- Idempotency keys and atomic claims for money operations.
- Additive, backward compatible migrations when old code keeps serving traffic.
- Compute derived values at read time rather than storing them, which is why
  scene count and card render status are computed rather than columns.
