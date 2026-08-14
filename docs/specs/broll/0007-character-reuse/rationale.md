# 0007. Character reuse across projects, reasoning

The build spec is [index.md](index.md). This file is the decision record: why
this was chosen, what else was weighed, and the concern raised before designing.

## Context

> ⚠️ Premise note: this feature is scheduled **after** the four owed
> verifications of features 3 and 4, and its migration deletes every existing
> `broll_assets` row. Run in that order, it destroys the character sets those
> verifications pay for, at $2.00 a set, days after buying them. That is not a
> reason to keep the old rows: there is no column to move them to, and carrying
> a second accepted pathname shape through the security check is a far worse
> price than $2.00. The right framing is a scheduling one. Either apply
> migration `0018` **before** the paid verifications run, so the sets they create
> are already character owned and survive, or accept re-paying and say so out
> loud. The first is strictly better and costs nothing, because this feature does
> not depend on those verifications having happened. What it depends on is
> nobody having watched a Gemini character run succeed yet, and that is the
> second half of the note: if the first real run says the emotion set needs a
> seventh member, every character generated before it becomes incomplete under
> AC-125. Completeness is therefore defined against `CHARACTER_EMOTIONS.length`
> rather than a literal six, so the tuning stays possible, and the question of
> what happens to older characters is enrolled as a follow up rather than
> answered here.

A b-roll character set is six transparent PNGs of the creator, generated from one
photograph through six chained Gemini calls at $2.00 a run, then reviewed by hand
before anything is stored. It is the most expensive thing this app produces and
the only one a human judges before it is kept.

It is also bound to exactly one project. `broll_assets.broll_project_id` is not
null and cascades on project delete, the unique constraint is on
`(project, emotion)`, and the storage path is `broll/<projectId>/…`. So a
creator making their second video uploads the same photograph, waits the same
110 seconds, pays the same $2.00, and reviews six images of a face they already
approved. Nothing in the plan covered that, and it is the kind of charge a user
notices and resents, because they can see it is the same work twice.

Three forces shape how far this can be fixed.

The **storage path is the authorization**. `isCharacterAssetPathname(pathname,
projectId)` is what decides whether `/api/blob/upload` signs a write, and
`apps/broll/AGENTS.md` calls it the whole security of that route. Any new scheme
inherits that job. This is the reason the change is not simply a foreign key
swap: the value that proves ownership is a string in an object store, and it has
to keep proving it.

The **money path is settled and works**. The hold, the ten minute claim, the
idempotent commit and the stale reclaim all live on `broll_projects` and are the
part of this app most carefully reasoned about, in spec `0004`. Anything that
moves them is a much larger and much riskier change than the one being asked
for.

The **storage quota is tight and has a bad failure mode**. Vercel Blob on Hobby
has no overage: exceeding the limit blocks Blob access for thirty days, and Ruff
Cut's audio uploads share the same allowance. Any design that copies six PNGs per
reuse is paying that quota to avoid a schema change.

The price is already decided and is not reopened here: reuse is free, because the
$2.00 buys a reusable character rather than one project's worth of images. That
was the engineer's call at enrollment on 2026-08-14.

## Options considered

### Option 1: copy the assets into the new project

Keep `broll_assets` bound to a project. Reusing a character copies the six
objects to the new project's prefix and inserts six rows against the new project.

**Pros**

- No schema change at all, and no change to the pathname or to the rule that
  authorizes it. The riskiest part of this feature simply does not happen.
- Every project stays fully independent: a regeneration, a delete, or a project
  deletion can never touch another project's images.
- The smallest diff by a wide margin.

**Cons**

- Six permanent PNGs per reuse, on a quota whose failure mode is a thirty day
  lockout shared with another app. The feature would make storage grow in
  exactly the situation it exists to make cheap.
- There is still no such thing as a character. The picker has to list projects,
  a character disappears when the project that happens to hold it is deleted,
  and nothing can be named, so the list gets less usable the more it matters.
- The free regeneration allowance refills on every copy, so unlimited free
  regenerations are available for the price of creating empty projects.

### Option 2: a user owned character that projects point at

A new `broll_characters` table owned by the user. `broll_assets` hangs off the
character, `broll_projects` points at one, and the storage prefix becomes
`broll/characters/<characterId>/`. Reuse is attaching a project to a character
that already exists.

**Pros**

- One character, one set of objects, however many projects use it. Storage stops
  growing with reuse.
- The schema says what the product says. The $2.00 buys a character, and there
  is now a character to buy.
- The allowance, the completeness rule, and the write claim all attach to the
  thing that is actually being written, so each becomes correct rather than
  approximately correct.
- Naming, listing and deleting have somewhere to live, which is what makes a
  library usable past three characters.

**Cons**

- The authorization pathname changes, which is the highest risk edit in the
  feature and the one a mistake in is a cross user read.
