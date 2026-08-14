# Verify: character reuse · spec 0007 · updated 2026-08-14

_Steps derived from spec 0007 acceptance criteria. `/check verify` runs these; `/test` locks the durable ones._

Covers the ownership move (tasks 1 to 4), reuse (task 5) and regeneration on a
shared character (task 6). The characters page and the faceless project are
tasks 7 and 8 and are not built yet, so no step below exercises them.

**Read this first.** Every generate run in these steps spends about $2.00 at
Gemini. Steps are ordered so that one generated set serves as many of them as
possible. The whole point of this feature is that later runs stop costing that,
but not until task 5 lands.

## UI / manual

- [ ] Open a project with no character, upload a photo, press Generate, and watch
      the network tab: the first line of the `POST /api/projects/:id/character`
      response carries `characterId` and nothing else, before any turn arrives
      → AC-127, value sourcing "`characterId` sent to the browser"
- [ ] In the same run, every streamed `pathname` reads
      `broll/characters/<that characterId>/<emotion>-1-<16 hex>.png`, and none
      of them contains the project id → AC-141, value sourcing "the asset pathname"
- [ ] The run completes and the six variants render in the review gate → AC-128
- [ ] `SELECT broll_character_id, style FROM broll_projects WHERE id = '<project>'`
      names the character the stream opened with, and the style equals
      `SELECT style FROM broll_characters WHERE id = '<character>'` → AC-120,
      AC-128, value sourcing "`broll_projects.broll_character_id`"
- [ ] `SELECT name, style FROM broll_characters WHERE id = '<character>'` shows
      the project's name and the project's setup style → AC-127, value sourcing
      "`broll_characters.name`" and "`broll_characters.style`"
- [ ] Reload the project page. The six images still load, fetched by signed URL
      straight from the blob host with no Function in the data path → AC-143
- [ ] Redraw one emotion. The new pathname is under the same character prefix at
      the next `attempt`, the old object is gone from the store afterwards, and
      the allowance on the panel drops by one → AC-131, AC-141
- [ ] Open Scene Studio on the same project. The character templates are
      offered and the emotion picker lists the six committed emotions, all read
      through the project's character → AC-119

## Commands

- [ ] `npm run lint && npm run typecheck && npm run test` → all green
- [ ] Schema is live on the dev branch, read from `information_schema` rather
      than from the migration file: `broll_characters` exists;
      `broll_assets.broll_character_id` is `NOT NULL` and cascades;
      `broll_characters.user_id` cascades; `broll_projects.broll_character_id`
      is `RESTRICT`; `broll_assets_character_emotion_uq` exists and
      `broll_assets_project_emotion_uq` does not → AC-118, AC-119, AC-120
- [ ] `SELECT count(*) FROM broll_assets` was 0 immediately after `0018`, and no
      object remains under a `broll/<uuid>/` path in the store (only
      `broll/characters/`) → AC-145
- [ ] `DELETE FROM broll_characters WHERE id = '<a character a project uses>'`
      is refused by the database with a foreign key violation, not by the
      application → AC-120, invariant 3
- [ ] Allowance is per character and does not refill on reuse: note
      `MAX_REGENERATIONS - (SUM(attempt) - COUNT(*))` for a character, then
      attach it to a second project by hand
      (`UPDATE broll_projects SET broll_character_id = ...`) and read it again.
      Same number → AC-131, value sourcing "free regenerations left"
- [ ] Cap: insert 20 characters for one user, then start a generate run. It
      answers 409 `CHARACTER_CAP`, no Gemini call is made, no hold is taken, and
      `hold_micros` stays NULL → AC-139, value sourcing "how many characters the
      user owns"

## Auth (the part worth the most care)

- [ ] `POST /api/blob/upload` with a pathname naming **another user's** character
      answers 401, and no object is created → AC-142
- [ ] The same route with a well formed path whose character id does not exist
      answers 401 → AC-142, AC-143
- [ ] The same route with an old shaped path, `broll/<projectId>/neutral-1-<16
      hex>.png`, answers 401 even when the id is one the caller owns → AC-141
