# 0007. Character reuse across projects

**Date**: 2026-08-14
**Status**: In Progress

## Summary

Today a character set belongs to one b-roll project and dies with it, so a
creator who liked their character pays $2.00 again on the next video for a face
they already approved. This spec makes a character something the **user** owns:
a new `broll_characters` table, the six images hanging off it instead of off a
project, and projects pointing at one. Reusing a character on a new project is
free, because the $2.00 buys a reusable character rather than one project's
worth of images. The storage path and the rule that authorizes every read and
write move from the project to the character, which is the part of this change
worth the most care.

## Requirements

**User stories**

- As a creator, I want to pick a character I already generated when I start a
  new project, so I do not pay twice for the same face.
- As a creator, I want the character I reuse to be the one I already reviewed,
  so I do not have to judge six images again.
- As a creator, I want to see every character I own in one place, name them,
  and delete the ones I am done with, so my storage and my picker stay
  meaningful.
- As a creator, I want to be told when other projects depend on a character,
  before I change or delete it.

**Acceptance criteria**

Ownership and schema

- **AC-118**: A character is owned by a user, not a project. `broll_characters`
  carries `user_id` (cascade on user delete). Deleting a project never deletes a
  character.
- **AC-119**: `broll_assets` rows hang off a character:
  `broll_character_id` not null, cascade, unique on
  `(broll_character_id, emotion)`. No asset row references a project.
- **AC-120**: A project references at most one character:
  `broll_projects.broll_character_id`, nullable, `ON DELETE RESTRICT`.
- **AC-121**: Wherever a project has a character, `broll_projects.style` equals
  that character's `style`.

Reuse

- **AC-122**: At project setup a creator may pick a character they own instead
  of uploading a photo. The project is created already attached to it, and its
  `style` is copied from the character rather than chosen.
- **AC-123**: The same picker is offered on an existing project that has no
  character yet. A project that already has one does not offer it: there is no
  swap in this feature.
- **AC-124**: Attaching a character writes no ledger row, takes no hold, and
  changes no balance.
- **AC-125**: Only complete characters are offered. Complete means the character
  has one asset row per member of `CHARACTER_EMOTIONS`, counted from the rows
  rather than read from a status column.
- **AC-126**: Each picker entry shows the character's `neutral` variant as a
  thumbnail, fetched by signed URL straight from the blob host, with the
  character's name as its accessible label.
- **AC-147**: The attach endpoint re-checks completeness itself and refuses an
  incomplete character with 409, rather than trusting that the picker only
  offered complete ones. Same doctrine as every other path here: the server
  re-checks what the client was shown.
- **AC-148**: Attaching a character to an **existing** project overwrites that
  project's `style` with the character's, and the control says so before the
  attach, because the creator chose that style at setup and is having it
  replaced.

Generation

- **AC-127**: Generating from a photo creates a new character owned by the
  caller, named from the project it was generated in, in that project's style.
  The hold and the run claim stay on `broll_projects`, so no money path moves.
- **AC-128**: A commit that stores a full set points the project at the
  character it just filled, in the same request that settles the hold.
- **AC-146**: The attach write is its own idempotent statement and runs on the
  repeat branch too. A commit that stored the assets and settled the hold but
  died before attaching leaves the project attached on the next retry, rather
  than returning early with a paid for character the project does not point at.
  The Neon HTTP driver gives each statement its own transaction, so there is no
  wider one to wrap the three writes in; an idempotent attach is what closes the
  gap instead.
- **AC-129**: A paid full re-run on a project whose character is used by another
  project creates a **new** character and repoints only this project. The
  existing character keeps its assets, its name, and its other projects.
- **AC-130**: A character row created for a run that never commits is removed by
  the sweep cron once it is older than a day and still has no assets.

Regeneration

