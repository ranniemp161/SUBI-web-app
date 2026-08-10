# 0004 · Rationale: character pipeline

The decision record behind [index.md](./index.md). Not read during a build.

## Context

> ⚠️ **Premise note: AC-17 was stated as an invariant but is not one, and that is
> why this feature had no spec.** Spec 0001 §4 says "image bytes never proxy
> through a Function, presigned R2 URLs only", written about how stored assets
> are *served*. Carried forward into the Phase 2 criteria unchanged, it also
> forbids the one crossing no design can avoid: the Gemini API key is server
> side, so a Function makes the image call and receives the image. Read
> literally, AC-17 and AC-22 together also close both routes the reference photo
> could take to Gemini. An unsatisfiable invariant is worse than an absent one,
> because a builder bends it silently and no reader can tell which way it bent.
> Both criteria are restated in [index.md](./index.md) §1 so the property being
> protected is the one actually written down.

Phase 2 is the first time b roll spends real money on an external vendor and the
first time it stores anything permanent. Both are new surfaces, and the design
document that was supposed to specify them does not exist.

**The lost spec is the shape of the problem.** Spec 0001 was written as a
companion to `broll-generator-spec.md`, an app internal technical spec that was
never checked in and is now gone. Spec 0002 already paid this cost once,
reconstructing the entire data model column by column and marking each row
Decided or Inferred so a later reader could tell evidence from invention. §8.1 of
that same lost document held the multi turn generation design, and §3.3 held the
review gate. What survives is four sentences of summary in spec 0001 §5.4: turns
after the first anchor on the previous output image, the style description is not
restated, re feeding the original photo invites style drift, and regenerating one
variant anchors on the stored neutral PNG. Phase 0 measured that this works,
across six emotions in both shipping styles, at roughly 110 seconds per set. So
the behaviour is known good and the prompt that produced it is not written down
anywhere.

**Three forces constrain the byte flow, and they pull against each other.** The
Gemini API key must stay server side. Background removal was measured client
side, in WASM, at about four seconds an image, and Phase 0's whole finding was
that no server side fallback is needed. And the creator's reference photo is the
single most sensitive item in the system: a real person's face, uploaded to make
a character that will be published under their name. Every reasonable byte flow
satisfies two of the three cleanly and has to be explicit about the third.

**The money shape, unusually, is already settled.** `@repo/billing` already
carries `reserveBrollHold`, `settleBrollHold` and `reclaimStaleBrollHold`, built
during spec 0002's work and documented there as "a character set holds first, a
~110 s run of external image calls, so the money is reserved before the vendor is
paid". The ten minute stale window exists specifically because the ten second one
used for transcription would reclaim a generation still in flight and charge
twice. So this spec inherits a money design rather than making one, and the
remaining money question is not how to charge but *when the charge becomes
final*.

**A ~110 second operation is longer than anything this app has run.** The planner
established the transport (Edge runtime, a 300 second ceiling, a phase line every
five seconds as both heartbeat and progress) but has never been driven against a
live `GEMINI_API_KEY`, so the character pipeline would be its first real test at
five times the duration.

**The storage vendor moved during this design.** Spec 0001 §5.3 chose Cloudflare
R2 over Vercel Blob, on the Hobby plan's failure mode rather than on cost. Part
way through this conversation the engineer chose to use Vercel Blob temporarily,
pending a conversation with the client. That is recorded as a deviation rather
than a supersession, because §5.3's analysis is still correct and this
verification made it more so, not less.

**Compliance scope.** The feature processes a photograph of an identifiable
person's face, which is personal data under GDPR. Whether it is *special
category* biometric data is a real question and the answer appears to be no; the
reading and its limits are in [index.md](./index.md)'s Security model, and the
Follow up puts it to the client rather than settling it here.

## Options considered

### Option 1: One request per turn, the browser drives the chain

Six separate requests. The browser holds the chain state and posts the previous
turn's image back up as the anchor for the next.

**Pros**:

- Each request is short, so nothing depends on a long lived connection or on the
  300 second ceiling holding.
- Progress is inherent: six responses is six visible steps with no streaming
  machinery at all.
- A single failed turn can be retried on its own without re running the chain.