- [ ] `POST .../character/commit` with a `characterId` belonging to another user
      answers 404, never 403, and stores nothing → AC-143
- [ ] `POST .../character/commit` whose `assets[].pathname` names a different
      character from its `characterId` answers 403 and stores nothing → AC-142

## Recovery

- [ ] AC-146, the one that needs deliberate interference. Generate a set, let the
      commit store the assets and settle the hold, then kill the request before
      it returns (or clear `broll_projects.broll_character_id` by hand
      afterwards, which reproduces the same end state). Post the identical
      commit body again: it answers 200 with `repeat: true`, moves no money,
      stores nothing again, and `broll_projects.broll_character_id` is populated
      afterwards → AC-146
- [ ] A commit naming a character that already holds six assets answers 409
      `NOT_FRESH` and stores nothing
- [ ] Abandon a run after some uploads land, wait past the sweep's age guard, and
      run `GET /api/cron/character-sweep`: it scans `broll/characters/` and
      deletes the unreferenced objects → AC-144

## Reuse (task 5)

Everything here is free. It needs exactly one complete character to exist, so
run it straight after the generate run above rather than paying again.

### UI / manual

- [ ] With one complete character owned, open `/dashboard/new`. A Character
      section offers "New character" plus that character, with its `neutral`
      variant as the thumbnail and its name as the image's alt text → AC-126,
      value sourcing "Picker thumbnail URL"
- [ ] Pick the character. The style buttons disappear and a line says the
      project will use it and in which style → AC-122
- [ ] Create the project. It opens with the six variants already there, no photo
      was asked for and no review was needed → AC-122
- [ ] `SELECT style, broll_character_id FROM broll_projects WHERE id = '<new>'`
      shows the **character's** style, not the one the form last had selected,
      and the character's id → AC-121, AC-122, value sourcing "Reuse at setup"
- [ ] `SELECT * FROM credit_ledger WHERE broll_project_id = '<new>'` is empty,
      and the balance on the dashboard is unchanged → AC-124
- [ ] Repeat with the Ruff Cut import tab rather than the upload tab. Same
      result: character attached, style copied, nothing charged → AC-122, AC-124
- [ ] Open a project created **in a different style** that has no character. The
      "Reuse a character" block sits above the photo picker, and choosing one
      says the project's style changes from its style to the character's, before
      anything is sent → AC-123, AC-148
- [ ] Press Use. The page refreshes with the six variants, and
      `SELECT style FROM broll_projects` is now the character's → AC-148, value
      sourcing "Attach to an existing project"
- [ ] Open that project again. The reuse block is gone, because the project has
      a character and there is no swap in this feature → AC-123
- [ ] Open Scene Studio on the reused project. Character templates draw with the
      reused face, with no re-plan and no regeneration → AC-122

### Commands and boundaries

- [ ] A character with five of six emotions (delete one asset row by hand)
      disappears from both pickers on reload → AC-125, value sourcing "Picker
      complete or not"
- [ ] `PATCH /api/projects/:id/character` with that same five of six character
      answers 409 `INCOMPLETE`, so the refusal is the server's and not the
      picker's → AC-147, value sourcing "Attach, whether the character is
      complete"
- [ ] The same route with **another user's** character id answers 404, not 403,
      and the project is unchanged → AC-143
- [ ] The same route against a project that already has a character answers 409
      `ALREADY_ATTACHED` and changes nothing → AC-123
- [ ] The same route with `{"characterId": "not-a-uuid"}` answers 422 rather
      than a 500 from the driver
- [ ] Calling the two creation actions with a `characterId` belonging to another
      user creates no project at all → AC-143
- [ ] The allowance is the same number before and after a character is attached
      to a second project, read on both project pages → AC-131

## Regeneration on a shared character (task 6)

Free apart from the two steps that say otherwise. It needs **one character
attached to two projects**, which the reuse steps above have already produced:
call them project A and project B.

### UI / manual

- [ ] Open project A. Above the six variants, a line names project B: "This
      character is also used by **B**. Redrawing a variant changes it there
      too." → AC-133