- **AC-131**: The free regeneration allowance is derived per character
  (`SUM(attempt) - COUNT(*)` over that character's rows) and does not refill when
  the character is attached to another project.
- **AC-132**: A variant regeneration claims the **character**, through
  `broll_characters.gen_claim_at`. Two projects sharing a character cannot write
  the same emotion at once; the second answers 409 `ALREADY_RUNNING`.
- **AC-133**: A regeneration changes the character everywhere it is used, and
  the control names the other projects that will change before it runs. The
  project page reads that list from `GET /api/projects/:id/character`, not by
  fetching the whole characters collection and filtering it in the browser.
- **AC-149**: A paid full set re-run is refused while the project's current
  character holds a live claim. Without it a free regeneration can be spent on a
  character the re-run is seconds from detaching the project from, which is not
  corruption but is a redraw the creator paid attention for and loses.

The characters page

- **AC-134**: `/dashboard/characters` lists the caller's characters with the
  neutral thumbnail, name, style, created date, free regenerations left, and the
  projects using each one.
- **AC-135**: A character can be renamed. The name is free text, capped at
  `MAX_CHARACTER_NAME_CHARS` (60), and is not unique.
- **AC-136**: Deleting a character used by no project deletes its rows and every
  stored object under its prefix. Deleting one in use is refused with 409
  `IN_USE`, naming the projects that hold it. Object deletes are best effort and
  run after the rows are gone: an object left behind by a partly failed delete
  is referenced by no `broll_assets` row, which is exactly what the sweep cron
  looks for, so it is collected on the next run rather than stranded.
- **AC-137**: A project can detach its character and return to having none. This
  moves no money and deletes nothing.

Scenes without a character

- **AC-138**: A project with no character keeps its character scenes. Each shows
  that it needs a character, and both the single render and the batch export
  refuse with that reason rather than a generic failure. Attaching a character
  makes every one of them renderable again with no re-plan.

Limits

- **AC-139**: A user owns at most `MAX_CHARACTERS_PER_USER` characters, counted
  inside the insert. Exceeding it answers 409 before any Gemini call and before
  any charge.
- **AC-140**: Attach, detach, rename and delete go through `writeRateLimit`, the
  fail open limiter, because none of them spends anything at any vendor.

Storage and authorization

- **AC-141**: A character asset lives at
  `broll/characters/<characterId>/<emotion>-<attempt>-<random>.png`. A path in
  the old project shape matches nothing and is never accepted.
- **AC-142**: A presigned PUT is signed only when the pathname is a well formed
  character asset path **and** the character it names belongs to the caller.
  Every stored pathname is re-checked against the character at commit, so a
  client supplied string never becomes a stored `r2_key`.
- **AC-143**: Signed read URLs are only ever minted for characters the caller
  owns. Another user's character id is indistinguishable from a missing one
  (404).
- **AC-144**: The orphan sweep works on the `broll/characters/` prefix, and the
  per run sweep after a commit is scoped to the character rather than to a
  project.

Migration

- **AC-145**: The migration is a clean break. Every existing `broll_assets` row
  is deleted, no old shaped path survives anywhere, and the stored objects under
  the old `broll/<projectId>/` prefix are removed by hand as part of applying it.

## Decision

**Chosen option**: Option 2: a user owned character that projects point at, with
the storage path moved to the character.

A character becomes a first class row the user owns. `broll_assets` hangs off it,
`broll_projects` points at it, and the storage prefix and the authorization rule
both move one level over, from the project to the character. Reuse is attaching
a project to a character that already exists, and it is free.

## Feature design

**Data model**

New table `broll_characters`:

| Column | Type | Null | Notes |
|---|---|---|---|
| `id` | uuid, primary key, defaults random | no | |
| `user_id` | uuid → `users.id`, cascade | no | a character dies with its owner and with nothing else |
| `name` | text | no | snapshotted from the origin project's name at generate time, renameable after |
| `style` | text | no | the style the six images were actually generated in |
| `gen_claim_at` | timestamptz | yes | non null while a regeneration is writing this character. The atomic claim, the same shape as `broll_projects.gen_claim_at`, with the same ten minute stale window |
| `created_at` / `updated_at` | timestamptz | no | |

Index `broll_characters_user_created_idx` on `(user_id, created_at)`, the shape
the picker and the characters page both read by.

There is deliberately **no** `source_project_id` foreign key. The origin project
supplies the name once, as text, and after that the character is independent.
Adding the reference would make `broll_characters` and `broll_projects` point at
each other in both directions for a display string, and would leave a dangling
reference the day that project is deleted, which is exactly the coupling this
feature exists to break.

There is deliberately **no** status or completeness column. Complete means
"has one row per emotion", which the rows already answer, for the same reason
the regeneration count is derived rather than stored.

Changes to `broll_assets`: `broll_project_id` becomes `broll_character_id`
(uuid, not null, → `broll_characters.id`, cascade).
`broll_assets_project_emotion_uq` becomes `broll_assets_character_emotion_uq` on
`(broll_character_id, emotion)`. Every other column keeps its meaning, and
`attempt` in particular, so the allowance arithmetic needs no change at all,
only a different scope.

Changes to `broll_projects`: new `broll_character_id`, uuid, nullable, →
`broll_characters.id`, **`ON DELETE RESTRICT`**. Restrict is what turns "refuse
to delete a character in use" into a property of the database rather than a
check that races a concurrent attach. `hold_micros` and `gen_claim_at` stay
exactly where they are: this feature moves no money path.

**State transitions**

A project's character: `none` → `attached` (by picking, or by a set commit) →
`none` (by detaching). A paid re-run is `attached(A)` → `attached(B)` where B is
a brand new character.

A character: `empty` (row exists, no assets, created at the start of a generate
run) → `complete` (six assets, at commit) → deleted. An `empty` character older
than a day is swept. A character never returns to `empty`: a variant
regeneration replaces one row, it never removes one.

**API surface**

| Endpoint | Method | Key inputs | Key outputs | Auth | Key errors |
|---|---|---|---|---|---|
| `/api/projects/:id/character` | POST | photo (multipart) | stream; `characterId` in the opening line, then one line per turn | Clerk session | 402 balance, 409 already running, 409 character cap, 429, 503 |
| `/api/projects/:id/character/commit` | POST | `mode`, `characterId`, `assets[]`, `costMicros` | stored assets, `settled` | Clerk session | 403 wrong path, 409 no hold, 409 not a fresh character, 422 |
| `/api/projects/:id/character/regenerate` | POST | `emotion` | stream, one image | Clerk session | 404 no character, 409 cap, 409 already running, 429 |
| `/api/projects/:id/character` | GET | none | this project's character, its usage list, its allowance | Clerk session | 404 |
| `/api/projects/:id/character` | PATCH | `characterId: string \| null` | the project's character state | Clerk session | 404, 409 already has one, 409 incomplete, 422 |
| `/api/characters` | GET | none | characters with signed thumbnails, usage, allowance | Clerk session | 503 storage |
| `/api/characters/:id` | PATCH | `name` | the character | Clerk session | 404, 422 |
| `/api/characters/:id` | DELETE | none | ok | Clerk session | 404, 409 `IN_USE` |
| `/api/blob/upload` | POST | pathname (untrusted) | presigned PUT | Clerk session | 401 |
| `/api/cron/character-sweep` | GET | bearer `CRON_SECRET` | counts | cron secret | 401, 503 |

The two project creation server actions (`createProjectFromUpload`,
`importFromRoughCut`) gain an optional `characterId`. When it is present the
`style` input is ignored and the character's style is written instead; when it
is absent the existing style input is required, exactly as today.

**Value sourcing**

| Action | Value produced or displayed | Source |
|---|---|---|
| Generate | `broll_characters.name` | `broll_projects.name` of the project the run started in, snapshotted as text |
| Generate | `broll_characters.style` | `broll_projects.style`, the project's setup choice |
| Generate | the asset pathname | minted server side by `characterAssetPathname(characterId, emotion, attempt)`; never a client value |
| Generate | `characterId` sent to the browser | the row the route just inserted, streamed in the opening line |
| Commit | which character the assets belong to | `characterId` from the request body, re-validated: owned by the caller, and for `mode: "set"` holding zero assets. Every pathname is then checked against that id, which is what makes a mismatched commit impossible |
| Commit | `broll_projects.broll_character_id` | the validated `characterId`, written by its own idempotent statement that also runs on the repeat branch (AC-146) |
| Reuse at setup | `broll_projects.style` | `broll_characters.style` of the picked character |
| Attach to an existing project | `broll_projects.style` | `broll_characters.style`, overwriting the style that project was created with (AC-148) |
| Attach | whether the character is complete | the same row count as the picker uses, re-run server side rather than trusted from the client (AC-147) |
| Regenerate control | the other projects that will change | `GET /api/projects/:id/character`, which resolves the project's character and runs the usage query on it |
| Picker | thumbnail URL | `presignAssetReads` over the character's `neutral` row's `r2_key` |
| Picker | complete or not | `COUNT(broll_assets)` for the character equals `CHARACTER_EMOTIONS.length` |
| Characters page | free regenerations left | `MAX_REGENERATIONS` minus `SUM(attempt) - COUNT(*)` over that character's rows |
| Characters page | the projects using a character | `broll_projects WHERE broll_character_id = :id AND user_id = :caller` |
| Delete | whether the delete is allowed | the same query; empty means allowed, and the `ON DELETE RESTRICT` foreign key is the backstop if it races |
| Regenerate | the anchor image | the character's stored `neutral` row, read by a server signed URL, exactly as today |
| Regenerate | the projects that will change | the usage query above, read before the control is offered |
| Cap check | how many characters the user owns | a count subquery inside the character insert, against `MAX_CHARACTERS_PER_USER` |
| Scene render | whether a character scene can draw | the project's `broll_character_id` plus the emotions its character has committed |

`MAX_CHARACTERS_PER_USER` (**20**) and `MAX_CHARACTER_NAME_CHARS` (**60**) are
new named constants beside `MAX_REGENERATIONS` in `character-prompt.ts`, which is
pure and network free, so the browser can import them for the messages and the
input cap without pulling server code in.

**Key invariants**

1. A character is usable only when it holds one asset per emotion. A partial
   character is never offered and never rendered from.
2. A pathname is a server value. It is minted by the generate route, re-checked
   by the upload route before a PUT is signed, and re-checked again by commit
   before it becomes an `r2_key`. Two checks for one property, unchanged in
   number, moved one level over from the project to the character.
3. A character referenced by any project cannot be deleted. Enforced by the
   application for the message and by `ON DELETE RESTRICT` for the truth.
4. At most one writer per character. A regeneration takes the character claim; a
   full set run writes a character nobody else can be holding, because it just
   created it. The two claims are on different rows by design, so the set run
   additionally refuses while the project's current character is claimed
   (AC-149), which is the only place the two need to see each other.
5. Attach, detach, rename and delete move no money and write no ledger row.
6. An asset row is written before the object it supersedes is deleted, unchanged
   from spec `0004` invariant 6.
7. A project that has a character has that character's style.

**Security model**

Every path resolves a character to its owner before it does anything, the same
way every path resolves a project today. `getBrollCharacter(userId, characterId)`
is the single owner scoped read, and a character belonging to someone else is
indistinguishable from one that does not exist.

The load bearing change is in `/api/blob/upload`. Its authorization is the
pathname, and the pathname now names a character:
`characterIdFromAssetPathname` replaces `projectIdFromAssetPathname`, and the
owner check becomes `getBrollCharacter(user.id, characterId)`. The property that
must survive is the one `apps/broll/AGENTS.md` calls the whole security of that
route: a malformed path must yield no id at all, so there is nothing to look up,
and a well formed path must still be proven to belong to the caller. The regular
expression keeps validating the whole tail rather than a prefix, so traversal
stays impossible by construction.

No compliance scope changes. The reference photograph still has exactly one
lifetime, the generate request, and nothing in this feature stores, logs, or
forwards it (spec `0004` AC-22).

**Configuration required**

None. No new environment variable, no new credential, no new vendor.

**Critical test scenarios**

- Happy path: a creator with one complete character starts a new project, picks
  it, and the project is created attached, in the character's style, with no
  ledger row written. Verifies **AC-122**, **AC-124**, **AC-121**.
- Happy path: a generate run creates a character, commits six assets, and the
  project points at it. Verifies **AC-127**, **AC-128**.
- Failure case: two projects sharing a character regenerate the same emotion at
  once. The second answers 409 `ALREADY_RUNNING` and writes nothing. Verifies
  **AC-132**.
- Failure case: a paid re-run on a shared character leaves the other project's
  assets and character untouched. Verifies **AC-129**.
- Failure case: deleting a character two projects use answers 409 naming both,
  and the row and its objects still exist afterwards. Verifies **AC-136**.
- Failure case: a project detached from its character keeps its character scenes
  and refuses to render them with the specific reason. Verifies **AC-137**,
  **AC-138**.
- Failure case: a commit that stored and settled, then died before attaching, is
  retried and leaves the project attached rather than returning early. Verifies
  **AC-146**.
- Failure case: attaching a five of six character is refused by the endpoint,
  not only hidden by the picker. Verifies **AC-147**.
- Failure case: a paid re-run started while the project's character is being
  regenerated is refused. Verifies **AC-149**.
- Failure case: a user at the cap starts a generate run and is refused before any
  Gemini call, with no charge and no hold. Verifies **AC-139**.
- Auth: a presigned PUT is refused for a pathname naming another user's
  character, and for a well formed path whose character does not exist. Verifies
  **AC-142**.
- Auth: a signed read request for another user's character answers 404, not 403.
  Verifies **AC-143**.
- Boundary: a character with five of six emotions never appears in the picker.
  Verifies **AC-125**.
- Boundary: the allowance after a character is attached to a second project is
  the same number it was before. Verifies **AC-131**.

## Build plan

Tracer Bullet, so task 1 to task 4 are one thin thread through every layer: the
schema, the storage path, the routes, and the screen, all moved to the character
at once, with the app behaving exactly as it does today from the outside.
Nothing is reusable until task 5, and that is deliberate. The alternative,
adding characters beside the existing per project assets and migrating later,
would mean two path shapes and two authorization rules alive at the same time,
which is the one thing this change must not do.

**Tasks 1 to 4 landed 2026-08-14, and the thread is closed.** Lint, typecheck
and the full repo suite are green (475 tests in this workspace, up from 468).
Migration `0018` is applied to the Neon dev branch and confirmed live by
querying `information_schema`: `broll_characters` exists, all three delete rules
are right (cascade on user, cascade on character, restrict on the project's
character), and `broll_assets_project_emotion_uq` is gone in favour of
`broll_assets_character_emotion_uq`. The 18 old asset rows and all 19 stored
objects under the old `broll/` prefix are deleted, as Phase 0 and Phase 2 of the
migration plan require, with the engineer's agreement to re-pay for the three
sets. `createBrollCharacter`, `getBrollCharacter`, `getProjectCharacter` and
`attachCharacterToProject` were each exercised against the live dev branch: the
cap refuses the twenty first character, the owner scoped read answers null for
another user's id, the attach is idempotent, and `ON DELETE RESTRICT` refuses a
delete while a project points at the character. None of it has been watched
running in a browser, which is `/check verify`'s box.

1. ✅ Migration `0018`: create `broll_characters` (with `gen_claim_at` and the
   index), delete every `broll_assets` row, replace `broll_project_id` with
   `broll_character_id` and swap the unique index, add
   `broll_projects.broll_character_id` with `ON DELETE RESTRICT`. Apply to the
   dev branch and confirm live by querying `information_schema`, not by reading
   the file. Satisfies **AC-118**, **AC-119**, **AC-120**, **AC-145**.
2. ✅ `asset-path.ts` moves to the character prefix:
   `characterAssetPathname(characterId, …)`,
   `isCharacterAssetPathname(pathname, characterId)`,
   `characterIdFromAssetPathname`, and the `broll/characters/` prefix, with the
   old project shaped path matching nothing. Update `/api/blob/upload` to
   resolve and check the character. Satisfies **AC-141**, **AC-142**.
3. ◐ `characters.ts` (the new owner scoped query module, the sibling of
   `projects.ts`): create, read, rename, delete, the usage query, the cap
   subquery, and the claim pair. `assets.ts` re-scopes to the character, and
   gains the project to character resolution the pages read through. Satisfies
   **AC-131**, **AC-139**, **AC-143**.

   **Partial on purpose.** Built and used: `createBrollCharacter` (with the cap
   counted inside the insert), `getBrollCharacter`, `getProjectCharacter`,
   `attachCharacterToProject`, plus `countCharacterAssets` and the character
   scoped `listCharacterAssets` / `regenerationsUsed` in `assets.ts`. Not built:
   rename, delete, the usage query and the claim pair, whose only callers arrive
   in tasks 6 and 7. Writing them now would leave four functions on a path whose
   whole risk is a cross user read, with no caller and no test, which is worse
   than writing them beside the code that uses them. The three ACs this task
   carries are satisfied by what landed.
4. ✅ The generate and commit routes create and fill a character: the row before
   turn 1, `characterId` in the opening stream line, the commit revalidation,
   and the project pointed at the character by its own idempotent statement,
   reachable from the repeat branch, as the hold settles. The project page and
   the scenes page read their assets through the project's character.
   **This closes the thread: the app now does exactly what it did before, on
   the new ownership model.** Satisfies **AC-127**, **AC-128**, **AC-146**,
   **AC-144**.
5. ✅ Reuse: the picker at project setup and on a project with no character, the
   optional `characterId` on both server actions, the style copy on both paths,
   and `PATCH /api/projects/:id/character` for attach with its own completeness
   check. Satisfies **AC-121**, **AC-122**, **AC-123**, **AC-124**, **AC-125**,
   **AC-126**, **AC-147**, **AC-148**.

   **Landed 2026-08-14.** Lint, typecheck and the full repo suite are green
   (492 tests in this workspace, up from 475), and `next build` compiles
   `/dashboard/new` and the character route. `/dashboard/new` becomes a server
   component so the picker's thumbnails are signed before the first paint, with
   the form moved to `new-project-form.tsx`; the project page offers the same
   picker only while the project has no character.

   **Three things the build settled that the spec left open.**

   `PATCH` refuses a swap in the statement rather than on a read
   (`attachCharacterIfUnattached` carries `AND p.broll_character_id IS NULL`).
   Reading the project and then attaching on the answer is check then act, and
   what it lets through is exactly the swap AC-123 forbids: two attaches
   arriving together would both see "no character" and the second would replace
   the first. The route still reads first, but only to tell a 404 from a 409.

   "Usable character" is one function, `resolveCompleteCharacter`, shared by the
   attach route and both creation actions, because the drift that matters is one
   path quietly accepting a five of six character. `listPickableCharacters`
   counts completeness in the same statement that reads the rows, so the picker
   and the check cannot disagree either.

   The picker needs no `GET /api/characters`: both screens are server rendered
   and read the list directly, so the endpoint arrives with the characters page
   in task 7, where something actually needs it over HTTP. Detach
   (`characterId: null`) is likewise left to task 7, beside the scenes that lose
   their face.

   **Exercised against the live dev branch**, since no unit test proves a
   `GROUP BY … HAVING` runs on Postgres: a seeded character with five of six
   assets is invisible to the picker and resolves `incomplete`, the sixth makes
   it appear with its `neutral` pathname, another user sees neither, the attach
   copies the style (`3d-render` project, `anime` character, project ends
   `anime`), a second attach answers false, and `ON DELETE RESTRICT` refuses the
   delete while the project points at it. Every seeded row was removed
   afterwards: no vendor call, no money, nothing left behind.
6. ✅ Regeneration on a shared character: the claim moves to
   `broll_characters.gen_claim_at`, `GET /api/projects/:id/character` so the
   project page can name the affected projects, the allowance message stops
   saying "for this project", the paid re-run creates a new character instead of
   replacing in place, and it refuses while the current character is claimed.
   Satisfies **AC-129**, **AC-132**, **AC-133**, **AC-149**.

   **Landed 2026-08-14.** Lint, typecheck and the full repo suite are green (506
   tests in this workspace, up from 492), and `next build` compiles the character
   route with its new `GET`. New code in `characters.ts` (the claim pair, the
   liveness rule and the usage query), the generate, regenerate and commit
   routes, and `character-panel.tsx`.

   **The claim pair left `@repo/billing` rather than moving inside it, and the
   old one was deleted.** `claimBrollGeneration` and `releaseBrollClaim` took
   `broll_projects.gen_claim_at` with a zero `hold_micros`; they lived in the
   billing package because that column is set and cleared with the hold, and one
   writer per money column is why that package exists. The character claim
   touches no balance at all, so it lives beside the rows it protects. Both old
   functions and `BrollClaimResult` are gone from `ledger.ts` and its barrel:
   nothing referenced them afterwards, and a second unused claim implementation
   on a money path is exactly the drift that package was created to end. Two
   lines of `packages/billing/AGENTS.md` still name them.

   **A stale character claim is reclaimed by the claim itself**, not by a sweep.
   The project claim needed `reclaimStaleBrollHold` because it had money to
   refund; here there is none, so "older than ten minutes" simply means the row
   is free and the next claim takes it. The window is `BROLL_STALE_HOLD_MS`
   imported rather than a second literal, so the two cannot drift apart.

   **AC-129 needed no new write.** Every run already creates a character before
   turn 1 and the commit already repoints only this project, so a paid re-run
   forks by construction. What was missing was the sentence saying so: the
   confirm panel claimed the run "replaces all six variants", which was true of
   the old model and is now the opposite of what happens.

   **Exercised against the live dev branch**, since no unit test proves an
   interval predicate or an owner scoped `UPDATE` runs on Postgres: a first claim
   is taken, a second is refused, a release frees it, a claim backdated eleven
   minutes is taken over, another user's id cannot claim or see the usage, and
   the usage query answers the attached project and nothing else. Every seeded
   row was deleted afterwards.
7. `/dashboard/characters`: the list with thumbnails, usage and allowance,
   rename, delete with the in use refusal, and detach from a project. Satisfies
   **AC-134**, **AC-135**, **AC-136**, **AC-137**, **AC-140**.
8. The faceless project: character scenes that say what they need, the render
   and export refusals that say it too, and the sweep cron extended to delete
   empty characters older than a day. Satisfies **AC-130**, **AC-138**.

## Migration plan

**Strategy**: big bang, with no data to preserve.

**Phases**

0. **Check the sequencing before anything else.** Confirm that the four owed
   verifications of features 3 and 4 have not yet been run, or that the engineer
   accepts re-paying for the sets they created. Task 1 deletes every existing
   `broll_assets` row, at $2.00 a set. This is a step rather than advice
   precisely because it is the kind of thing that gets read, agreed with, and
   then not done.
1. Apply migration `0018` to the Neon **dev** branch. Confirm the new table,
   both foreign keys with the right delete behaviour (cascade on user, cascade
   on character, restrict on the project's character), and the swapped unique
   index, by querying `information_schema` on the live branch.
2. Delete every object under `broll/` in the dev Blob store by hand. The rows
   that referenced them are gone, so no sweep will ever look for them: the cron
   scans the `broll/characters/` prefix after this change, and the commit sweep
   is character scoped.
3. Production is not touched by this feature. It carries no b-roll rows and the
   app is not deployed there; migration `0017` has not been applied to it
   either. Both apply together with feature 8, the production deploy.

**Rollback**: revert the commit and restore the previous migration state on the
dev branch. Nothing of value is lost, because the rows this deletes are
throwaway verification output and the branch is rebuilt by generating again.

**Risks**

- The one real cost is money already spent. Any character set generated by the
  owed verifications of features 3 and 4 **before** this migration runs is
  deleted by it, at $2.00 a set. See the note at the top of
  [rationale.md](rationale.md).
- The old and new pathname shapes are both `broll/<something>/<emotion>-…`. The
  new prefix is `broll/characters/`, so an old path cannot be mistaken for a new
  one, but a reviewer skimming the regular expression can mistake one for the
  other. The test for `isCharacterAssetPathname` must include an old shaped path
  as an explicit rejection case.

## Consequences

**Positive**

- A returning creator pays once for a face and uses it forever, which is the
  charge the scope row was enrolled over.
- Every later test project becomes free, so verifying b-roll stops costing
  $2.00 a run. That compounds across the four verifications still owed.
- Character storage stops being duplicated per project by construction, rather
  than by anyone remembering not to duplicate it.
- The regeneration race that this feature would otherwise have introduced is
  closed by moving the claim to the thing being written, which is where it
  should have been if characters had ever been shareable.

**Negative and tradeoffs**

- A regeneration now changes finished work. A creator who redraws one emotion
  changes the face in every project using that character, including ones they
  consider done. The warning that names those projects is the only thing
  standing between that and a surprise, and a warning is weaker than an
  invariant.
- A character that no project uses is never deleted by anything. Only the
  creator deleting it frees the storage, and this app has no retention policy at
  all. The cap of 20 bounds the damage per user and does not remove it.
- **Every paid full re-run orphans six real PNGs, including the common case
  where nobody else was using that character.** A re-run always creates a new
  character (AC-129), so the old one is left behind holding its images, named
  from the same project and therefore near enough identical in the list. The
  alternative, replacing in place when the character has exactly one project,
  was offered and declined: it makes the button's behaviour unpredictable
  before it is pressed. The cost is real and lands on the same Blob quota this
  feature exists to protect, so it is worth revisiting if re-runs turn out to be
  common. The counter is that the orphan is deletable, one click, on a page this
  feature is building anyway.
- The blast radius of a bug in the pathname change is a cross user read. It is
  the same code shape as today, moved one level, which is precisely the kind of
  change that looks safe and is not.
- Three surfaces gain state they did not have: the project setup form now has
  two mutually exclusive paths, the project page now has a project with no
  character but with character scenes, and there is a whole new page.

**Neutral**

- One shared schema migration, in `packages/db`, so it follows the repo's
  `db:generate` plus `db:migrate` path like every other one.
- No new dependency, no new environment variable, no new vendor. Every vendor
  call still goes through `storage.ts`, so the recorded R2 swap stays a one file
  change.
- `broll_projects.style` keeps its meaning and gains a second writer.

## Follow-up

- [ ] Retention. A character outliving every project that used it makes the
      missing retention policy sharper, not new. It belongs with the R2 versus
      Vercel Blob conversation already open with the client, and with
      `broll_projects.last_opened_at`, which was added for exactly this and is
      still unread by anything.
- [ ] `CHARACTER_EMOTIONS` is still being tuned between six and eight members.
      Completeness is defined against its length rather than a literal six, so
      growing the set is safe for new characters and instantly makes every
      existing character incomplete. Decide what happens to characters generated
      before a seventh emotion exists, before adding one.
- [ ] Swapping a project's character is deliberately out of scope. If it is
      wanted later, it needs an answer for the scenes already planned against the
      old character's emotions, which detaching sidesteps by refusing to render
      rather than by guessing.
- [ ] Spec `0004`'s value sourcing table and its "Configuration required" list
      are both still wrong in ways this spec does not fix (the token versus
      images cost derivation, and `BLOB_WEBHOOK_PUBLIC_KEY`). Both are recorded
      in `apps/broll/AGENTS.md` and in the b-roll scope; they belong in an
      update to `0004`.

## Rationale

Reasoning, the options weighed, and the premise note: see
[rationale.md](rationale.md).
