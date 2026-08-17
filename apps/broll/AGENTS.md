# B-Roll Generator (apps/broll)

## Overview
Takes a timed transcript and a photo of the creator, and returns a folder of
short, timecode-named B-roll clips ready to drag into an NLE. The transcript
comes from Rough Cut's export, so this is the second half of one workflow rather
than a separate product. **The output is not a finished video**: it is a batch of
independent 4 to 8 second assets that slot into an edit already in progress.

Runs on port **3003**. Shares the Clerk instance and the Neon database with
`apps/rough-cut` and `apps/wallet`; deep-links to Wallet for every top-up and
never processes a payment itself.

**Status: Phases 1 to 7 built, not yet verified.** A user can create a project by
uploading a transcript or inheriting one from Ruff Cut, plan scenes, generate a
six emotion character set that is segmented, trimmed and stored, reuse a
character they already own on a new project for free, review and edit the plan on
a list and detail Scene Studio screen at `/dashboard/[id]/scenes`, and render
scenes to MP4 in the browser, one at a time or as a whole batch downloaded as a
zip. Four of the six planned templates draw today (`chart-full`,
`character-left`, `character-center`, `text-card`).

**An unticked `/check verify` box does not mean the feature is unexercised, and
reading it that way has already produced one wrong status report.** Seven
`Verify it` boxes are open across the scope and the two written verify sheets are
mostly unticked, but that records which **ritual** has been run, not which
behaviour works. The engineer develops by driving each feature in the browser as
it is built, and the character pipeline and the scene planner have both been run
against **live Gemini** and work (confirmed 2026-08-16). What the open boxes
genuinely mean is that no one has walked a written acceptance sheet criterion by
criterion and recorded the evidence. Ask before describing anything here as
untested. The scope is the live plan; check it before trusting this line.

