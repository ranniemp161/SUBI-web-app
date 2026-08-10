# 0004. Character pipeline

**Date**: 2026-08-10
**Status**: Proposed

## Summary

Turns the creator's photo into six transparent character PNGs, one per emotion,
paid for once and reviewable before use. The generation runs as one streamed
request: a Function calls Gemini six times in a chain, each turn anchored on the
previous picture, and pushes each result to the browser as it lands. The browser
cuts the background out, trims the empty space, and uploads the finished PNG
straight to storage. Money is reserved before the first Gemini call and only
committed once all six assets are actually stored, so a run that dies halfway
refunds itself.

The photo of the creator's face is never written to disk anywhere in our system.
It travels in one request, reaches Gemini, and is gone.

## Requirements

**User stories**:

- As a creator, I want to turn one photo of myself into a set of character
  images in a style I picked, so that my b-roll clips show a character that
  looks like me rather than stock art.
- As a creator, I want to see each cutout before I rely on it, and redo any one
  that came out badly, so that a bad edge around my hair does not end up in a
  published video.
- As a creator, I want to know what happens to my face photo before I upload it,
  so that I can decide whether to.
- As a creator, I want to be charged once for a set, and not at all when the
  generation fails, so that I can retry without watching my balance drain.

**Acceptance criteria** (the contract).

AC-14 to AC-22 are carried from spec
[0001](../0001-high-level-design/verify.md), which is what the scope's feature 3
points at. Two are restated here because the originals could not be built as
written; both restatements are marked and explained in
[rationale.md](./rationale.md) §1. New criteria continue the repo wide sequence
from AC-60, the highest used by spec 0003.

- **AC-14**: Generation debits credits by reserve, then generate, then settle,
  never check then act. A concurrent spend landing between reserve and settle
  never produces a paid Gemini call against an overdrawn balance.
- **AC-15**: A repeated Generate request (a double click, a retry) is rejected by
  the `gen_claim_at` atomic claim and charges once, not twice.
- **AC-16**: Every ledger row b-roll writes populates `cost_micros`, and the
  character set row carries the Gemini call's reported usage rather than the
  estimate written at reserve.
- **AC-17** (**restated**): No image byte is ever proxied through a Vercel
  Function on a path the browser can take itself. Concretely, all three of:
  the browser uploads a finished PNG **directly** to storage with a presigned
  PUT; the browser reads a stored asset **directly** with a presigned GET; and
  no route exists whose job is to relay stored image bytes. The one crossing
  that does happen is the Gemini response arriving at the Function that holds
  the API key, which no design can avoid and which the original wording did not
  contemplate.
- **AC-18**: Stored cutouts are alpha trimmed. A stored PNG's dimensions equal
  the character's bounding box, not the generation frame, and
  `broll_assets.width` / `height` record the trimmed values.
- **AC-19**: No JPEG intermediate exists anywhere between Gemini and storage.
  The image is PNG from the moment it is decoded until the moment it is stored.
