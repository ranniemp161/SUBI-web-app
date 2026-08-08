# Scope: Ecosystem (repo wide)

Features that span the whole ecosystem: the shared `packages/db`, the Wallet
billing portal, and cross app pricing. App specific work lives in its own scope
(for example `docs/scope/rough-cut/scope.md`).

**Build approach:** Tracer Bullet (vertical slices; each feature built end to end
through every layer, working).
**Workflow:** Beta (after `/develop`, run `/check verify`, then `/test`). The
project's default rigor tier; a feature's own tier tag (e.g. `· GA`) overrides it.

_You are in charge. Every box below is a suggestion, not a gate: run any, skip
any, and mark a feature `done` when you decide it is._

## At a glance

| # | Feature | Phase | Status |
|---|---------|-------|--------|
| A | Demo only free credits gate | Existing | existing |
| B | One money invariant in `@repo/billing` | Existing | existing |
| C | Shared server package `@repo/server-shared` | Existing | existing |
| 1 | USD denominated Wallet | Slice 1 | done |
| 4 | Transcript contract and `@repo/transcript` | Slice 2 | in-progress |
| 5 | Architecture review leftovers | Slice 3 | planned |
| 6 | B-roll money statements in `@repo/billing` | Slice 4 | planned |
| 2 | Auto recharge notification channel | Deferred | planned |
| 3 | AI Cut differentiated retail rate | Deferred | planned |

## Existing

### A. Demo only free credits gate · existing
Shipped off plan (drift, no ADR): `is_member` defaults to `false` and the
automatic monthly credit grant is restricted to a single `MEMBER_ALLOWLIST_EMAIL`,
so everyone else pays through Stripe instead of getting free credits by default
(commits fd01b3d, 0f57c7c).
**Done when:** membership defaults to non member, the monthly grant fires only for
the allowlisted demo email, and existing rows are backfilled to the new default.
code in `apps/rough-cut/src/lib/users.ts`, `packages/db/src/schema.ts`, `packages/db/drizzle/0009_dizzy_human_fly.sql`

### B. One money invariant in `@repo/billing` · existing
Enrolled by `/scope` on 2026-08-08, after the fact. Shipped off plan (no spec) on
2026-08-07 as items 1 and 2 of an architecture review, and it changes the shape of
the ecosystem, which is exactly what this scope covers. The ledger logic lived
twice, once per app, against the same `users` and `credit_ledger` tables, and the
two copies had already drifted in silence: rough-cut's `chargeAiCut` had an
`ON CONFLICT` idempotency guard, wallet's was a bare `UPDATE`, and wallet's whole
434 line copy was dead code no test covered. Pricing lived in three places on top
of that, including `@repo/ui/money.ts`, so server billing code was reaching into
the design system package for a constant.
**Done when:** every charge, hold, settle, refund and deposit in every app runs
through one implementation, the retail rate and the micros conversions have one
home, and `@repo/ui` is design tokens again with `money.ts` deleted.
PRs #115, #116 · code in `packages/billing` (`ledger.ts` needs the database,
`pricing.ts` is pure and safe to import anywhere, including a client component)

### C. Shared server package `@repo/server-shared` · existing
Enrolled by `/scope` on 2026-08-08, after the fact. Shipped off plan (no spec) on
2026-08-07 as item 6 of the same review. Only `ip-rate-limit` was a clean
duplicate; `authz` and `users` had drifted, and the drift mattered. Rough Cut
picked the primary verified Clerk email, wallet took `emailAddresses[0]`, which a
signed in user can influence by attaching an unverified address to their own
profile, and wallet's `getAuthorizedDbUser` provisions rows, so it could write
that address into the `users` row that membership follows. Consolidated on rough
cut's implementation for all three.
**Done when:** authorization, user provisioning, rate limiting and error reporting
have one implementation both apps import, and the safer of each drifted pair is the
one that survived.
PR #119 · code in `packages/server-shared` · see [packages/server-shared/AGENTS.md](../../../packages/server-shared/AGENTS.md)

## Slice 1