## Key files
| File | Owns |
|---|---|
| `src/proxy.ts` | Clerk auth gate plus the public-route allowlist (landing page and the sign-in pages only). Everything else needs a session, because every row here is scoped by `user_id`. Named `proxy.ts`, not `middleware.ts` — Next.js 16 renamed it |
| `src/lib/env.ts` | Validated cross-app URLs (`ROUGH_CUT_URL`, `WALLET_URL`) — the only place allowed to read `NEXT_PUBLIC_*` cross-app vars. Throws at import time in production if unset |
| `src/app/dashboard/page.tsx` | The project list. The **explicit column list is load-bearing**, see Conventions |
| `src/app/globals.css` | This app's local surface treatment on top of `@repo/ui`'s ecosystem tokens. Dark only, no light mode |
| `src/app/actions.ts` | The two intake paths, `createProjectFromUpload` and `importFromRoughCut`. **May export nothing but async functions, not even a type** — `actions.test.ts` guards that, see the root AGENTS.md for what it cost Rough Cut |
| `src/lib/projects.ts` | Every `broll_projects` query, and the home for this feature's shared types (they cannot live in `actions.ts`) |
| `src/lib/styles.ts` | The character styles, pure so the client form can import it without pulling server code into the browser |
| `src/lib/asset-path.ts` | The only place that decides what a stored asset's pathname looks like. Pure and dependency free. Validates the whole shape, not a prefix, so traversal is impossible by construction rather than filtered |
| `src/lib/storage.ts` | The Vercel Blob seam: signed reads, byte size checks, deletes, the orphan sweep. **App local on purpose**, not in `packages/server-shared` — Ruff Cut's blob use is ephemeral audio, b-roll's is permanent PNGs read by signed URL. Every vendor specific call lives here so the recorded R2 swap is a one file change |
| `src/lib/segmentation.ts` | Background removal in the browser plus the capability probe. **Browser only**; never import from a route or server component |
| `src/lib/trim.ts` | Alpha trim. `alphaBounds` is pure so the off by one that would shave the character's outermost column is tested without a canvas |
| `src/lib/character-prompt.ts` | The reconstructed prompt wording, the pinned model and image settings, and `describeModelError` / `isPermanentModelFailure`. Pure and network free, so the wording is unit testable |
| `src/lib/character.ts` | The six Gemini image calls, the timeouts and the retry. Server only, holds `GEMINI_API_KEY` |
| `src/app/api/projects/[id]/character/` | Generate (streamed, Edge), regenerate, commit, and signed read URLs |
| `src/app/api/blob/upload/route.ts` | Presigns one character asset PUT. **The authorization inside `getSignedToken` is the whole security of this route** — without it this is an anonymous write endpoint into the store |
| `src/app/dashboard/[id]/character-panel.tsx` | The pipeline's whole browser half: reads the stream, cuts out, trims, uploads straight to storage, and owns the review gate |
| `src/lib/render/renderable.ts` | **The app's only `switch` on template.** The page preview and the encoder both draw through `drawRenderable`, which is what stops what a creator judges on screen differing from what lands in the file. A new template is one case here |
| `src/lib/render/context.ts` | The narrow 2D surface every template draws through, assignable from both canvas context types. One interface for all templates, so the tests can pass a recorder and assert draw calls with no canvas and no browser. Widened for the clip design pass with gradients, shadows, `roundRect`, curves, transforms and real text metrics — **add to it when a template needs something, not in anticipation**, because every method is one more the recorder has to implement |
| `src/lib/render/fonts.ts` | Registers Space Grotesk and DM Sans as `FontFace`s, in **whichever realm is drawing**. The page and the worker both go through it and both await it, because a worker's font set starts empty and cannot inherit the page's — that gap is why clips used to export in `system-ui` |
| `src/lib/render/test-recorder.ts` | The `Render2DContext` the render tests draw onto. One copy, shared: three inline copies is how three recorders start disagreeing about what a draw call looks like. Not named `*.test.ts` so vitest treats it as a helper |
| `public/fonts/` | The two woff2 files, and **the only reason `public/` exists in this app**. See the README beside them for provenance and the outstanding OFL vendoring |
| `src/lib/render/` (rest) | `layout.ts` and `timing.ts` (the frame math), `capability.ts` (the WebCodecs probe), `chart-label.ts` (AC-34), `clip-filename.ts` (AC-33), `zip.ts`, and the four template drawers |
| `src/lib/render/types.ts` | The page to worker contract. Lives here, not in the worker, so a client component can import the types without pulling `mediabunny` into the page bundle |
| `src/lib/render/run-render.ts` | The one driver for a render worker, shared by the single scene button and the batch. Always terminates the worker and always settles the promise; the batch depends on both |
| `src/workers/render-worker.ts` | The encode itself: draws to an `OffscreenCanvas` and hands frames straight to `mediabunny`. Owns nothing else — no filename, no ledger, no idea what a project is |
| `src/lib/sentry-scrub.ts` | Removes the request body from every Sentry event. Pure and unit tested, because an untested privacy guard is a comment. See Conventions |
| `src/lib/scene-limits.ts` | Constants the browser needs out of `scenes.ts`, which is `server-only`. See Conventions |
| `src/app/api/projects/[id]/scenes/[sceneId]/route.ts` | Scene Studio's `PATCH`. Ownership is enforced **inside** the `UPDATE`, see Conventions |
| `src/app/dashboard/[id]/scenes/` | **The Scene Studio screen**, a route of its own since spec `0006`: `scene-studio.tsx` (the two pane shell that owns selection and the render queue), `studio-bar.tsx`, `scene-row.tsx`, `scene-detail.tsx`, `scene-overrides.tsx`, `scene-preview.tsx`, `add-scene.tsx`, `scene-citation.tsx`, `use-render-queue.ts`. `plan-panel.tsx` and `batch-export.tsx` are **gone as files** and every behaviour they had was moved here, not rewritten |
| `src/lib/characters.ts` | Every `broll_characters` query, and the owner check behind them. A character belongs to a **user**, not a project (spec `0007`), and the character id appears inside a storage pathname a client can send us, which is why every path here proves ownership first. Holds `claimCharacterGeneration`, the claim that used to live in `@repo/billing` |
| `src/lib/assets.ts` | Every `broll_assets` query, scoped through `broll_characters.user_id`. The replace rules live here rather than in the routes: a replacement is a **new pathname**, never an overwrite, and its row is written before the superseded object is deleted |
| `src/lib/scene-strength.ts`, `src/lib/render/to-renderable.ts` | The pure pieces the Scene Studio row and the encoder share, extracted so both draw and rank a scene the same way |
| `src/components/ui/` | The app's shared surface set (`button`, `card`, `badge`, `switch`, `stat-chip`). New in the visual pass; prefer these over ad hoc classes on a new screen |
| `src/app/nav-links.tsx` | Top level navigation across Projects, Characters and Renders. `hidden md:flex` today, so a phone gets no navigation at all, which is a known gap owned by the blocking and edge states feature |