**Cons**:

- Every intermediate image crosses a Function twice, up and down, six times over.
  That is the most Function image traffic of any option, against a criterion
  specifically about minimizing it.
- The claim and hold must span six independent requests, widening the window
  where money is held with no run attached from seconds to minutes, with six
  chances to strand it.
- The client becomes responsible for chain integrity. A browser that reorders,
  skips or replays a turn produces a set whose identity chain silently did not
  happen, and the server cannot tell.

### Option 2: One streamed request, the browser segments and uploads (chosen)

One Function call runs all six turns, streaming each finished image to the
browser as base64 as it lands. The browser segments, trims and uploads each PNG
straight to storage with a presigned PUT, then a second short request commits the
set and settles the money.

**Pros**:

- The chain lives entirely server side, so identity cannot be broken by anything
  the client does.
- It matches the money statements that already exist, exactly: hold first, one
  claim for one run, settle once at the end.
- It reuses the planner's proven transport rather than inventing a second one.
- Image bytes reach storage without touching a Function, and stored assets are
  read without touching one.

**Cons**:

- The whole set depends on one connection surviving about 110 seconds, on a
  transport this repo has not yet driven against a live key.
- The response carries roughly nine megabytes of base64, a third of it pure
  encoding overhead.
- The purchase spans two requests, so the claim is held across a gap the server
  cannot see into.

### Option 3: Segment on the server, browser only ever sees finished assets

The Function calls Gemini, removes the background, trims, and uploads the
finished PNG itself. The browser only ever fetches stored assets.

**Pros**:

- The cleanest possible browser facing story: no raw generated image ever leaves
  the server, and the set is complete the moment the request returns, so the
  commit boundary problem disappears entirely.
- No dependency on the user's machine being able to run a WASM model, so the
  capability gate is unnecessary.

**Cons**:

- It throws away Phase 0's central finding. Segmentation was measured client
  side; `@imgly/background-removal` is a browser library, and running an
  equivalent server side is a different implementation with no measurement behind
  it.
- It adds roughly four seconds per image to a function already running 110
  seconds, pushing well past the ceiling.