### 1. USD denominated Wallet · done
Redenominate the balance from tokens to plain US dollars, add opt in auto
recharge, and give the wallet a premium UI.
**Done when:** the balance reads and spends as US dollars end to end (buy, meter,
hard stop at $0), a user can save a card and auto recharge on their own threshold
safely, existing balances convert with no value lost, and the wallet billing UI is
a premium redesign on the shared theme.
- [x] Design it (ADR): [0002](../../adr/_root/0002-usd-wallet/index.md)
- [x] Build it: `/develop usd wallet`
  - [x] Money ledger: schema rename and conversion migration, credits library in micros, bundle `credit_micros`, balance shown as `$X.XX`, spend and hard stop gate (AC-1..4, AC-8)
  - [x] Auto recharge: Stripe off session card save, settings, cron sweep, daily cap and idempotency, decline handling (AC-5..7)
  - [x] Wallet UI: premium billing UI on `@repo/ui` plus the minimal rough-cut add funds prompt (AC-9)
- [x] Verify it: `/check verify usd wallet` (verified end to end on dev 2026-07-08; the standalone add card path was click tested live in the browser the same day after a gap was found and fixed)
- [x] Test it: `/test usd wallet`
ADR [0002](../../adr/_root/0002-usd-wallet/index.md) · code in `packages/db`, `packages/ui`, `apps/wallet`, `apps/rough-cut`

The long form build record for this feature, including the `/harden` findings that
were closed out the same day, is in the frozen roadmap at
[docs/roadmap/_root/roadmap.md](../../roadmap/_root/roadmap.md).

## Slice 2

### 4. Transcript contract and `@repo/transcript` · in-progress

Enrolled by `/scope` on 2026-08-06, after the fact. The work was driven by b-roll
and tracked there, but it is ecosystem wide by shape: it creates a **new shared
package** and migrates the **shared schema**, which is exactly what this scope
exists to cover. It was invisible here, which is why it is now a row.

**Intent**: One definition of the transcript document that moves between apps, and
one implementation of the frame arithmetic behind it, so two apps can never round
the same timecode differently.
**Done when**: `@repo/transcript` is the only place in the repo that converts time
to frames, the document has one schema that both validates and types it, and Rough
Cut can hand a real file to another app.

- [x] Design it (spec) [0001](../../specs/_root/0001-transcript-contract/index.md)
- [ ] Build it: tracked as **b-roll feature 2's sub boxes**, not repeated here, so
      there is one place to tick. See
      [broll/scope.md](../broll/scope.md) · code in
      [packages/transcript/](../../../packages/transcript/),
      [packages/db/src/schema.ts](../../../packages/db/src/schema.ts) (migration
      `0013`, applied to both Neon branches), and
      [apps/rough-cut/src/lib/export/](../../../apps/rough-cut/src/lib/export/)
- [ ] Verify it: `/check verify transcript contract` (first pass failed 2026-08-06,
      see the b-roll row)
- [ ] Test it: `/test transcript contract`

**Worth knowing before the next shared package:** this one is consumed as raw
TypeScript, so it compiles under each consuming app's `tsconfig`. Rough Cut targets
below ES2020, which ruled out `BigInt` inside the package. A future shared package
inherits the same constraint.

spec [0001](../../specs/_root/0001-transcript-contract/index.md) · status `In Progress`

## Slice 3

### 5. Architecture review leftovers · planned