- A regeneration now changes work the creator considers finished, in projects
  they are not looking at.
- A character with no projects is never cleaned up by anything, so the missing
  retention policy starts to cost real storage.
- Three surfaces gain new states, including a project that has character scenes
  and no character.

### Option 3: keep the assets per project and add a character as a template

`broll_characters` exists and holds the six images, but attaching one still
copies rows into the project, with the character kept as the master copy to
re-copy from.

**Pros**

- Projects stay independent, so a regeneration cannot change finished work, and
  the character concept still exists for naming and listing.
- Offers a natural place to later add "update this project to the character's
  latest version" as an explicit action.

**Cons**

- Two sources of truth for one face, and the copies drift the moment the master
  is regenerated. This repo has already paid for exactly that shape once, in the
  duplicated ledger the root `AGENTS.md` records.
- It carries option 1's storage cost and option 2's schema cost at the same
  time.
- "Which copy am I looking at" becomes a question the UI has to answer on every
  screen.

## Rationale

Option 2, because the force that decides it is the storage quota rather than
elegance. Copying six permanent PNGs on every reuse spends a shared allowance
whose failure mode is a thirty day lockout of both apps, in order to avoid a
migration on a table that currently holds throwaway rows in one dev branch and
nothing at all in production. That is paying a recurring cost forever to avoid a
one time cost now, at the single moment in this project's life when the one time
cost is close to zero.

The pathname risk is real and is the reason option 1 is not simply dismissed, but
it is bounded in a way the storage risk is not. It is one module, `asset-path.ts`,
which is pure and dependency free, plus two call sites that both already
re-check. The shape of the check does not change, only what the id in it means,
and the whole tail is still validated rather than a prefix, so traversal stays
impossible by construction. That is a change a test can prove. A quota lockout is
not something a test can prove, and it arrives without warning.

Option 3 was the tempting middle and is the one to be most suspicious of. It
promises that finished projects never change while still having a character
concept, but it buys that with two copies of one face and a synchronisation
question on every screen. This repo has a written rule about exactly this
failure, drawn from the ledger that lived twice and drifted in silence. The
honest version of what option 3 offers is versioning, which is a real feature
with a real design, not a side effect of copying rows.

The remaining discomfort with option 2 is genuine and is stated in Consequences
rather than argued away: a regeneration changes work the creator thinks is done.
The mitigation is that they are told which projects will change before it
happens, and that the alternatives are worse. Forking on every regeneration
doubles storage per edit, and freezing regeneration once a character is reused
withdraws the free allowance precisely from the behaviour this feature exists to
encourage.

## What the cross check changed

Cross checked on a second model, which found nine things. Seven were real gaps
and are now closed in the spec, as AC-146 to AC-149 plus three clarifications.

The serious one was in a route this spec was not planning to change much.
`commit` returns early when the assets it was handed are already stored, which is
the idempotency that stops a retried purchase looking like a failed one. That
early return sits **before** the new write that points the project at its
character, so a request that stored six assets and settled the hold and then died
would leave a paid for, complete character with no project pointing at it, and
every retry would return early without fixing it. The attach is therefore its own
idempotent statement, reachable from the repeat branch (AC-146). It is worth
noting how this one hid: the gap only exists because a write was added to a
route whose control flow was designed around a different set of writes.

Three were ordinary missing sources: the attach path never re-checked
completeness server side (AC-147), attaching to an existing project silently
overwrote a style nobody had said would be overwritten (AC-148), and the name cap
was described as "a named maximum" without ever naming it. Two were real but
smaller: the regenerate control had no endpoint to read one character's usage
from a project page, and the two claims being on different rows meant a free
redraw could be spent on a character a paid re-run was about to detach (AC-149).

One finding was wrong in its conclusion and useful anyway. It argued that a
partly failed delete strands objects no sweep can find. It does not: the sweep
lists the storage prefix and deletes anything no `broll_assets` row references,
so deleting the rows is precisely what makes those objects collectable. The spec
now says so, because a reader arriving at the same worry deserves the answer in
the text rather than in the cron route.

And one finding argued a decision rather than found a gap: that an unshared paid
re-run should replace in place instead of orphaning a paid for character. That
was offered during the design and declined, on the grounds that a button whose
behaviour depends on how many projects currently hold the character is a button
nobody can predict. Its cost is real, so it is now written into Consequences
rather than argued away.

Two smaller calls are worth recording. The claim moved to the character because
the project claim stops serializing anything once two projects share a character,
and the loser of that race loses an image with no error, which is the exact
failure AC-72 was written to prevent. And a paid full re-run creates a new
character rather than replacing one, because $2.00 buying a character and then
destroying a character already paid for is not a story that survives being said
out loud, and because a re-run usually means a different photograph, which is a
different person.
