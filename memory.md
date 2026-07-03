# Memory — Phase 1 (audio extraction) + Phase 2 (Vercel Blob) built; Blob untested pending token

Last updated: 2026-07-03 (evening)

## What was built

Everything below is **uncommitted** (working tree only, on `main`). User agreed
to committing "in logical chunks" but never said go. Suggested split:
(1) db abort-on-timeout + test, (2) dashboard retry/start button,
(3) audio extraction + mediabunny dep, (4) Vercel Blob direct-upload + @vercel/blob dep.

### A) DB retry hardening (src/db/index.ts + src/db/index.test.ts) — verified live
`withDbRetry` timeouts now abort the in-flight Neon fetch via an
`AsyncLocalStorage`-carried AbortSignal injected through `neonConfig.fetchFunction`
(previously stalled sockets stacked up alongside retries). Regression test
proves the ALS→drizzle-thenable→fetch signal propagation works.

### B) Retry/start transcription button (src/app/(app)/dashboard/page.tsx) — verified live
Failed/idle cards show "Retry/Start transcription" → hidden file input (media
never stored server-side, so user re-picks from disk) → re-runs
`kickOffTranscription` against the existing project id. Non-blocking warning
toast on file-name mismatch.

### C) Phase 1: browser audio extraction (src/lib/audio-extract.ts + .test.ts) — VERIFIED end-to-end live
mediabunny lossless remux of just the audio track (AAC→.m4a, Opus/Vorbis→WebM,
picked by source codec), streamed from disk. ~34MB for the 23-min test video
instead of multi-GB. Falls back to full-file upload on `unsupported`; clear
toast on `no-audio`. **The 2-day "corrupt audio" failure on 0615.mp4 is RESOLVED**
— after Phase 1 it transcribed to `ready` in seconds ([dg-diag] showed
status=200, declared==forwarded bytes, no truncation; diagnostic since removed).
Critical gotcha encoded in code+test: AAC's negative first timestamp (~-23ms
encoder priming) must be passed as explicit `trim.start` or mediabunny silently
abandons lossless copy (breaks entirely where WebCodecs can't decode).

### D) Phase 2: Vercel Blob direct upload — built + unit-tested, NOT yet run live
User decided to build now with their own Vercel Blob store ("ruffcut", free
Hobby tier: 1GB storage avg, 10GB transfer/mo; hard 30-day lockout if exceeded,
no auto-expiry). R2 remains a possible later swap if the client asks.
- **src/app/api/transcribe/blob-token/route.ts** (new): `handleUpload` token
  route — auth + access-code + ownership (`getOwnedProject`) + its OWN rate
  limit `blob-upload:<clerkId>` 60/hr (deliberately NOT the transcribe bucket;
  sharing would halve the user's effective 30/hr transcription budget).
  `access:"public"`, `allowedContentTypes:["audio/*"]`,
  `maximumSizeInBytes: DEEPGRAM_MAX_UPLOAD_BYTES`.
- **src/lib/blob.ts** (new) + blob.test.ts: `isOwnBlobUrl()` — pins to our
  exact store hostname derived from `BLOB_READ_WRITE_TOKEN`
  (`vercel_blob_rw_<storeId>_<secret>` → `<storeid>.public.blob.vercel-storage.com`),
  falls back to domain-suffix check if token doesn't parse. SSRF/quota guard.
- **deepgram/route.ts**: now takes JSON `{blobUrl}` instead of raw bytes;
  validates via `isOwnBlobUrl`; Deepgram called URL-mode
  (`body: JSON.stringify({url: blobUrl})`); blob deleted (best-effort
  `deleteBlobQuietly`) on sync success, sync failure, Deepgram rejection, or
  catch — but NOT on callback-mode accept (blob must survive until callback).
- **callback/route.ts**: `blobUrl` rides in the callback URL's query string
  (NO db column — design review killed that: request-scoped value + one-time
  token, eliminates a retry race); deletes blob in both success and failure
  branches.
- **dashboard/page.tsx**: `upload()` from `@vercel/blob/client` with
  `clientPayload:{projectId}`, explicit `contentType` (critical — Deepgram's
  GET must see the right Content-Type or it can mis-detect the codec), real
  "Uploading… N%" toast, and an in-flight-projectIds Set guarding double-submit.
- Client-side `DEEPGRAM_MAX_UPLOAD_BYTES` check removed (enforced at token
  issuance now). Whisper path untouched. `proxyClientMaxBodySize:"8gb"` in
  next.config.ts kept — it's for the whisper route, not deepgram.

## Decisions made

- **Phase 1 + Phase 2 are complementary**: Phase 1 shrinks bytes (the root fix
  for uplink saturation), Phase 2 moves them off our server (mandatory for any
  Vercel deploy — serverless Functions reject request bodies >4.5MB at the
  platform edge, no inbound-streaming exception; verified in Vercel docs).
- **Delete-after-transcription is the locked-in philosophy** (user's explicit
  words: "app stores metadata, not the other way around"). With deletion, free
  tier ≈ 330 transcriptions/mo (10GB transfer ÷ ~30MB); without, ~34 projects
  EVER. Deletion is implemented everywhere.
- Known accepted gap (documented in code comment): server crash between
  Deepgram accepting a callback-mode job and the callback arriving orphans one
  ~30MB blob. Pathname convention `projects/<projectId>/<uuid>` exists so a
  future cron could reconcile via `list({prefix:"projects/"})`.
- Design-review changes folded in: no DB column for blob URL; separate rate
  bucket for token minting.

## Current state

- `tsc` clean, **71/71 vitest pass** (9 files), `next build` succeeds (only
  pre-existing whisper-route tracing warning, already in LIMITATIONS.md).
- Phase 1 verified live by user (fast extraction + transcription confirmed).
- **Phase 2 verified live end-to-end**: Extracting → Uploading N% →
  Transcription started toasts all fire, blob appears in the store during
  upload and disappears immediately once the transcript comes back `ready`.
- **Resolved gotcha: the original "ruffcut" Blob store was created as
  PRIVATE**, which made every client upload fail with a `400 Bad Request`
  that the browser misreported as a CORS error (`No 'Access-Control-Allow-Origin'
  header`) — private stores reject `access:"public"` at the edge, before CORS
  headers are attached, so `fetch()` just throws a generic network error and
  the SDK's retry logic silently retried 8+ times. Diagnosed by reproducing
  the exact failure server-side with a direct `put()` call (bypasses
  browser CORS entirely, exposes the real error message). **Public vs.
  private is fixed at store-creation time and cannot be converted after the
  fact** — the fix was creating a brand-new store with Public access selected
  at creation and swapping its `BLOB_READ_WRITE_TOKEN` into `.env.local`. Old
  private "ruffcut" store is now unused/orphaned (never deleted).
- Aside: `dotenv` v17.4.2 prints a random self-promotional "tip" line on every
  load from a hardcoded `TIPS` array in `lib/main.js` (includes URLs like
  `dotenvx.com` and `vestauth.com`) — looked exactly like an injected/malicious
  console line at first glance, confirmed benign by reading the package source.
  Worth remembering so it isn't re-investigated as a security incident.
- Dev server needs a restart any time `BLOB_READ_WRITE_TOKEN` changes.
  Sync mode locally (no `PUBLIC_APP_URL`): browser→Blob upload works locally,
  Deepgram fetches the public blob URL fine from localhost, transcript read
  synchronously, blob deleted immediately. Callback-mode cleanup path is
  unit-tested but still needs a public host/ngrok to exercise for real.

## Next session starts with

1. **Commit the working tree** in the 4 logical chunks listed earlier (long
   overdue — everything is now verified live, including Phase 2).
2. Consider updating LIMITATIONS.md: the "not serverless-friendly" and
   "concurrent-upload memory ceiling" sections are now largely obsolete for
   the deepgram path (still true for whisper).
3. Decide what to do with the orphaned private "ruffcut" store (delete it,
   or repurpose later) — not blocking anything.

## Open questions

- Callback-mode (public deploy / ngrok) end-to-end test — never exercised live.
- Client conversation: R2 vs staying on Vercel Blob; free-tier ceilings
  (~330 transcriptions/mo with deletion) fine for now, revisit at real traffic.
- Vercel passkey login failure (user's account, not the app) — unresolved;
  workarounds suggested were OAuth sign-in or recovery code, then re-register
  passkey + add authenticator app.
- Older backlog: Phase-4 manual verification (export/downscale/4K), prod Neon
  migration if deploying, optional Dockerfile.