## Commands
```bash
npm -w @repo/broll dev         # next dev -p 3003 (port pinned, Turbopack — same as the build)
npm -w @repo/broll test        # vitest run
npm -w @repo/broll typecheck
```

## Conventions
- **Never select `broll_projects.transcript` in a list query.** It holds a
  document of up to 5 MB and no list displays it, so a page of twelve projects
  that selects it moves tens of megabytes over the Neon HTTP driver (spec
  `broll/0002` AC-39). Nothing in the database enforces this; it is a
  convention, which is exactly why it is written down.
- **Money never moves here.** Every charge, hold, settle and refund goes through
  `@repo/billing`, and every purchase deep-links to the Wallet app. This app
  contains no Stripe integration and must never gain one.
- **Cross-app URLs go through `src/lib/env.ts`**, never a raw `process.env`
  read: Next.js inlines `NEXT_PUBLIC_*` by literal name at build time.
- **A clip is set in the brand faces, and both realms must register them.** The
  page draws previews and the worker draws the export, and a worker's
  `OffscreenCanvas` resolves families against a font set that starts empty and
  cannot inherit the page's. So `render/fonts.ts` registers the same two files
  from `public/fonts/` on both sides, the worker **awaits** it before frame zero,
  and the page treats it as a repaint trigger rather than a gate. Naming a family
  in a canvas `font` string without registering it in that realm renders
  correctly in the preview and silently falls back in the exported file — the
  exact preview/export divergence `renderable.ts` exists to prevent, and invisible
  until someone looks at a frame. A family whose name contains a space must also
  be **quoted** in the shorthand, or the canvas rejects the whole string and
  silently keeps the previous font.
- **Dark only.** There is no light mode. The hover state shifts *hue* (Key
  Yellow to Interactive Blue), not lightness — that is the established
  ecosystem behaviour, not a bug to fix. Text on yellow is `#111111`, because
  white on yellow fails contrast.
- Rendering is client-side (WebCodecs in a Worker) by design: no render queue,
  no ffmpeg, and export is free to the user because it costs us nothing.
- **Sentry never sends a request body from this app, and it is stopped twice on
  purpose.** `sendDefaultPii` is off and `maxRequestBodySize` is `none`, so a
  body is never collected; `beforeSend` then scrubs `request.data`, the cookies
  and the auth header anyway. The second removal is not redundant — it survives
  an SDK default changing, an integration attaching request data on its own, and
  someone later turning PII on for a good reason without knowing that a
  character generate `POST` carries a photograph of someone's face in its body.
  That is AC-22, and it would break with nothing failing. Do not turn
  `sendDefaultPii` on. Query strings are stripped from event URLs for the same
  family of reason: a signed asset URL carries its token there. There is
  deliberately **no Sentry feedback widget** here, unlike Rough Cut; a free text
  box on a page holding someone's face is not a control this app should offer.
- **A client component may not import from a `server-only` module, not even for
  a constant.** `scenes.ts` carries `import "server-only"`, so
  `MAX_OVERLAY_TEXT_CHARS` lives in the dependency free `scene-limits.ts` and
  both sides import that. Same shape one level down: the page to worker types
  live in `render/types.ts` rather than in the worker, or importing them would
  drag `mediabunny` and the worker's globals into the page bundle. The build
  refuses in both cases, which is the good outcome, but the fix is always this
  one. Rough Cut has `blob-path.ts` and `transcript-limits.ts` for the same
  reason.
- **Presentation is editable, claims are not. That is the product rule, and it is
  not a backlog.** Scene Studio writes exactly four fields, and the PATCH schema
  names them rather than a list someone has to keep current: `included`,
  `overlayText`, `layoutTemplate`, `emotion`. None of them carries a claim, so a
  creator may restyle freely. What stays locked is what the reasoning actually
  justifies: a scene's timings come from the utterance it cited, and its chart
  only exists because it survived the honesty check against the transcript, so
  both are measured rather than proposed. Making either editable would let a
  creator put back a number the app had just refused to invent, which is the one
  thing this product must never allow. Excluding a scene sets a flag and never
  deletes, so changing your mind costs nothing.

  The build of 2026-08-12 allowed only `included` and `overlayText` and called
  that the rule; spec `broll/0005` found the line drawn in the wrong place and
  widened it, because template and emotion decide nothing about what the scene
  asserts. Do not narrow it back by reading an older note.
