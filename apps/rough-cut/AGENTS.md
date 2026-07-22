# Rough Cut (apps/rough-cut)

## Overview
The core product: browser-based video transcription and AI-assisted rough
cutting. Users upload a video, its audio is transcribed (Deepgram), the
transcript drives an editable timeline/EDL, and export runs client-side via
WebCodecs — the source video is never stored server-side. Billing/credits UI
now lives in the separate `apps/wallet` app (see ADR `0001`); this app only
spends tokens and deep-links to Wallet to buy more.

## Key files
| File | Owns |
|---|---|
| `src/proxy.ts` | Clerk auth middleware + the public-route allowlist (routes that bypass session auth: transcribe callback, Clerk webhook, cron) — also redirects signed-in users from `/` to `/dashboard` so the landing page stays static |
| `src/lib/env.ts` | Validated cross-app URLs (`WALLET_URL`, `WALLET_DASHBOARD_URL`) — the only place allowed to read `NEXT_PUBLIC_*` cross-app vars; throws at import time in production if unset/still-localhost |
| `src/lib/credits.ts` | Token hold/settle/refund logic against `@repo/db`'s credit ledger |
| `src/lib/rate-limit.ts` | App-specific buckets (`readRateLimit`, `aiCutRateLimit`) wrapping `@repo/server-shared`'s fixed-window limiter, Upstash Redis (Vercel KV) backed — **not** Postgres (`rate_limits` table was dropped, see `packages/db` migration `0001`) |
| `src/lib/ip-rate-limit.ts` | Per-IP limiter for the 3 routes in `proxy.ts`'s public list (no session to key on) |
| `src/lib/deepgram.ts`, `src/lib/ai-rough-cut.ts`, `src/lib/ai-cuts.ts` | Transcription + AI cut-suggestion pipeline |
| `src/lib/blob.ts` | Vercel Blob direct-upload + delete-after-transcription — server-only (`import "server-only"` guard); a client component that needs `uploadPathnameForProject` must import it from `src/lib/blob-path.ts` instead, or webpack silently bundles this file's `@vercel/blob`/Sentry imports into the browser |
| `src/lib/blob-path.ts` | `uploadPathnameForProject` — pure, zero-dependency, the only piece of the blob-path convention a client component (`dashboard/page.tsx`'s direct-upload flow) is allowed to import |
| `src/lib/pusher.ts` | Server (`pusherServer`) and client (`getPusherClient()`) Pusher instances plus `projectChannel()` (the `private-<projectId>` channel name both sides must use) — all live in this one file, so any `"use client"` code importing the client helper also pulls in the server SDK; see Conventions below |
| `src/app/api/pusher/auth/route.ts` | Countersigns private-channel subscriptions — only the project's owner gets a signature, which is what keeps third parties (who hold the public `NEXT_PUBLIC_PUSHER_KEY` from the JS bundle) off our Pusher quota |
| `src/lib/export/*`, `src/workers/export-worker.ts` | Client-side WebCodecs MP4 export (Chromium-only, see `LIMITATIONS.md`), plus browser-agnostic NLE interchange export (`fcpxml.ts` for Final Cut Pro/Resolve, `cmx3600.ts` EDL for Resolve, `xmeml.ts` FCP7 XML for Premiere Pro — Premiere does NOT read `.fcpxml`) sharing `timebase.ts`/`filename.ts`/`xml.ts` frame-math and sanitizing helpers, downloaded via `src/lib/download-text-file.ts`. Timebase is the source's detected frame rate (`src/lib/detect-frame-rate.ts`, mediabunny packet stats, drop-frame timecode for NTSC 29.97/59.94), falling back to 30fps when no source file is reselected |
| `src/lib/detect-embedded-timecode.ts` | Best-effort read of a reselected source's embedded start timecode (the `tmcd` track cameras/encoders write when a clip doesn't start at 00:00:00:00), so the NLE interchange exports' source in/out timecodes match what DaVinci Resolve's strict Media Pool relink expects — without it, Resolve still links by filename but logs a "failed to link" warning. Uses `mp4box.js` (dynamically imported, never in the main bundle), NOT mediabunny — mediabunny only sees audio/video sample tracks, no concept of a `tmcd` metadata track. Never throws; any failure or absence resolves to a 0 offset, i.e. today's already-working behavior |
| `src/components/export-modal.tsx` | The single Export dialog (MP4, FCPXML, CMX 3600 EDL, FCP7 XML, plus MP4 resolution) that the export cluster in `dashboard/[id]/page.tsx` now opens; replaced the old inline `StyledSelect`/`ExportFormatMenu` dropdown pair |
| `src/lib/authz.ts` | Write-route authorization — the `users` row (provisioned by the Clerk webhook or its fallback) IS the authorization; there is no separate access-code verify route (`src/lib/access-codes.ts` no longer exists) |
| `src/app/api/webhooks/clerk/route.ts` | Clerk user-sync webhook (svix-verified) |
| `src/lib/sync-colors.ts` | Shared visual tokens (Tailwind classes + hex) for cross-panel sync between the transcript panel and the timeline bar — playhead, selection, and hover each have one constant pair, so the two panels can never drift onto different colors for the same concept (spec `0002`) |
| `src/lib/word-alignment.ts` | Client-side word-boundary refinement (spec `0003`): decodes the reselected source into a 5ms RMS energy envelope (mirrors `waveform.ts`'s streaming mediabunny pattern) and snaps each transcript word's `start`/`end` to the nearest real speech boundary within a small search window, once per project. Never a network call — the audio never leaves the browser |
| `LIMITATIONS.md` (repo root) | Deliberate constraints — export browser support, no server-side video storage, rate-limit tuning, Sentry env-gating |

## Commands
```bash
npm -w @repo/rough-cut dev        # next dev --webpack -p 3000 (port pinned)
npm -w @repo/rough-cut test       # vitest run
npm -w @repo/rough-cut typecheck
```

## Conventions
- **Auth**: Clerk (`@clerk/nextjs`), configured for multi-domain SSO with the
  Wallet app per ADR `0001`. `proxy.ts` is the single gate; only the routes it
  explicitly lists skip session auth.
- **DB**: Drizzle via `@repo/db` (Neon HTTP driver, no persistent pool —
  serverless/Vercel-compatible by design).
- **Video never touches the server.** Only the extracted audio track uploads
  (browser -> Vercel Blob directly); that blob is deleted once transcription
  finishes. Reopening a project requires re-selecting the source file. The app validates
  reselected file duration (blocking on mismatch) and filename, size, or type (warning on mismatch).
- **AI polish is mandatory, not a per-project choice** (ADR `0004`). `POST /api/projects`
  hardcodes `aiPolishRequested: true` on every new project; `createProjectSchema` is a
  `strictObject` with no `aiPolish` field, so a client that sends one gets a 400. There is
  no upload confirm panel or price screen; a picked file goes straight into extraction,
  upload, and transcription, with a client-side pre-flight (`blockedByCreditsForNewUpload`,
  `dashboard/page.tsx`) pricing the combined transcription-plus-polish cost and showing an
  inline, non-modal message on insufficient funds.
- **Cutting and spending only start after the user reselects their source video**
  (ADR `0004`). The studio's automatic chain (mechanical cut, then AI polish) used to fire
  the moment a fresh project's transcript was ready; it now also requires `sourceFile !== null`
  in its firing effect (`[id]/page.tsx`), so nothing cuts or charges before the user has
  taken the reselect action. Between reselect and the chain settling, the page shows ONLY a
  full-page loading state (no transcript panel/timeline/rail mounted yet) with a progress bar
  — never the real editor chrome mid-cut.
- **Transcript status reaches the client via Pusher, not polling.** The dashboard's
  project list and the studio page both used to poll on an interval; that's gone. The server fires a `transcript_status` event (`{ status: "ready" | "failed" }`)
  on the project's **private** channel — always via `projectChannel(projectId)`
  (`private-<projectId>`), never a bare id, since Pusher only enforces the
  `/api/pusher/auth` ownership check on `private-` channels — from three places: `api/transcribe/callback/route.ts`
  (the async/production path), and `api/transcribe/deepgram/route.ts` (the local-sync path and
  its own early-failure branches). Any new failure path added to either route should also fire
  (or deliberately skip) this event — a client subscribed via `getPusherClient()` has no
  fallback re-check anymore, so a silently-skipped event leaves the project stuck showing
  "Transcribing…" until a manual reload.
- **Cross-app URLs**: always via `src/lib/env.ts`, never a raw
  `process.env.NEXT_PUBLIC_*` read elsewhere — Next.js inlines these at build
  time so they must be referenced by literal name in one place.
- **Atomic holds and claims**: Charged operations (credits via `chargeAiCut`,
  AI Cut runs) use conditional-UPDATE holds to prevent concurrent double-spends.
  The pattern: a request claims an exclusive hold via an UPDATE that matches only
  when the column is empty (or stale), and a losing concurrent call gets zero rows
  and returns early. See `reserveCredits` (lib/credits.ts, `hold_micros IS NULL`
  gate) and `claimAiCutSlot` (lib/projects.ts, `ai_cut_claim_at` timestamp claim). On any
  failure after the hold, call the corresponding release function to unlock.
- **Observability**: Sentry (`@sentry/nextjs`) is wired but env-gated —
  no-op until `SENTRY_DSN`/`NEXT_PUBLIC_SENTRY_DSN` are set. When set, `instrumentation-client.ts`
  also turns on Sentry's feedback widget (`Sentry.feedbackIntegration`), a floating
  "Request a Feature" button letting a signed-in user send free-text feedback straight to Sentry.
- **AI Cut runs on the Edge runtime and streams NDJSON, not a single JSON body.**
  `api/projects/[id]/ai-cut/route.ts` sets `export const runtime = "edge"` and returns a
  `ReadableStream` of newline-delimited JSON lines: `{"phase":"analyzing"|"verifying"}` lines
  (also the heartbeat, re-sent every 5s and immediately on each real phase change, keeping Vercel's
  proxy — 10s limit on Hobby — from killing the connection before the up-to-300s `maxDuration`
  completes) and one terminal line — the `AiCutRun` or `{"error"}`. Pusher (used elsewhere for
  `transcript_status`) was considered for the phase signal and rejected: its server SDK needs
  Node's `crypto`/`http`, which aren't available on this edge route. Because the HTTP 200 is sent
  before the real result is known, a failure that happens after the stream opens (transcript too
  long, Gemini error) is reported as `{ error }` inside the terminal line, not an HTTP error status.
  Callers must read the stream incrementally (see the client's `readAiCutStream`,
  `dashboard/[id]/page.tsx`) and treat the first non-phase line as the result — `res.json()` no
  longer works against a 200 response from this route (`ai-cut/route.test.ts`'s `readTerminalJson`
  shows the read-the-last-line pattern for tests that don't need live phase updates).
- Tests are colocated `*.test.ts(x)` next to source, run with Vitest.
- **ESLint & Mocking**: When mocking components with `forwardRef` in tests, avoid anonymous arrow functions. Use named function expressions (e.g. `forwardRef(function VideoPlayerStub() {})`) to satisfy `react/display-name`. Do not declare unused arguments in callback parameters (e.g. `props`, `ref`, `url`, `init`) to satisfy `@typescript-eslint/no-unused-vars`.
- **Dropdowns/menus**: build on Radix (`@radix-ui/react-select` for a value picker, `@radix-ui/react-dropdown-menu` for an action menu), never hand-roll outside-click/Escape/focus logic — the same precedent `packages/ui/src/confirm-dialog.tsx` set for dialogs. The export cluster's old `StyledSelect`/`ExportFormatMenu` Radix pair was consolidated into `src/components/export-modal.tsx` (a plain custom dialog, not Radix); still use Radix for any new standalone dropdown or menu control.

## Agent skills
- Declined: Radix UI tooling (`radix-ui-design-system` skill, `radix-mcp-server` MCP) — Radix's own docs plus the local `confirm-dialog.tsx`/`StyledSelect` precedent are enough for now.

## Gotchas
- Deepgram's transcription callback isn't signed — a per-project random token
  (`transcriptCallbackToken`) is the real gate, checked after the IP rate limit.
- On localhost (no public callback URL) transcription reads the transcript
  synchronously, holding the request open; set `PUBLIC_APP_URL` to force the
  production callback path locally.
- Deepgram enforces an upload size cap (2 GB by default, configurable via the `DEEPGRAM_MAX_UPLOAD_BYTES` environment variable) enforced at Blob token issuance (`maximumSizeInBytes`), not after upload.
- The EDL autosave patch (client `createPatch` in `dashboard/[id]/page.tsx`, server `applyPatch` in
  `api/projects/[id]/route.ts`) now runs on `rfc6902`, not `fast-json-patch` — the two libraries'
  `Operation` types don't line up field-for-field, which is why `validation.ts`'s
  `jsonPatchOperationSchema` is a `discriminatedUnion` on `op` rather than one loose shape.
  `fast-json-patch` is still an unremoved dependency in `package.json` but nothing imports it anymore.
- `PATCH /api/projects/:id` returns `{ success: true, updatedAt }`, not the full updated project —
  don't add code that expects the response body to contain project fields.
- **EDL autosave is optimistically versioned.** The client (`src/lib/edl-autosave.ts`) sends
  `baseUpdatedAt` — the `updatedAt` its patch was diffed from — and the route gates the UPDATE on
  `date_trunc('milliseconds', updated_at)` matching it (truncated because only milliseconds survive
  the JSON round-trip, while Postgres' `now()` default stores microseconds). Zero rows matched means
  another writer moved the row, and the route answers **409** with `{ error, edl, updatedAt }` so the
  client can re-baseline and re-diff without a second request — a patch applied to a diverged base
  yields a structurally valid but semantically wrong EDL, which is worse than a rejected save.
  Anything else that writes `projects.updated_at` (`createAiCutRun`, `setActiveAiCutRun`) will make
  the next autosave 409 once and self-correct; that's expected, not a bug.
- The autosave hook owns four behaviors that are easy to regress: a max-wait ceiling so continuous
  editing can't starve the debounce, a `pagehide`/`visibilitychange`/unmount flush via
  `keepalive: true` (which is why saves must stay patch-sized — keepalive bodies cap at 64KB), a
  bounded backoff retry that doesn't wait for the user's next edit, and one save in flight at a time.
  See `src/lib/edl-autosave.test.ts` before changing any of them.
- **Deepgram word timestamps are millisecond-rounded only, never frame-grid snapped** (`lib/deepgram.ts`).
  A former `snapToFrame` (fixed 30fps grid) was removed: the transcript highlight compares against
  the video element's continuous `currentTime`, so a fixed-fps snap upstream would offset the
  active-word boundary from the real audio on any non-30fps source. Frame alignment where it
  actually matters — EDL cut boundaries and NLE-interchange export — is owned downstream by the
  *detected* source fps (`detectVideoFps` + `export/timebase.ts`), not by a heuristic at ingestion.
  Don't reintroduce grid-snapping at the Deepgram normalize step.
- **Exported audio fades a short `AUDIO_FADE_SECONDS` (20ms) at every kept range's edges**
  (`createGainEnvelope`, `lib/export/plan.ts`), applied in `export-worker.ts`. Deepgram's (and
  therefore every cut's) boundary is the ASR's best-guess timestamp, not the true acoustic edge — a
  hard splice at the exact cut point can leave an audible fragment of "deleted" speech; the fade
  masks it, the same way an NLE would. Don't remove this fade to "clean up" the export path.
- **`words_aligned` (`projects` table) gates the word-boundary refinement pass (spec `0003`) the
  same "flip once, never revert" way `ai_polish_requested` gates the auto-cut chain** — set `true`
  by the client only after every word in the transcript has been searched. The pass's mid-pass edit
  guard reads the EDL fresh via a ref (`edlRef.current` in `[id]/page.tsx`) at write time, not from
  the effect's closure over `edl` when the pass started — the pass can run for several seconds, and
  a manual cut made mid-pass must win over whatever the pass computed for that word, or it
  reintroduces the exact drift bug spec `0003` exists to close.

## Related ADRs
- `docs/adr/_root/0001-monorepo-wallet-architecture.md`
- `docs/adr/rough-cut/0004-reselect-gated-pipeline/index.md` — mandatory AI polish, no upload confirm panel, and the reselect-gated auto-chain (supersedes `docs/adr/rough-cut/0003-studio-auto-cut-flow/index.md`'s upload and trigger design)
