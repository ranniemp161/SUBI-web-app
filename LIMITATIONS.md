# Known limitations & operational notes

Deliberate constraints and accepted tradeoffs as of the production-hardening
pass. These are known and mostly intentional — not bugs. Grouped by area.

## Export (client-side, WebCodecs)

- **Chromium-only.** Export uses the WebCodecs API and the File System Access
  API (`showSaveFilePicker`), which today means **Chrome or Edge**. On other
  browsers (Firefox, Safari) the Export button is disabled up front with the
  reason in its tooltip — see `isExportSupported()` in
  `src/lib/export/export-trigger.ts`.
- **Verified formats.** Only **H.264 MP4** sources have been verified end to end.
  HEVC/MOV and VP9/WebM sources are expected to work (mediabunny supports them)
  but are **untested** — pending manual verification.
- **Resolution / 4K.** Export re-encodes at the source resolution by default. A
  pre-flight `canEncodeVideo` check (in the worker) fails fast with a clear
  message if the device can't encode the target size, and an **export-quality
  selector** (Source / 1080p / 720p) lets the user downscale a large/4K source
  for weaker devices or smaller files (never upscales). 4K encode is still heavy
  and device-dependent, and **not yet verified end to end**.
- **Whole-source decode.** Export decodes the entire source even for heavily-cut
  timelines (only the encode is skipped for cut spans). Fine for typical clips;
  a keyframe-seek optimization is the follow-up if it proves slow on long,
  heavily-cut footage. See the note in `src/workers/export-worker.ts`.
- **Runs in the tab.** A render is tied to the open tab; closing it mid-export
  loses the render (the user is warned via `beforeunload`).

## Video storage (product tradeoff)

- **The video is never stored server-side.** It lives in the browser; only the
  extracted audio track is uploaded (browser → Vercel Blob directly, our server
  never sees the bytes), and that blob is deleted as soon as transcription
  finishes. Consequently, **reopening a project requires re-selecting the
  source file** from disk.
- This is a deliberate, cost-driven decision (no object storage). See the
  cross-session note on the R2/object-storage decision — it is **pending a
  client conversation** and should not be reversed without that.

## Scale & deployment

- **Serverless-compatible (Vercel) by design.** Media bytes never pass through
  the Next.js server: the browser uploads extracted audio directly to Vercel
  Blob and Deepgram fetches it by URL, so Vercel's ~4.5MB function body cap is
  never in play. The former local-whisper path (which needed a persistent Node
  host, local disk, and Python) has been removed.
- **Deepgram upload size limit.** Deepgram caps fetched files (~2 GB,
  `DEEPGRAM_MAX_UPLOAD_BYTES` — confirm against your plan). Enforced at Blob
  token issuance (`maximumSizeInBytes` in the blob-token route), so an
  over-limit upload is rejected before any bytes land in storage.
- **Sync-mode transcription timeout.** On localhost (no public callback URL) the
  Deepgram path reads the transcript synchronously, holding the request for the
  whole job. A long enough video can hit a proxy/platform timeout. Production
  (public host) uses the callback path and isn't affected; set `PUBLIC_APP_URL`
  to force callback mode locally.

## Rate limits

Per-user fixed-window limits (Upstash Redis via Vercel KV, `src/lib/rate-limit.ts`;
needs `KV_REST_API_URL` / `KV_REST_API_TOKEN`, which it requires in production):

- **Project creation:** 60 / hour.
- **Transcription starts:** 30 / hour.

Exceeding a limit returns `429`. Tune the constants in the respective routes.

Per-IP fixed-window limits on the 3 routes that bypass Clerk middleware
(`src/proxy.ts`'s public-route list — no session to key on, so these are
IP-based via `src/lib/ip-rate-limit.ts`):

- **Transcription callback** (`/api/transcribe/callback`): 60 / 10 min.
  Deepgram's servers call this; the per-project random token (checked after
  the rate limit) is the real gate — this is a cost/read cap, not the
  primary defense.
- **Access-code verification** (`/api/auth/verify-code`): 10 / 5 min.
- **Clerk webhook** (`/api/webhooks/clerk`): 120 / 1 min. Verified by a svix
  signature (checked after the rate limit is passed) — this is a volume cap,
  not the primary defense.

`getClientIp()` trusts the first `x-forwarded-for` entry, which is only safe
because these routes are only ever reached through Vercel's edge (which sets
it correctly and isn't attacker-spoofable there). If this app is ever moved
off Vercel, that trust assumption needs re-checking before it's reused as-is.

## Operational setup

### Error tracking (Sentry) — off until configured

Error reporting is wired but **env-gated** — a complete no-op until a DSN is set.
To enable:

- `SENTRY_DSN` — server + edge error reporting.
- `NEXT_PUBLIC_SENTRY_DSN` — client error reporting.
- `SENTRY_ORG`, `SENTRY_PROJECT` — enable source-map upload at build time (the
  `next.config.ts` Sentry wrapper only activates when `SENTRY_DSN` is present).
- Optional: `SENTRY_TRACES_SAMPLE_RATE` / `NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE`
  (default `0` — errors only, no performance tracing).

### Database migrations

Schema changes reach a database through **versioned migrations** run from
`packages/db` (`npm run db:generate` → review → `npm run db:migrate`). `db:push`
is a **dev-only** accelerator for throwaway branches — never prod, since its
schema-diff can offer a data-losing drop/recreate on type conversions. Dev and
prod are separate Neon branches; migrate each separately, dev first. Full
workflow, the first-deploy baseline, and history of retired manual scripts:
[`packages/db/MIGRATIONS.md`](packages/db/MIGRATIONS.md).