- It cannot run on Edge, so it breaks transport parity with the planner.
- It moves a genuinely free cost (the user's CPU) onto metered infrastructure,
  against the grain of a product whose rendering is client side precisely because
  that is free.

## Rationale

**Option 2 wins on the constraint that cannot be negotiated: the identity chain
is the product.** Phase 0's most valuable finding was that character identity
holds across six turns when each anchors on the previous output. Option 1 hands
the ordering and integrity of that chain to a browser, which cannot be verified
and fails silently, producing a set that looks generated but whose identity
guarantee never happened. Keeping the chain in one server side loop makes it
structurally true rather than hopefully true.

Option 3 is the most elegant on paper and loses on evidence. Phase 0 measured
client side segmentation and concluded no server side path was needed; choosing
Option 3 would discard a measurement and substitute an assumption, on a function
that is already the longest running thing in the codebase. The repo's own
standard, set by the evidence before assertion habit visible throughout spec
0002, is that a measured result outranks a tidier design.

**The commit boundary is the one place this design spends complexity
deliberately.** Settling when Gemini returns would be simpler and keeps the
entire money path inside one request, but it charges the user before a single
asset exists, so a crash during segmentation takes two dollars and delivers
nothing. Settling after the browser confirms all six pushes the claim across a
request boundary, which is genuinely more moving parts. It is worth it because
the recovery already exists and was built for this: `reclaimStaleBrollHold` with
a ten minute window, written during spec 0002 with a comment explaining that a
shorter window would rob a generation still in flight. The failure mode of the
simpler option is a silent bad charge; the failure mode of the chosen one is a
ten minute delay before an automatic refund. Those are not comparable.

**On `generateContent` versus the Interactions API.** Google now labels the
`generateContent` image path Legacy and recommends the Interactions API, which
chains turns with a `previous_interaction_id` instead of resending image bytes.
That is cheaper on input tokens and is the vendor's direction. It was declined
for two reasons, one measured and one about the face photo. Phase 0's identity
result was measured by feeding the previous output image back, which is the
`generateContent` mechanism; interaction chaining is a different mechanism and
that measurement would not transfer. And `previous_interaction_id` requires the
vendor to retain the interaction chain, whose first turn contains the creator's
face, for the life of the chain. Having just chosen to keep the photo out of our
storage entirely, handing it to the vendor as a retained, referenced resource
would undo most of what that choice bought. The Legacy label is real and is
recorded as a dated follow up rather than ignored.

**On 1K rather than 2K.** Spec 0001 §8.1 advises generating at 2K because Pro
charges the same for both, and that advice was correct when written. It was
written before the byte flow was decided. Now that every image streams to the
browser as base64, 2K roughly quadruples the pixel count for output that
composites into a 1080p frame, where 1K is already sufficient. Free in dollars is
not free in seconds.

**On Vercel Blob.** The engineer chose it temporarily, pending a client
conversation, and the design accommodates it without bending: private store,
signed GET and PUT, one hour expiry, browser direct upload. Every acceptance
criterion survives. What does not survive is spec 0001 §5.3's reason for
avoiding it, which this design verified and found not merely still true but
understated: the Hobby lockout is real, it is thirty days, and the obvious
mitigation of a separate store does not help because the quota is not per store.
Ruff Cut's transcription pipeline shares that fate. Recording this as a deviation
with a blocking follow up, rather than as a supersession, keeps §5.3's reasoning
intact for the conversation it is about to inform.

## What the cross check changed

The first draft was reviewed on a second model before it was accepted, the same
step that caught two money bugs in spec 0003. It found eleven things and all
eleven were real. Four were load bearing:

1. **The prompt text was missing entirely.** The draft specified the prompt
   module's slots and left the words to the builder, which reproduces exactly the
   hole this spec exists to fill. The Character prompt section in
   [index.md](./index.md) was written in response.
2. **The commit route took a client supplied pathname.** Nothing constrained it
   to the caller's project, so a client could have made `broll_assets.r2_key`
   point at another user's object, defeating AC-38 through a route that looked
   like bookkeeping. Pathnames are now server minted and validated twice (AC-70).
3. **Nothing persisted a regenerated variant.** The regenerate route streamed a
   PNG and no row was ever written, so the review gate's whole purpose did not
   work. Commit gained a `variant` mode (AC-64).
4. **AC-64 and AC-65 contradicted each other.** Deriving the regeneration count
   from `SUM(attempt) - COUNT(*)` counts a paid full re run's six attempt bumps
   as six free regenerations, so a two dollar purchase silently burned half the
   free allowance. A paid re run now resets `attempt`.

The rest were gaps of the same kind, smaller: no photo size cap or format list
behind a named 413, no numeric rate limits, no per turn timeout, no anchor rule
for regenerating `neutral` itself (the blanket rule was circular), no mutual
exclusion between a set run and a regeneration, no cleanup for objects uploaded
by an abandoned run, and a commit that answered 409 on a retry after a lost
response, making a completed purchase indistinguishable from a failed one.

The pattern worth keeping: every one of these is a value or a rule the author
believed was obvious. That is what the check is for, and it is why the value
sourcing table alone was not enough. The table records the sources you thought
to list.

## Evidence: vendor facts verified 2026-08-10

Checked during this design because spec 0001 §8.1 says plainly that model ids and
prices rot, and because rationale §3 of spec 0003 records a wrong deprecation
call made by inferring from a 404 body rather than reading the documentation.

| Fact | Finding |
|---|---|
| Model id | `gemini-3-pro-image` is current, marketed as Nano Banana Pro, and described as the best model for multi turn image generation and editing. |
| Frame control | `imageConfig` accepts `aspectRatio: "3:4"` and `imageSize: "1K"`. The `K` must be uppercase. |
| Multi turn on `generateContent` | Supported: pass the previous output image back as an input part alongside the new text prompt. This is the mechanism Phase 0 measured. |
| `generateContent` status | Labelled Legacy. The documentation states the Interactions API is generally available and recommended. No deprecation date is given and the legacy path still functions. |
| Interactions API chaining | Uses `previous_interaction_id`, a server side reference, rather than resending bytes. |
| Gemini paid tier training | Prompts and images are not used for product improvement or model training by default on a billing enabled project. |
| Gemini paid tier retention | Logs are retained for a default maximum of 55 days, then marked for deletion. Zero Data Retention is available on application and approval. |
| Vercel Blob signed URLs | `issueSignedToken` plus `presignUrl` produce URLs scoped to one operation and one pathname. Default expiry one hour, maximum seven days. The documentation names "without proxying bytes through your function" as an intended use. |
| Vercel Blob browser upload | `handleUploadPresigned` server side plus `uploadPresigned` client side streams the file directly to storage with no bearer token in flight. Client uploads carry no data transfer charge; server uploads do. |
| Vercel Blob access mode | Fixed at store creation and cannot be changed afterwards. |
| Vercel Blob Hobby limit | No overage billing. Exceeding the included usage blocks Blob access until thirty days have passed. |
| Vercel Blob store isolation | Hobby allows 100 stores, but storage, operations and transfer are billed by usage and are unaffected by how many stores exist. Separate stores isolate namespace, not quota. |
| Vercel Blob caching | Blobs are cached up to one month by default; an overwrite takes up to sixty seconds to propagate. The documented practice is to treat blobs as immutable and write a new pathname instead. |

Rough sizing, arithmetic rather than measurement: six trimmed 1K portrait PNGs
with alpha come to roughly five to nine megabytes per project. Storage is not the
near term pressure on the Hobby allowance; data transfer is, because the review
gate and Scene Studio refetch assets on load.

## References

**Project sources** (verifiable, in this repo):

- Spec [0001 high level design](../0001-high-level-design/index.md): §2 the money
  flow, §4 the container view and its invariants, §5.3 the storage decision, §5.4
  the reference photo, §5.6 the asset pipeline, §8.1 the pricing working and the
  regeneration cap.
- Spec [0001 rationale](../0001-high-level-design/rationale.md) §2: Phase 0's
  measured results, including multi turn identity across six emotions and clean
  segmentation in both shipping styles.
- Spec [0002 data model](../0002-data-model/index.md): every `broll_assets`
  column this feature writes, and invariant 5 on the claim and hold pair.
- Spec [0003 scene planner](../0003-scene-planner/index.md) and
  `apps/broll/src/app/api/projects/[id]/plan/route.ts`: the Edge streaming
  transport, the heartbeat, and the terminal line pattern this feature copies.
- `packages/billing/AGENTS.md` and `packages/billing/src/ledger.ts`:
  `reserveBrollHold`, `settleBrollHold`, `reclaimStaleBrollHold`, and the reason
  `BROLL_STALE_HOLD_MS` is ten minutes rather than ten seconds.
- `apps/broll/src/lib/emotions.ts` and `styles.ts`: the six emotions and two
  styles, already fixed as a contract in both directions.
- Root `AGENTS.md`: the `turbo.json` build env list gotcha, and the rule that
  balance mutations have exactly one implementation.
- `docs/specs/broll/design-prompt.md` B2 and B3: the setup and review gate
  screens, including the checkerboard that spec 0001 §5.6 overrides.

**Practices & standards**:

- Reserve before an external call, settle after, so an overdraft is rejected
  before the vendor is paid.
- Idempotency on money operations through an atomic claim rather than a client
  supplied key.
- Treat object storage as immutable and write a new path rather than overwrite,
  so a cache can never serve superseded content.
- Fail before charging: prove the client can complete the work before money
  moves.
- Data minimisation: the most private input is the one never written down.

**Links** (web verified 2026-08-10):

- Gemini 3 Pro Image model: https://ai.google.dev/gemini-api/docs/models/gemini-3-pro-image
- Image generation, Interactions API: https://ai.google.dev/gemini-api/docs/image-generation
- Image generation, legacy `generateContent` path: https://ai.google.dev/gemini-api/docs/generate-content/image-generation
- Gemini API data logging and retention policy: https://ai.google.dev/gemini-api/docs/logs-policy
- Vercel Blob overview: https://vercel.com/docs/vercel-blob
- Vercel Signed URLs: https://vercel.com/docs/vercel-blob/vercel-signed-urls
- Vercel Blob usage and pricing, including the Hobby lockout: https://vercel.com/docs/vercel-blob/usage-and-pricing