Enrolled by `/scope` on 2026-08-08. An architecture review on 2026-08-07 produced
seven action items, and six of them shipped that day: items 1 and 2 became feature
B above, item 6 became feature C, item 3 made wallet's auto recharge sweep actually
concurrent and bounded (PR #117), item 4 bounded the transcript `PATCH` and stopped
it stripping `utteranceEnds` (PR #118), and item 7 bounded and paged the project
list, fixing a cursor that was silently dropping rows created in the same
millisecond (PR #120). Two things did not close with them.

**Intent**: Finish the one action item left open, and give the review itself a home
in the repo so the next reader can tell what item 5 actually asked for.
**Done when**: migration `0014` is applied to production and confirmed there, and
the review's findings are written into `docs/reviews/` so nothing depends on a chat
session nobody can reopen.

- [ ] Apply migration `0014` to production. It adds the `projects` index on
      `(user_id, created_at)` that the dashboard query has always wanted, and by
      its own commit note it is rehearsed on the dev Neon branch but deliberately
      **not applied to production**, which stays manual behind the preflight
      prompt. Additive and backward compatible, so nothing is broken while it
      waits, but every dashboard page is a sequential scan plus a sort until it
      lands.
- [ ] Record the review in `docs/reviews/`. It is not in the repo: the newest file
      there is dated 2026-07-15, the working tree is clean, and the only trace of
      the seven items is the commit messages that cite them. Item 5 is described
      only as "the schema session", so whether PR #121's index was the whole of it
      or a piece carved out of it cannot be answered from anything in the repo.

Nothing here is urgent, and nothing here is user facing. It is bookkeeping on work
that already shipped, which is why it is a slice of its own rather than a blocker
on anything else.

## Slice 4

### 6. B-roll money statements in `@repo/billing` · planned `from spec broll/0002`

Enrolled by `/architect` on 2026-08-08, surfaced while designing the b-roll data
model. It belongs here rather than in the b-roll scope because it changes the
shared billing package, and this scope owns the rule that every balance mutation
has exactly one implementation.

**Intent**: Give b-roll its charges, holds and refunds inside `@repo/billing`,
so the money invariant keeps having one home when a third app starts spending.
**Done when**: b-roll can reserve, settle, refund and charge without a single
ledger statement living in `apps/broll`, and a character set can be priced per
call rather than per second.

- [ ] Design it (spec): covered by
      [broll/0002](../../specs/broll/0002-data-model/index.md), build plan steps
      6 and 7. No separate spec needed unless the pricing shape turns out to be
      contentious.
- [ ] Build it: `/develop broll money statements`
  - [ ] Hold pair: `reserveBrollHold` and `settleBrollHold` as **new sibling
        functions**, plus a b-roll stale reclaim on a 10 minute window
  - [ ] Eager charge: `chargeBrollPlanRerun`, shaped like `chargeAiCut`, keyed on
        a `broll_plan:` idempotency key so a double click charges once
  - [ ] Flat rate pricing primitive beside the existing per second one
- [ ] Verify it: `/check verify broll money statements`
- [ ] Test it: `/test broll money statements`

**Bigger than it sounds, and that is the point of enrolling it.** The obvious
reading is that b-roll reuses the proven reserve and settle path. It cannot:
`reserveCredits`, `reclaimStaleHold` and `settleHold` each hardcode
`UPDATE projects` in their SQL, and `reclaimStaleHold` also hardcodes
`transcript_status <> 'processing'`. None of them can be pointed at another
table. Separately, every pricing helper in the package prices per second, because
everything charged so far has been video duration, while a character set is
priced per image call. A cross check caught both before any code was written.

**Blocked on:** the character set price and the image model tier, which are open
questions 2 and 7 in the b-roll high level design.

## Deferred

Out of scope for the current build pass, kept so the plan stays honest.

### 2. Auto recharge notification channel · needs a decision
Notify a user by email (or another channel) when auto recharge declines or gets
auto disabled, closing the seam left open in ADR 0002's auto recharge slice.
Walked through `/architect` on 2026-07-11: picking a real provider felt like
unnecessary scope before client signoff, so this is on hold. In app visibility (the
wallet dashboard already reflects a declined or disabled state) is judged enough
for now.
**Done when:** the client gives a go ahead on outbound billing emails, and a user
whose auto recharge declines or gets disabled after repeated failures is notified
through a real channel, not just a silent state change.
- [ ] Design it (spec): `/architect auto recharge notification channel` (on hold until the client greenlights outbound email)

### 3. AI Cut differentiated retail rate · needs a decision
AI Cut is priced equal to transcription today to keep pricing simple, but its real
compute cost is roughly 7x higher. Revisit once `cost_micros` data shows the true
margin gap.
**Done when:** a pricing decision is made (keep equal, or split the rate) backed by
real usage data, and any rate change is applied.
- [ ] Design it (spec): `/architect ai cut differentiated retail rate`

## Open questions

- **Member monthly grant** (from ADR 0002): the full money era form (a monthly
  dollar grant, separate free minutes, or dropped entirely) is still deferred to a
  client conversation. Feature A above is an interim, demo only stopgap, not the
  final answer.

## Legend

- **Next step** = the first unticked box.
- **needs a decision** = run `/architect` first; otherwise straight to `/develop`.
- **Status** `planned` → `in-progress` → `done`, plus `existing` (predates the
  workflow, `/develop` and `/sync` leave it alone) and `dropped` (de scoped, kept
  for history).
- **Workflow tier tag** beside a heading (e.g. `· GA`) overrides the project
  default for that one feature; no tag means it inherits.

_Migrated from `docs/roadmap/_root/roadmap.md` by /scope on 2026-07-28, worth a quick human pass._