- **A scene write proves ownership inside the statement, never before it.** The
  `UPDATE` joins through `broll_projects` on `user_id`, so another user's scene
  id changes nothing and answers 404. Reading the row to check the owner and
  then updating is two statements racing, and a 403 would confirm the scene
  exists.
- **There is one render queue, and every entry point enqueues into it.**
  `use-render-queue.ts` is owned by the Scene Studio shell, and both the single
  scene button and Render all go through it (spec `0006` AC-117). Before this the
  single scene button constructed its **own** `Worker` beside a batch that owned
  another, so pressing it mid batch put two encoders on one laptop, which is
  precisely what the batch was built to avoid. One encode at a time is now a
  property of there being one queue, not of nobody pressing two buttons. Do not
  give a new entry point its own `Worker`.
- **A query has two shapes here, and a list page must use the grouped one.** The
  per character reads (`listCharacterAssets`, `regenerationsUsed`,
  `listProjectsUsingCharacter`) are right for a route that already knows its
  character. A page showing a whole library calls the grouped siblings instead
  (`listAssetsByCharacter`, `regenerationsUsedByCharacter`,
  `listProjectsByCharacter`), which answer every character a user owns in one
  statement each. The Neon HTTP driver gives every statement its own round trip,
  so the per character versions in a loop cost three requests per character. Both
  shapes scope on `user_id` in SQL, so this is a decision about round trips and
  never about who can read what.
- **Rate limiters here fail closed on money paths and open on the edit path.**
  `writeRateLimit` is the only `failClosed: false` one in the app: it guards two
  column writes that spend nothing at any vendor, so a Redis blip blocking a
  creator from excluding a scene would break the review flow to protect nothing.
- **The scene duration window has one home**, `MIN_SCENE_DURATION_MS` and
  `MAX_SCENE_DURATION_MS` in `scene-schema.ts`. The prompt's field description
  interpolates them, the clamp reads them, and the tests assert against them
  rather than literals, so the range moves in a single edit. Four to ten seconds
  since 2026-08-12, raised from eight at the engineer's call: b-roll is a
  cutaway, so the ceiling is bounded by what a talking head edit can absorb
  rather than by anything technical.
- **No image byte crosses one of our Functions on a path the browser can take
  itself** (spec `0004` AC-17). Generated PNGs go browser to store by presigned
  PUT, and the review gate reads them by presigned GET. A route that proxies
  image bytes undoes this.
- **A pathname is a server value, never a client one.** The generate route mints
  it and streams it down; the upload and commit routes both re-derive and re-check
  it anyway. Two checks for one property is deliberate — a client supplied string
  becoming a stored key is a cross user read that query scoping would not catch.
- **PNG in, PNG out, with no JPEG anywhere between Gemini and storage.** JPEG
  ringing lands exactly on the character edge the product is judged by, and JPEG
  has no alpha channel at all.
- **Never give a test a credential shaped literal.** A fake token written to look
  real (`vercel_blob_rw_ABC123_...`) trips the repo's secret scanner, and every
  such hit trains the next reader to skim past that shape. These tests only need
  the variable to be set, so a value that is obviously not a credential does the
  same job. The one place the shape is required is
  `apps/rough-cut/src/lib/blob.test.ts`, because `deriveExpectedBlobHostname`
  parses `vercel_blob_rw_<storeId>_<secret>`.

## Gotchas
- **The Ruff Cut handoff is server to server on purpose, and must stay that way.**
  B-Roll gets its own domain rather than a subdomain, so in production it is
  genuinely cross site with `myfirstcut.app`. A credentialed cross origin fetch
  from the browser would therefore depend on the `SameSite` value Clerk puts on
  its session cookie, which is Clerk's setting and not ours. `importFromRoughCut`
  instead fetches from b-roll's **server**, carrying a forwarded Clerk session
  token: no cookie, no CORS, nothing to depend on. It works because all three
  apps share one Clerk instance, and Rough Cut still runs its own owner check, so
  b-roll cannot reach a project the signed in user does not own.
  - Do not "simplify" this into a browser `fetch` with `credentials: include`.
    It would appear to work locally and fail in production, because
    `localhost:3000` and `localhost:3003` are different origins but the **same
    site**, and `SameSite` is site based.
