# Verify: character pipeline · spec 0004 · written 2026-08-10

_Acceptance criteria from [index.md](./index.md). `/check verify` drives these
against the real app; `/test` locks the durable ones. Nothing here can pass until
the code exists._

**Two of these carry an inherited number and a changed meaning.** AC-17 and AC-22
were restated because the originals could not be built as written. Check them
against the wording in [index.md](./index.md), not against spec 0001's
`verify.md`, which still holds the older form.

**Preconditions.** A `GEMINI_API_KEY` with image generation access, a connected
Vercel Blob store created with **private** access, and a b roll project that
already has a transcript. Run against the **dev** database branch
(`ep-holy-hall-aoe13azt`), never production: this spends real money at the vendor
and writes real ledger rows.

---

## Commands

- [ ] `npm run lint` → passes
- [ ] `npm run typecheck` → passes
- [ ] `npm run test` → passes, including `apps/broll`
- [ ] `BLOB_READ_WRITE_TOKEN`, `BLOB_WEBHOOK_PUBLIC_KEY` and `BROLL_IMAGE_MODEL`
      all appear in `turbo.json`'s `build` env array. A Vercel build cannot see a
      variable that is not listed there, and it fails silently as `undefined`.

## Money

- [ ] **AC-14** — Generation reserves before it calls Gemini. Force a concurrent
      spend between reserve and settle and confirm no paid Gemini call ever lands
      against an overdrawn balance. The overdraft must be rejected by the
      `users_balance_micros_nonneg` CHECK (`23514`), before the vendor is called.
- [ ] **AC-15** — Two Generate clicks landing together produce exactly one ledger
      row. The second returns `already_held` and charges nothing.
- [ ] **AC-16** — Every b roll ledger row has a non null `cost_micros`, and the
      character set row carries the summed usage from the six Gemini responses
      rather than the estimate written at reserve. Read the row, do not infer it.
- [ ] **AC-63** — Close the browser after the stream completes but before commit.
      The user is not charged: within ten minutes the claim is reclaimed and the
      balance returns to its starting value. Confirm against the ledger, not the
      cached balance alone.
- [ ] **AC-65** — Generating a full set on a project that already has one writes a
      second `broll_character_set` ledger row at the full price, replaces all six
      assets in place, and **resets every `attempt` to 1** so the paid run has not
      consumed any of the twelve free regenerations.
- [ ] **AC-71** — Commit succeeds, then the identical body is posted again. The
      second call answers 200 with the stored assets, not 409, and writes no
      second ledger row. This is what stops a dropped response looking like a
      failed purchase.

## The byte flow

- [ ] **AC-17** — With the network panel open for a full run: no `/api/*` request
      carries a stored image payload, the six PNG uploads go directly to the blob
      host by presigned PUT, and the review gate's image loads go directly to the
      blob host by presigned GET. The Gemini response arriving at the Function is
      expected and is not a failure of this criterion.
- [ ] **AC-22** — After a complete run, the reference photo exists in no blob, no
      database column and no log line. Search the store, the project row and the
      function logs. This is the criterion most likely to regress quietly, since
      any debug logging added later can break it.
- [ ] **AC-18** — A stored PNG's pixel dimensions equal the character's bounding
      box, not the generation frame, and `broll_assets.width` / `height` match the
      file. Compare the stored numbers against the actual image.
- [ ] **AC-19** — No JPEG exists anywhere between Gemini and storage. Check the
      requested response format, the canvas export call, and the stored object's
      content type.
- [ ] **AC-69** — Regenerate one variant, then reload the review gate. The new
      image appears, not the one it replaced, and the superseded object is gone
      from the store. Confirm the new row's `r2_key` differs from the old one,
      and that the row is written before the old object is deleted.
- [ ] **AC-70** — Post a commit body naming a pathname outside
      `broll/{projectId}/`. It is rejected and nothing is stored. Repeat with a
      **valid pathname belonging to another user's project**, which is the case
      that matters: it must also be rejected. Then confirm the browser never
      chooses a pathname at all, it uses the one the stream sent.
- [ ] **AC-73** — Abandon a run after some uploads have landed (kill the tab mid
      upload). Confirm no object survives under the project's prefix without a
      row referencing it, once the sweep has run.