- [ ] With the network tab open, reload project A. The list comes from
      `GET /api/projects/A/character`, and nothing requests a whole characters
      collection → AC-133, value sourcing "Regenerate control"
- [ ] Detach nothing, but open project B. It names project A, not itself → AC-133
- [ ] The allowance line reads "n of 12 redraws left **for this character**",
      and reads the same number on both projects → AC-131
- [ ] Redraw `happy` on project A. When it lands, open project B and reload: B
      shows the same new `happy`, with no re-plan and nothing charged → AC-133
- [ ] Press "Generate a new set from a different photo" on project A. The
      confirmation says a **new** character is drawn, that this project switches
      to it, and that the current character is kept and project B stays on it →
      AC-129

### Commands and boundaries

- [ ] Start a redraw on project A and, while it runs, `POST` a redraw of the
      same emotion through project B. The second answers 409 `ALREADY_RUNNING`
      and stores nothing; the first's image lands → AC-132
- [ ] `SELECT gen_claim_at FROM broll_characters WHERE id = '<shared>'` is non
      null during that redraw and null once it commits → AC-132
- [ ] `UPDATE broll_characters SET gen_claim_at = now() - interval '11 minutes'`
      and start a redraw: it runs, because a claim older than the ten minute
      window belonged to a browser that died and there is nothing to refund →
      AC-132
- [ ] While that same claim is live (set it back to `now()`), `POST` a full set
      run on project A. It answers 409 `CHARACTER_BUSY`, `credit_ledger` gains
      no row and `broll_projects.hold_micros` stays null → AC-149
- [ ] `SELECT gen_claim_at FROM broll_projects WHERE id = 'A'` stays null
      through every redraw above: the claim is on the character now, and nothing
      writes the project's → AC-132
- [ ] **Costs $2.00.** Run the paid re-run on project A to the end. Afterwards
      `broll_projects.broll_character_id` differs between A and B, the old
      character still holds its six `broll_assets` rows and its name, and
      `SELECT count(*) FROM broll_characters` has grown by one → AC-129
- [ ] Project B still draws the old face in Scene Studio, and its allowance is
      whatever it was; project A's is a fresh 12 → AC-129, AC-131
- [ ] `GET /api/projects/<a project that is not yours>/character` answers 404,
      and one of your projects with no character answers 200 with
      `character: null` → AC-143

## Acceptance-criteria coverage

- AC-118, AC-119, AC-120 · the schema command step, plus the RESTRICT step
- AC-127 · the opening `characterId` line and the `broll_characters` row step
- AC-128 · the `broll_projects.broll_character_id` step
- AC-131 · the redraw step and the reuse allowance step
- AC-139 · the cap command step
- AC-141 · the streamed pathname step, the old shaped path auth step
- AC-142 · the three `/api/blob/upload` steps and the mismatched commit step
- AC-143 · the reload step, the other user's `characterId` commit step
- AC-144 · the sweep cron step
- AC-145 · the empty `broll_assets` and empty old prefix step
- AC-146 · the recovery step
- AC-121 · the style column step at setup, and the attach step
- AC-122 · the pick, create and open steps, both intake tabs
- AC-123 · the reuse block disappearing, and the 409 `ALREADY_ATTACHED` step
- AC-124 · the empty `credit_ledger` step
- AC-125 · the five of six disappearing from both pickers
- AC-126 · the thumbnail and alt text step
- AC-147 · the 409 `INCOMPLETE` step on the endpoint itself
- AC-148 · the style change warning step and the column afterwards
- AC-129 · the confirmation wording step, the paid re-run step, and project B
  still drawing the old face
- AC-132 · the concurrent redraw 409, the `gen_claim_at` column steps, and the
  stale claim step
- AC-133 · the naming line on both projects, the network tab step, and the
  redraw landing in the other project
- AC-149 · the 409 `CHARACTER_BUSY` step with no ledger row and no hold
- Not covered here, because tasks 7 and 8 are not built: AC-130, AC-134 to
  AC-138, AC-140