- **Segment granularity differs by intake path.** Measured on real transcripts:
  a Ruff Cut handoff gives roughly one segment per 12 seconds (utterances, with
  word timings and an exact frame rate), an uploaded subtitle file gives one per
  2 seconds (caption cues, no word timings, no frame rate). Both are correct, and
  `@repo/transcript` is deliberate about not merging cues into utterances it
  cannot measure. **This is handled, and the handling is `src/lib/utterances.ts`,
  not the shared package.** `mergeSegmentsIntoUtterances` converges both shapes
  before anything is planned, so the difference reaches the planner as one unit.
  The stored document keeps the file's own cues, which is what makes the
  transcript contract honest; only the planner's view is merged. Its
  `MAX_UTTERANCE_MS` backstop is the part worth knowing about — auto-captions
  carry no punctuation and butt up against each other, so on project `0620` the
  other two boundary signals never fired and 254 cues merged into one utterance.
  Two signals cannot segment a transcript that offers neither.
- **B-Roll must be registered as a satellite domain in the Clerk Dashboard
  before it can run in production.** There is no `isSatellite` setting anywhere
  in this repo's source — the multi-domain SSO set is configured entirely in
  Clerk's Dashboard, so this step is invisible to the codebase, to tests, and to
  CI. Local development needs none of it: a Clerk development instance handles
  several localhost ports, which is how rough-cut (3000) and wallet (3001)
  already coexist.
- **The production domain is still undecided**, and it is what blocks deploying
  this app. Founder's Frame cannot supply it: that app is a fully static export
  (`output: 'export'`, no API routes), so it can link to b-roll but never host
  it. See open question 4 in the high level design.
- `rough-cut`'s `BROLL_URL` is deliberately **optional**, resolving to `null` in
  production when unset, because this app has no production domain yet. Null
  means no cross-origin caller is authorized on Rough Cut's transcript route,
  never a wildcard.
- **`BLOB_WEBHOOK_PUBLIC_KEY` does not exist, and spec `0004` is wrong to require
  it.** Vercel provisions no such variable: measured 2026-08-11, Ruff Cut has had
  a Blob store connected for a month and its Vercel project holds exactly one
  blob variable, `BLOB_READ_WRITE_TOKEN`, and `vercel blob get-store` exposes no
  key either. The SDK demands one anyway — `handleUploadPresigned` throws
  `Missing webhook public key` as its **first statement**, before it reads the
  event type, so even a plain presign dies without it. So
  `api/blob/upload/route.ts` supplies its own inert key and rejects
  `blob.upload-completed` outright, which is what keeps that key provably unused.
  Do not add `onUploadCompleted` to that route without a real key, and do not
  "fix" this by making `isStorageConfigured()` demand the variable: that gates
  the whole feature on a value nobody can obtain.
- **The Blob store must be `private`, and must be a different store from Ruff
  Cut's.** Access cannot be changed after creation. Every read here is a signed
  URL, which a public store would make meaningless; Ruff Cut's store is public
  and holds throwaway audio. Pasting its token here would appear to work and hand
  out permanent unauthenticated links to generated faces.
- **Gemini image models need billing enabled on the API key's project.** The free
  tier quota for every image model is literally `0`, so a key without billing
  answers 429 with `free_tier ... limit: 0` and no model id can be swapped to
  avoid it (checked `gemini-3-pro-image`, `gemini-3.1-flash-image` and
  `gemini-2.5-flash-image` on 2026-08-11, all 429). That 429 is **permanent**,
  unlike a burst, which is why `isPermanentModelFailure` treats the two
  differently and why the error code and the user facing wording are both derived
  from that one predicate rather than decided twice.
- **The segmentation probe must never run on mount.** It is a real inference, and
  starting one pulls the `@imgly/background-removal` model and the onnxruntime
  WASM from `staticimgly.com`: 84 MB and 11 MB at the default `medium` model.
  It then runs on the **main thread** — the library's worker only engages with
  WebGPU (`proxyToWorker = useWebGPU && config.proxyToWorker`, and `device`
  defaults to `cpu`), and WASM threads need `SharedArrayBuffer`, which needs
  cross origin isolation headers this app does not send. Running it from a mount
  effect starved the main thread badly enough that Clerk's `UserButton` missed
  its own ten second mount budget. It now starts on user intent and is awaited by
  `generate` / `regenerate` before they spend, which satisfies AC-61 in a
  stricter place than a `disabled` attribute.