- **AC-20**: The review gate previews cutouts on the **scene background** by
  default, with a background toggle available. (This deliberately overrides the
  design brief's B3, which asks for a checkerboard.)
- **AC-21**: Variants populate progressively as each turn completes. The UI never
  shows an unqualified spinner for the full run.
- **AC-22** (**restated, strengthened**): The reference photo is never written to
  persistent storage of any kind: no blob, no database column, no log line, no
  vendor file resource. It exists only as a request body in memory for the
  duration of turn 1.
- **AC-61**: The browser's ability to run the segmentation model is proved
  **before** any money is reserved and before any Gemini call is made. A browser
  that cannot run it sees a clear refusal with Generate disabled, and no ledger
  row is written.
- **AC-62**: A failed turn is retried once. A second failure aborts the whole
  set, settles as failed, refunds in full, and stores nothing. A partial set is
  never left behind.
- **AC-63**: The hold is settled only after all six assets are confirmed stored.
  A run abandoned before that (the tab closes, the browser crashes during
  segmentation) is refunded by the stale claim reclaim, and the user is never
  charged for a set that does not exist.
- **AC-64**: Regenerating a single variant is free and replaces the asset in
  place. Regenerations are capped at twelve per project, counted as
  `SUM(attempt) - COUNT(*)` across the project's assets, and the cap is enforced
  before the Gemini call.
- **AC-65**: Generating a full set again on a project that already has one is a
  new charge at the full set price, and replaces all six assets in place.
- **AC-66**: The reference photo upload control states, before the file picker,
  all three of: we never store it, Google does not train on it, and Google
  deletes it from their logs within 55 days.
- **AC-67**: The model id, aspect ratio and image size are pinned in one place
  and the model id is env overridable. A retired or unavailable model surfaces as
  an actionable message naming the model, not a raw vendor error.
- **AC-68**: The generation and regeneration routes are rate limited per user
  through `@repo/server-shared`, and the limit is checked before any charge.
- **AC-69**: A regenerated variant never serves the image it replaced. The
  replacement is stored at a new pathname, the new row is written first, and the
  superseded object is deleted only after that write succeeds.
- **AC-70**: Storage pathnames are minted by the **server**, never chosen by the
  client. The presigned PUT is scoped to exactly the pathname the server issued,
  and the commit route rejects any pathname outside `broll/{projectId}/`. A
  client cannot cause `broll_assets.r2_key` to point at an object it does not
  own.
- **AC-71**: Commit is idempotent. A retry after a lost response returns 200 with
  the stored assets, not an error, so a dropped reply can never look like a
  failed purchase.
- **AC-72**: A regeneration is refused while a full set run holds the claim, and
  a full set run cannot start while one is already claimed. Two writers never
  race for the same emotion row.
- **AC-73**: No stored object outlives the run that created it without a row
  referencing it. A run abandoned after some uploads leaves no orphans.
- **AC-74**: The style description is stated on turn 1 only and never restated on
  a later turn. Later turns change the expression and explicitly hold everything
  else fixed. This is the mechanism Phase 0 measured identity on, so it is a
  checkable property rather than a prompt writing habit.

## Decision

**Chosen option**: Option 2, a single streamed Function that chains six Gemini
turns and hands each image to the browser, which segments, trims and uploads it
directly to storage.

One request per set. The Function holds the API key and the chain state; the
browser holds the pixels work and the upload. Money is reserved at the start of
that request and settled by a second, separate request once the browser confirms
every asset is stored.

**Storage is Vercel Blob, deliberately and temporarily**, on a **private** store
using signed URLs. Spec [0001 §5.3](../0001-high-level-design/index.md) chose
Cloudflare R2 and its reasoning still stands; that decision is deferred, not
dropped, pending a conversation with the client. See Consequences for the risk
being accepted and Follow up for what gates it.

Reasoning and options: see [rationale.md](./rationale.md).

## Feature design

**Data model sketch**:

**This feature needs no migration.** Every table and column it uses shipped in
migration `0015` and the ledger enum values in `0016`, both applied to the dev
and production branches on 2026-08-08. What follows is what this feature reads
and writes, not new schema.

| Table | Field | Used for |
|---|---|---|
| `broll_projects` | `style` | picks the style description text for turn 1. Required, one of `anime` / `3d-render` |
| `broll_projects` | `hold_micros` | money parked before the first Gemini call. Null when no run holds funds |
| `broll_projects` | `gen_claim_at` | the atomic claim. Set and cleared together with `hold_micros` |
| `broll_assets` | `emotion` | one row per emotion, unique per project via `broll_assets_project_emotion_uq` |
| `broll_assets` | `r2_key` | **holds a Vercel Blob pathname today.** The column is named for spec 0001 §5.3's R2 decision, which is deferred rather than dropped. It has always been an opaque storage key; the name is now inaccurate and is being left alone on purpose, because this repo does not rename a column in the same step as a code change, and the storage decision is about to be revisited |
| `broll_assets` | `width`, `height` | the **trimmed** bounding box, not the generation frame (AC-18) |
| `broll_assets` | `byte_size` | storage accounting for the deferred retention policy |
| `broll_assets` | `attempt` | starts at 1, increments on each regeneration. Its sum across the project is the regeneration count (AC-64), and it makes each replacement a new pathname (AC-69) |
| `credit_ledger` | `broll_project_id`, `cost_micros` | attribution and margin reporting, written by `@repo/billing` |

**State transitions**:

A run, not a stored column. The pair (`gen_claim_at`, `hold_micros`) is the
state, and spec 0002 invariant 5 requires they move together.

```
idle (both NULL)
  -> probe passes -> reserveBrollHold -> claimed+held
       -> six turns succeed -> browser stores six assets -> commit
            -> settleBrollHold {generated} -> idle, assets live, charge stands
       -> a turn fails twice -> settleBrollHold {failed}
            -> idle, nothing stored, refunded in full
       -> browser never commits -> claim ages past 10 minutes
            -> reclaimStaleBrollHold -> idle, refunded in full
```

There is no `awaiting review` state. Stored is accepted: an asset is usable the
moment it is stored, and the review gate is a view over stored assets with a
regenerate control, not a checkpoint that must be cleared.

**API surface**:

| Endpoint | Method | Key inputs | Key outputs | Auth | Key errors |
|---|---|---|---|---|---|
| `/api/projects/[id]/character` | POST | `photo` (req, max 10 MB, one of png/jpeg/webp/heic/heif) | NDJSON stream: `{phase}` heartbeats, then one `{emotion, pathname, png}` per turn, then a terminal line | Clerk session, owner scoped | 402 insufficient credits, 409 already running, 413 photo too large, 415 unsupported format, 429 rate limited, 503 not configured |
| `/api/projects/[id]/character/commit` | POST | `mode`: `"set"` \| `"variant"`; `assets`: six of `{emotion, pathname, width, height}` for `set`, exactly one for `variant` | `{assets, settled}` | same | 409 no hold held (`set` only), 422 wrong asset count for the mode, 403 pathname outside this project |
| `/api/projects/[id]/character/regenerate` | POST | `emotion` (req) | stream: one `{emotion, pathname, png}` then terminal | same | 409 cap reached **or** a set run holds the claim, 404 no anchor asset, 429 |
| `/api/blob/upload` | POST | `handleUploadPresigned` body | a presigned PUT url scoped to one server minted pathname | Clerk session, checked **inside** `getSignedToken` | 401 unauthorized, 403 pathname not this user's project |
| `/api/projects/[id]/character/urls` | GET | none | `[{emotion, url, expiresAt}]`, signed GETs | same | 404 project not found |

The generate and regenerate routes follow the planner's transport exactly:
`runtime = "edge"`, `maxDuration = 300`, a phase line every five seconds as both
heartbeat and progress signal, and every failure after the 200 is committed
arrives inside the terminal line rather than as a status code.

**The pathname is server minted and travels outward only** (AC-70). The route
generates `broll/{projectId}/{emotion}-{attempt}-{random}.png` before each turn
and sends it in that turn's stream line; the browser uses it verbatim and cannot
choose its own. Both the upload route and the commit route independently reject a
pathname outside `broll/{projectId}/` for a project the caller owns. Two checks
for one property is deliberate: this is the path where a client controlled string
would otherwise become a stored `r2_key` pointing at someone else's object.

**`commit` carries both cases because they differ only in money.** `set` requires
all six emotions and settles the hold; `variant` requires exactly one, moves no
money, and is what makes a regeneration durable. A second route would duplicate
the pathname validation, the `head()` sizing and the row write for no gain.

**`commit` is idempotent** (AC-71). If the hold is already released and every
asset named in the body is already stored with a matching pathname, it answers
200 with the stored assets rather than 409, so a lost response cannot make a
completed purchase look like a failed one.

**Value sourcing**:

| Action | Value produced or displayed | Source |
|---|---|---|
| Generate | the six emotion labels and their order | `CHARACTER_EMOTIONS` in `apps/broll/src/lib/emotions.ts`. `neutral` must stay first, see the Character prompt section |
| Generate | the style description text | the Character prompt section above, implemented in `apps/broll/src/lib/character-prompt.ts`, keyed by `broll_projects.style` |
| Generate | every prompt string, turn 1 and turns 2 to 6 | the Character prompt section above, verbatim |
| Generate | the expression descriptor per emotion | the descriptor table in the Character prompt section |
| Generate | the accepted photo formats and size cap | constants in `character-prompt.ts`: 10 MB, png/jpeg/webp/heic/heif |
| Generate | the per turn timeout and whole run budget | constants in `character-prompt.ts`: 40 s and 240 s |
| Generate, Regenerate | the storage pathname | minted **server side** as `broll/{projectId}/{emotion}-{attempt}-{random}.png`, sent to the browser in the stream line. Never chosen by the client (AC-70) |
| Generate, Regenerate | the rate limit thresholds | constants in `src/lib/rate-limit.ts` beside the planner's: 5 per hour for a set, 30 per hour for a regeneration |
| Generate | turn 1 anchor image | the `photo` field of the request body, held in memory only |
| Generate | turn N anchor image, N > 1 | the previous turn's output image, held in the route's local scope |
| Generate | the framing instruction (upper body, waist up) | a constant in `character-prompt.ts`, stated once in turn 1 and not restated |
| Generate | aspect ratio and image size | pinned constants `"3:4"` and `"1K"` in `character-prompt.ts` |
| Generate | the model id | `BROLL_IMAGE_MODEL` env var, default `gemini-3-pro-image` |
| Generate | the background the character is generated on | flat light gray, a constant in the prompt (Phase 0 established this; the light fringe it produces is why AC-20 previews on dark) |
| Generate | price charged | `BROLL_CHARACTER_SET_MICROS` in `@repo/billing/pricing`, env overridable |
| Generate | `cost_micros` | `usageMetadata` summed across the six responses, passed to `settleBrollHold` |
| Commit | `broll_assets.width` / `height` | the browser's trimmed canvas dimensions, sent in the commit body |
| Commit | `broll_assets.byte_size` | a server side `head()` on the stored blob, **not** the client's claim |
| Commit | `broll_assets.r2_key` | the server minted pathname, re validated against the `broll/{projectId}/` prefix before it is stored |
| Commit | `broll_assets.attempt` | 1 on first store; on a free regeneration, the previous row's value plus one; **reset to 1 on a paid full re run**, so a purchase does not consume the free regeneration allowance (AC-64, AC-65) |
| Regenerate | the anchor image | the stored `neutral` asset, fetched server side by signed GET. When the emotion being regenerated **is** `neutral`, the anchor is the current stored `neutral`, read before it is replaced |
| Regenerate | regenerations already used | `SUM(attempt) - COUNT(*)` over the project's `broll_assets` rows |
| Regenerate | the blob pathname | `broll/{projectId}/{emotion}-{attempt}-{random}.png`, a new path each attempt |
| Review gate | the asset image URL | `presignUrl` with `operation: "get"`, one hour |
| Review gate | the preview background | the scene dark token from `apps/broll/src/app/globals.css`; the toggle is component state, not persisted |
| Review gate | regenerations remaining | twelve minus the derived count above |
| Capability probe | pass or fail | running the segmentation model on a small stub image in the browser, before Generate is enabled |
| Upload control | the retention sentence | a constant string; the 55 day figure is Google's published paid tier log retention, cited in rationale References |

**Key invariants**:

1. **Money and claim move together.** `hold_micros` and `gen_claim_at` are set
   together and cleared together. Money with no claim, or a claim with no money,
   is a bug (spec 0002 invariant 5). Enforced inside `@repo/billing`, not here.
2. **Nothing is stored until everything can be.** The capability probe passes
   before money moves; the six assets are stored before the hold settles. There
   is no ordering in which the user is charged for a set that does not exist.
3. **A set is six or it is none.** A run that cannot produce all six emotions
   stores nothing and refunds in full. The planner writes
   `broll_scenes.emotion`, and a scene naming a variant that was never generated
   cannot be composited.
4. **The reference photo has exactly one lifetime**: the body of one request.
   Any code path that writes it anywhere violates AC-22.
5. **A stored asset's dimensions describe the trimmed image**, so a template can
   position a character without downloading it.
6. **Replacement is a new pathname, never an overwrite.** Vercel's CDN caches
   blobs for up to a month and an overwrite takes up to sixty seconds to
   propagate, so overwriting in place would serve the old cutout to the very
   user who just rejected it. Write the new row **first**, then delete the
   superseded object: the other order leaves an emotion with no image at all if
   the write fails.
7. **One writer per project at a time.** `gen_claim_at` gates regeneration as
   well as generation, not just the generate and commit pair. A regeneration
   landing while a full set run is between reserve and commit would have both
   writers racing for the same emotion row, and the loser's work vanishes with
   no error (AC-72).
8. **A pathname is a server value, never a client one.** The only pathnames the
   system will store are ones it minted, for a project the caller owns
   (AC-70).
9. **No object outlives its run unreferenced.** A run that uploads some assets
   and never commits leaves objects no row points at. Commit sweeps the
   project's prefix for unreferenced objects, and a scheduled sweep catches
   runs that never commit at all (AC-73). Without this, every abandoned run
   permanently consumes quota on a plan whose failure mode is a lockout.

**Security model**:

Every route authorizes server side against the Clerk session and scopes each
query by `user_id`, so someone else's project is indistinguishable from a missing
one (AC-37, AC-38 in spec 0001). No route accepts a `user_id` from the client.
The blob upload route is the one that most invites a mistake: authorization
happens **inside** `getSignedToken`, because a presigned PUT route without it is
an anonymous write endpoint into the store.

The store is created with **private** access. Its mode cannot be changed after
creation, so this is a one way door and must be right the first time. Reads use
signed GET URLs scoped to one operation and one pathname, expiring in one hour.
The blob pathname carries a random element so that knowing a project id does not
yield a key.

**Compliance scope.** This feature processes a photograph of an identifiable
person's face, which is personal data under GDPR. It is very likely **not**
special category biometric data: that classification attaches when a photo is
processed "through a specific technical means allowing the unique identification
of a natural person", and this pipeline performs style transfer, not
identification or face matching. The same distinction is why Illinois BIPA,
which covers a "scan of face geometry", is probably out of scope. Both readings
are stated here so the client can confirm them; this is a design note, not legal
advice, and the Follow up carries it as a question for the client rather than a
settled point. What the design does regardless: never persists the photo, tells
the user plainly what happens to it, and relies on a vendor whose paid tier does
not train on it.

**Configuration required**:

- `BLOB_READ_WRITE_TOKEN`: the Vercel Blob store credential, provisioned when
  the store is connected to the project.
- `BLOB_WEBHOOK_PUBLIC_KEY`: verifies the upload completed callback that
  `handleUploadPresigned` receives.
- `BROLL_IMAGE_MODEL`: the image model id. Defaults to `gemini-3-pro-image`.
  Overridable so the Flash comparison, and any future model rot, is a Vercel env
  change rather than a code change.
- `GEMINI_API_KEY`: already present and already in `turbo.json`.

**Every one of the first three must be added to `turbo.json`'s `build` env
list.** The root `AGENTS.md` records what this costs when it is missed: a
variable set in Vercel but absent from that list reads as `undefined` during
`next build`, with no error.

**Critical test scenarios**:

- Happy path: a project with a transcript and a photo produces six stored,
  trimmed, transparent PNGs visible in the review gate, charged once. Verifies
  **AC-14**, **AC-18**, **AC-21**.
- Failure case: turn 4 fails twice. Nothing is stored, the hold settles as
  failed, the balance returns to its starting value, and no `broll_assets` row
  exists. Verifies **AC-62**.
- Failure case: the browser is closed after the stream completes but before
  commit. Ten minutes later the claim is reclaimed and the user is whole.
  Verifies **AC-63**.
- Failure case: two Generate clicks land together. The second gets
  `already_held` and no second ledger row is written. Verifies **AC-15**.
- Failure case: a browser that cannot run the segmentation model never reaches
  `reserveBrollHold`, and the ledger is untouched. Verifies **AC-61**.
- Regeneration: replacing one variant writes a new pathname, writes the row
  before deleting the old object, bumps `attempt`, moves no money, and the review
  gate shows the new image rather than a cached old one. Verifies **AC-64**,
  **AC-69**.
- Auth: a signed in user posting another user's project id receives 404, not
  403, and no blob URL is minted. Verifies **AC-38**.
- Auth: a commit body naming a pathname outside `broll/{projectId}/`, including a
  valid pathname belonging to another user's project, is rejected and stores
  nothing. Verifies **AC-70**.
- Failure case: commit succeeds but its response is lost; the client retries the
  identical body and receives 200 with the stored assets. Verifies **AC-71**.
- Failure case: a regeneration is attempted while a full set run holds the claim
  and is refused, leaving the in flight run's assets intact. Verifies **AC-72**.
- Failure case: a run uploads four of six assets and is abandoned. No orphaned
  object survives the sweep. Verifies **AC-73**.
- Identity: the style description appears in the turn 1 request and in none of
  the five that follow. Verifies **AC-74**.
- Photo handling: a full run leaves no blob, no column and no log line
  containing the uploaded photo. Verifies **AC-22**.

## Character prompt

This section is the reconstruction of the lost `broll-generator-spec.md` §8.1. It
is the whole content of `apps/broll/src/lib/character-prompt.ts`.

**Read this before changing a word of it.** Phase 0 measured that the *approach*
holds identity across six emotions in both styles: anchor each turn on the
previous output, do not restate the style. It did not measure these exact
sentences, which are written here for the first time. Treat them as a first draft
that must be looked at against real output before the set price is charged to
anyone, and see Follow up.

**Turn order is the array order in `emotions.ts`, which starts with `neutral`.**
That is load bearing in two directions: turn 1 is the only turn that sees the
photograph, and the stored `neutral` asset is what every later regeneration
anchors on. If that array is ever reordered so `neutral` is not first, the
regeneration path loses its anchor.

**Style descriptions** (keyed by `broll_projects.style`, stated on turn 1 only):

- `anime`: *a clean modern anime illustration, cel shaded, with crisp linework,
  flat colour fills and minimal gradients*
- `3d-render`: *a polished 3D character render with smooth stylised proportions,
  soft studio lighting and subtle subsurface skin shading*

**Shared fragments**, used on turn 1:

- Framing: *Frame the character from the waist up, centred and facing the viewer,
  with the head and shoulders fully inside the frame and a small margin of space
  above the hair.*
- Background: *Place the character on a completely flat, even light grey
  background. No gradient, no vignette, no cast shadow, no floor line, and no
  scene elements of any kind.*
- Lighting: *Light the character evenly from the front with soft neutral light
  and no strong cast shadows.*

The margin above the hair and the explicit "no cast shadow" both exist for the
alpha trim and the background removal. A character cropped at the crown trims
badly, and a cast shadow survives segmentation as a grey smear on the very edge
the product is judged by.

**Expression descriptors**, one per emotion. Each names both the face and the
body, because at 1K in a composited frame the face alone is too small to carry
six distinguishable states:

| Emotion | Descriptor |
|---|---|
| `neutral` | relaxed and attentive, mouth closed, looking directly at the viewer |
| `happy` | a warm genuine smile with the eyes creasing slightly, shoulders relaxed |
| `surprised` | eyebrows raised, eyes wide, mouth slightly open, leaning back a little |
| `thoughtful` | eyes directed slightly up and away, one hand near the chin, brow lightly furrowed |
| `skeptical` | one eyebrow raised, head tilted slightly, mouth set in a flat line, chin drawn back |
| `excited` | a broad open smile, eyes bright and wide, leaning slightly toward the viewer, hands open |

**Turn 1** (input parts: the uploaded photograph, then this text):

> Create a character based on the person in this photograph, drawn as {STYLE}.
>
> Keep the person's recognisable features: face shape, hair colour and style,
> skin tone, eye colour, and any glasses or facial hair. Do not copy the
> photograph's clothing, lighting, background or pose.
>
> Dress the character in simple plain clothing with no text, no logos and no busy
> patterns.
>
> {FRAMING}
>
> Expression: {DESCRIPTOR.neutral}
>
> {BACKGROUND}
>
> {LIGHTING}

The plain clothing instruction is not cosmetic. Text, logos and busy patterns are
the details that drift most visibly between turns, and six variants of one
character that disagree about the writing on the shirt read as six different
characters.

**Turns 2 to 6** (input parts: the **previous turn's output image**, then this
text). The style, framing, background and lighting are deliberately absent:

> This is the same character. Change only the facial expression and the body
> language that goes with it.
>
> New expression: {DESCRIPTOR[emotion]}
>
> Everything else stays identical: the same face, the same hair, the same
> clothing, the same framing, the same flat light grey background and the same
> lighting. Do not restyle the character, do not move the camera, and do not add
> anything to the background.

**Regenerating one variant that is not `neutral`** (input parts: the stored
`neutral` asset, then the turns 2 to 6 text above, unchanged).

**Regenerating `neutral` itself** is the one case that needs its own wording,
because the blanket rule "anchor on the stored neutral" is circular here and the
original photograph is gone by then (AC-22). Input parts: the **current** stored
`neutral` asset, read before it is replaced, then:

> This is the same character. Produce a fresh version of this same character with
> the same relaxed, attentive neutral expression, keeping the face, hair,
> clothing, framing, background and lighting identical. Vary only the fine detail
> of the drawing.

**This path drifts and cannot be undone**, and the review gate must say so. Each
regeneration of `neutral` anchors on the previous regeneration, so the character
walks away from the original photograph one step at a time with no way back. The
only recovery is a full re run with a fresh upload, which is a new charge
(AC-65). The control's copy: *Redrawing your base character moves it a little
further from your photo each time. To start over from the photo, generate the set
again.*

**Generation parameters**, pinned in this module:

| Parameter | Value | Why |
|---|---|---|
| model | `BROLL_IMAGE_MODEL`, default `gemini-3-pro-image` | identity proven at Pro in Phase 0; env overridable so a tier change is config |
| `imageConfig.aspectRatio` | `"3:4"` | an upper body character fills a portrait frame, so the trim discards little |
| `imageConfig.imageSize` | `"1K"` | sufficient for a 1080p composite. The `K` must be uppercase |
| per turn timeout | 40 seconds | six turns plus one retry fits inside the 300 second ceiling |
| whole run budget | 240 seconds | abort regardless, so one hung turn cannot consume the budget before the retry fires |
| retries per turn | 1 | then abort the set and refund (AC-62) |

## Build plan

Tracer Bullet, in the shape this workspace already used for the planner: a pure
contract first, then one thin thread all the way through every layer, then
thicken. The thread deliberately runs through storage on task 3, because storage
is the only genuinely new infrastructure here and a thread that stops short of it
proves the least interesting part.

1. **The storage seam and the capability probe.** `src/lib/storage.ts` (app
   local, per spec 0001 §5.3) wrapping `issueSignedToken`, `presignUrl` and
   `del`, the server side pathname minting, `/api/blob/upload` with
   authorization and prefix validation inside `getSignedToken`, plus the browser
   side probe that runs the segmentation model on a stub image. Nothing generates
   yet. Satisfies **AC-17**, **AC-61**, **AC-70**.
2. **The prompt module.** `src/lib/character-prompt.ts`, written from the
   Character prompt section above verbatim: the two style descriptions, the
   shared fragments, the six expression descriptors, the three prompt templates,
   the pinned `3:4` and `1K`, the timeouts, the photo caps, the model id from
   env, and the error translation for an unavailable model. Pure and unit
   testable, no network. The style stated once is asserted in a test, which is
   what makes **AC-74** a fact rather than an intention. Satisfies **AC-67**,
   **AC-19**, **AC-74**.
3. **The thin thread, one emotion.** A route that takes a photo, runs turn 1
   only, streams the PNG and its server minted pathname down, and a client that
   segments, trims, uploads by presigned PUT and commits one `broll_assets` row
   that appears on screen. No money, no chain, no review gate. This is the whole
   spine working, storage included. Satisfies **AC-18**, **AC-20**.
4. **The full chain.** Six turns, each anchored on the previous output with the
   style not restated, streamed per turn with the planner's heartbeat, the per
   turn timeout and run budget, and the retry once then abort behavior.
   Satisfies **AC-21**, **AC-62**.
5. **Money and the commit boundary.** `reserveBrollHold` before turn 1, the
   commit route in both modes, idempotent, `settleBrollHold` after six confirmed
   assets, `reclaimStaleBrollHold` on the retry path, and `cost_micros` trued up
   from the summed usage. Satisfies **AC-14**, **AC-15**, **AC-16**, **AC-63**,
   **AC-71**.
6. **The review gate.** The scene dark preview with its toggle, per variant
   regeneration anchored on the stored neutral (with its own wording when the
   variant is `neutral`, and the drift copy), the derived cap, the claim gate
   that refuses a regeneration mid run, and write the row then delete the
   superseded object. Satisfies **AC-64**, **AC-69**, **AC-72**.
7. **The remaining edges.** The full re run charging again and resetting
   `attempt`, the rate limits on both routes, the photo upload copy, and the
   orphan sweep on commit plus its scheduled counterpart. Satisfies **AC-65**,
   **AC-66**, **AC-68**, **AC-73**.
8. **The photo audit.** Read every path the photo touches and confirm nothing
   writes it, including error handlers and any logging added along the way.
   Satisfies **AC-22**.

## Consequences

**Positive**:

- No migration. Every column this feature needs already exists and is live on
  both database branches, so the riskiest kind of change is absent entirely.
- The money path is already built and already reasoned about.
  `reserveBrollHold`, `settleBrollHold` and `reclaimStaleBrollHold` were written
  for exactly this shape, including the ten minute stale window sized for a
  generation this long. This feature wires them up rather than inventing them.
- The transport is the planner's, proven in code and covered by tests: Edge,
  300 second ceiling, heartbeat phase lines, terminal line carrying post 200
  failures.
- The face photo posture is genuinely strong. It is never written anywhere, and
  every claim the upload copy makes is verifiable today.

**Negative / tradeoffs**:

- **Vercel Blob reactivates the exact risk spec 0001 §5.3 chose R2 to avoid, and
  it is worse than that section knew.** Hobby has no overage: exceeding the
  limit blocks Blob access for thirty days. Ruff Cut already runs its audio
  uploads through Blob on the same account, so b roll usage can take Ruff Cut's
  transcription pipeline offline. The obvious mitigation does not work: Hobby
  allows a hundred Blob stores, but storage, operations and transfer are billed
  by usage and are not affected by how many stores exist. A separate store
  isolates the namespace, not the quota. This is accepted deliberately and
  temporarily; the Follow up gates it.
- The six images stream to the browser as base64, which inflates them by about a
  third. At 1K portrait that is roughly nine megabytes down a single response.
  Acceptable, and the reason 2K was declined despite being free at Pro.
- Two requests now span one logical purchase. The claim is held across the gap
  between the stream ending and the commit landing, which is a wider window than
  a single request would have. The stale reclaim closes it, but it is a real
  extra moving part.
- Building on `generateContent` means building on a path Google now labels
  Legacy while recommending the Interactions API.
- The character framing (upper body, waist up) is a contract with Phase 4's
  templates made before a single template exists. If a template later wants a
  full body character, that is a regeneration of every set, not a code change.
- **The prompt text in this spec has never been run.** Phase 0 proved the
  approach, not these sentences. The first real generation is also the first test
  of the wording, and prompt quality is the one thing here that no unit test can
  catch.
- Regenerating `neutral` repeatedly drifts the character away from the original
  photograph with no way back, because the photograph is deliberately not kept.
  The only recovery is a fresh upload and a new charge. That is a direct cost of
  the AC-22 posture and it is being accepted knowingly.
- Abandoned runs consume storage quota until a sweep removes them, on a plan
  whose failure mode is a thirty day lockout. The sweep is specified, and on
  Hobby a scheduled one can run only once a day.

**Neutral**:

- `broll_assets.r2_key` now holds a Vercel Blob pathname. The name is wrong and
  is staying wrong on purpose until the storage decision settles.
- Two new dependencies: `@vercel/blob` and `@imgly/background-removal`. The
  second is browser only and must not reach a server bundle.
- The review gate contradicts the design brief's B3 on the preview background.
  That override was already decided in spec 0001 §5.6 for a measured reason;
  this spec inherits it rather than reopening it.

## Follow-up

- [ ] **Have the client conversation about storage, and treat it as blocking
      general availability rather than blocking this build.** The question is
      whether to accept Ruff Cut and b roll sharing one Blob quota with a thirty
      day lockout as the failure mode, move to R2 as spec 0001 §5.3 decided, or
      move the account to Pro where the lockout becomes a bill. Contain the
      answer behind `src/lib/storage.ts` so the swap stays a one file change.
- [ ] **Look at the prompt's real output before charging anyone.** The wording in
      the Character prompt section is a first draft reconstructing a lost
      document. Generate one set per style against a real photograph, judge
      identity across all six emotions and the cleanliness of the cutout at high
      zoom, and revise the wording in this spec before the price is live. This is
      a human judgement step; no test replaces it.
- [ ] Confirm with the client that a style transfer pipeline over a face photo
      is not being treated as biometric processing in their jurisdictions. The
      design's reading is in the Security model above; it is a reading, not
      advice.
- [ ] Re check the Legacy status of `generateContent` before Phase 4, and note
      that this now applies to spec 0003's planner decision too. Spec 0003's
      rationale §3 concluded the deprecation signal was wrong, reading the docs
      as they stood then; the docs now head that section "Legacy" and recommend
      the Interactions API, with no deprecation date given. Nothing is broken and
      nothing needs changing today.
- [ ] Run the `gemini-3.1-flash-image` comparison against real user photos once
      this phase has any, closing spec 0001's open question 7. `BROLL_IMAGE_MODEL`
      exists so the switch is a config change.
- [ ] Re check Google's image pricing before treating spec 0001 §8.1's table as
      current. It was verified 2026-08-09 and that section says plainly that
      model ids and prices both rot.
- [ ] Size the regeneration cap against real data. Twelve came from arithmetic in
      spec 0001 §8.1, not measurement, and that section asks for this.
- [ ] Decide the retention policy for stored character images before general
      availability. `last_opened_at` exists for it; nothing uses it yet.

## Rationale

Reasoning, the options weighed, and the evidence behind the current vendor facts:
see [rationale.md](./rationale.md).