## Generation

- [ ] **AC-21** — Variants appear one at a time as each turn completes. At no
      point is there an unqualified spinner covering the whole run.
- [ ] **AC-61** — In a browser that cannot run the segmentation model, Generate is
      disabled with a clear message, and no ledger row and no Gemini call result
      from trying. Simulate by blocking the model's fetch.
- [ ] **AC-62** — Force turn 4 to fail twice. Nothing is stored, the hold settles
      as failed, the balance returns to its starting value, and no `broll_assets`
      row exists for the project. A partial set must never survive.
- [ ] **AC-67** — The model id, `3:4` and `1K` come from one module and the model
      id honours `BROLL_IMAGE_MODEL`. Point that variable at a retired model id
      and confirm the error names the model and says it needs a code or config
      change, rather than surfacing a raw vendor error.
- [ ] **AC-68** — Both routes rate limit per user through `@repo/server-shared`,
      checked before any charge: 5 sets per hour, 30 regenerations per hour.
      Exceeding either returns 429 with no ledger row written.
- [ ] **AC-74** — Capture the six outgoing Gemini requests for one run. The style
      description appears in the **first** and in none of the other five, and
      each later request carries the previous turn's output image as an input
      part. This is the identity mechanism Phase 0 measured; if it regresses,
      identity degrades quietly rather than failing.
- [ ] Per turn timeout and run budget hold: stall one turn and confirm it is
      abandoned at 40 seconds and retried, and that the whole run aborts at 240
      seconds rather than running into the route's 300 second ceiling.
- [ ] Photo limits: an 11 MB file returns 413, an unsupported format returns 415,
      and a heic upload is accepted (Gemini takes it) even where the browser
      cannot render a local preview of it.

## Review gate

- [ ] **AC-20** — Cutouts preview on the scene background by default, with a
      working background toggle. Judge a real cutout at high zoom: the artifact
      this exists to reveal is a faint light fringe, which is why the default is
      not a checkerboard.
- [ ] **AC-64** — Regenerating one variant is free (no ledger row), replaces the
      asset in place, and bumps `attempt`. At twelve regenerations across the
      project the control refuses **before** calling Gemini. Verify the count is
      derived as `SUM(attempt) - COUNT(*)`, not stored separately.
- [ ] **AC-72** — Start a full set run and, while it is in flight, attempt a
      regeneration. It is refused with 409 and the in flight run's assets are
      untouched. Then confirm the reverse: a set run cannot start while a
      regeneration holds the claim.
- [ ] Regenerating `neutral` anchors on the **current** stored neutral, read
      before it is replaced, and the control shows the drift warning. Regenerate
      it three times and confirm the character walks away from the original
      photograph, which is expected and is why the copy exists.
- [ ] **AC-66** — The reference photo upload control states, before the file
      picker, all three: we never store it, Google does not train on it, and
      Google deletes it from their logs within 55 days.

## Security

- [ ] **AC-37** — Every new route authorizes server side against the Clerk session
      and scopes its query by `user_id`. No route accepts a `user_id` from the
      client.
- [ ] **AC-38** — A signed in user posting another user's project id gets 404, not
      403, and no signed URL is minted. Separately confirm a signed GET URL cannot
      be replayed for a different pathname, and that it stops working after its
      hour.
- [ ] The blob upload route authorizes **inside** `getSignedToken`. Call it
      without a session and confirm 401. Without that check the route is an
      anonymous write endpoint into the store.
- [ ] The blob store was created with **private** access. This cannot be changed
      after creation, so confirm it before any real data is written.

---

## Notes on coverage

**AC-22 and AC-61 are the two worth re running after any later change here.** The
photo criterion breaks silently: nothing fails, nothing errors, a file simply
starts existing somewhere it should not, and only a deliberate search finds it.
The capability probe breaks expensively: if it stops gating, the first a user
knows is a two dollar charge and a failed run, and we have already paid the
vendor for six images.

**The storage vendor is temporary.** These criteria are written against Vercel
Blob because that is what is being built. If the client conversation moves this to
R2, the criteria hold unchanged in meaning: private store, signed short lived
URLs scoped to one object, browser direct upload and download, no Function in the
data path. Only the vendor specific checks above need rewording.