- **A core step depends on a third party CDN at runtime.** `@imgly` fetches its
  model and WASM from `staticimgly.com` on every cold browser. `publicPath` can
  point at self hosted files instead. Spec `0001` does not record this as an
  accepted dependency.
- **Never hardcode one H.264 profile when probing WebCodecs.** Phase 0's spike
  probed `avc1.42001f`, Baseline level 3.1, which caps at 1280x720 and therefore
  cannot express 1080p at all. The failure read as "this browser has no
  WebCodecs" when the real answer was "we asked an invalid question", which is a
  far more expensive conclusion to get wrong: it is the difference between
  shipping a client side renderer and building a server side fallback nobody
  needed. `capability.ts` probes a candidate list at the **real output size**
  and takes the first profile the device accepts.
- **A live canvas preview beside editable fields is the exact shape that
  produced Phase 0's two worst rendering bugs** (spec `0001` rationale §2.9,
  worth reading before touching `scene-preview.tsx`). First, reset the transform
  and `globalAlpha` before every repaint: one stray value left behind makes the
  repaint itself translucent and the previous frame bleeds through, which looks
  like a compositing bug anywhere but where it is. Second, the render loop must
  mount **once** and read the scene through refs, not dependencies. Listing an
  editable field there tears the loop down on every keystroke, and React's dev
  double invoke then leaves two loops driving one canvas. Refs are synced in an
  effect, since writing one during render is not allowed.
- **Scenes render one at a time, and that is not a simplification to optimize
  away.** Encoding is GPU and memory heavy, so a dozen encoders racing on a
  laptop is both slower than doing them in order and far likelier to kill the
  tab. One scene failing does not stop a batch (AC-32): finished clips are held
  between runs so a retry zips alongside the ones that already worked, and clips
  are zipped in **plan order**, not completion order.
- **The zip writer is ours, store only, and deliberately not a dependency.** The
  payload is MP4, already compressed, so deflate would burn CPU to save nothing;
  what is left is headers and offsets. Store only also makes extraction a byte
  slice, which is why `zip.test.ts` reads the archive back with no library at
  all and checks the CRC exactly as an unzip would. Two details in there are
  load bearing: the size guard runs **before** any CRC is computed (hashing
  first walked every byte of an archive about to be refused, and hung the suite),
  and the DOS timestamp is a fixed constant rather than the clock, so the same
  clips zip to a byte identical archive twice.

## Agent skills
- Declined: `@vercel/blob` — the community skills found (jezweb, secondsky) could
  not be confirmed, and this file already records more than they carry about
  2.7.0's presigned API, read from the shipped source rather than the docs.
- Declined: `@imgly/background-removal` — every skill match was a hosted
  background removal API, not the in browser library this app uses.
- Declined: Vercel MCP server — the `vercel` CLI already covers reading project
  env vars and store metadata, with no connector setup.
- Declined: `mediabunny` — searched 2026-08-13, three candidates, none a fit.
  Two are Remotion specific (`remotion-dev/skills@mediabunny`,
  `remotion-dev/remotion@upgrade-mediabunny`) and this app uses no Remotion; the
  only dedicated one (`kevinrss01/mediabunny-skill`) had two installs and
  unconfirmed contents. No MCP server exists for it. What this repo actually
  relies on is the `canEncodeVideo` probe and the `Output` / `CanvasSource` /
  `Mp4OutputFormat` path, all read from the installed types.

## Related specs
- `docs/specs/broll/0001-high-level-design/index.md` — how this app sits in the
  monorepo, the money flow, and the open questions that still gate it.
- `docs/specs/broll/0003-scene-planner/index.md` — the streamed planner, and the
  honesty trace that drops a chart it cannot trace back to the cited span.
- `docs/specs/broll/0004-character-pipeline/index.md` — the six turn character
  chain, the money boundary, and the storage seam. **Its "Configuration
  required" list is wrong about `BLOB_WEBHOOK_PUBLIC_KEY`**, see Gotchas.
- `docs/specs/broll/0002-data-model/index.md` — every column of `broll_projects`,
  `broll_assets` and `broll_scenes`, reconstructed after the original spec was
  lost. Its `rationale.md` marks each part Decided or Inferred.
- `docs/specs/broll/design-prompt.md` — the UI brief: eight screens, the exact
  palette, and the one UX principle everything follows.

_Drafted by /develop from the scaffolding change, worth a quick human pass._

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
