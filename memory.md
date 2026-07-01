# Memory — protectedKeeps review fixes + Deepgram integration (NOT yet working) + dashboard status UX

Last updated: 2026-07-01

## What was built

All changes this session are **UNCOMMITTED** in the working tree (25→28 vitest
pass, tsc + eslint clean). Two threads: (A) applied the /review fixes to last
session's rough-cut upgrade, (B) wired up the real Deepgram transcription path.

**A. Review fixes to the detection upgrade (edl.ts, retake-detection.ts stack).**
- **Narrowed trim protection.** `pinTrimmedBoundary(edl, leftIndex, originalBoundary)`
  now takes the pre-trim boundary and protects ONLY the revealed sliver
  (between old/new boundary) when the kept side grows — not the whole clip.
  `timeline-bar.tsx` snapshots the boundary at pointer-down
  (`dragOrigBoundaryRef`) and passes it via `onTrimEnd(leftIndex, originalBoundary)`;
  editor `page.tsx` `handleTrimEnd` forwards it.
- **Un-protect on manual cut.** New `subtractProtectedRange` in `edl.ts`;
  `setRangeStatus` drops the cut span from `protectedKeeps` when
  `status==="cut" && reason==="manual"` (escape hatch + no stale growth). Auto
  cuts / restores leave protection intact.
- **Re-run false-success guard.** Editor `reRunRoughCut` detects `reRoughCut`
  returning the same EDL (transcript not ready) → "Nothing to re-run" toast,
  no no-op undo entry.
- Tests updated in `edl.test.ts` (now 28 total): revealed-sliver vs shrink,
  un-protect partial/full, auto-cut leaves protection intact.

**B. Deepgram integration (new/changed files):**
- `src/app/api/transcribe/deepgram/route.ts` **(NEW)** — server-side proxy:
  browser POSTs raw media to `/api/transcribe/deepgram?projectId=…`, route
  forwards it to `api.deepgram.com/v1/listen?model=nova-3&smart_format=true&punctuate=true&callback=…`
  with the permanent key. Buffers upload via `arrayBuffer()` (flagged temp).
  Sets project `failed` if Deepgram rejects. Has a **TEMP `detail` field** on the
  500 response for debugging (remove later).
- `src/app/api/transcribe/callback/route.ts` — added `normalizeDeepgram()`:
  flattens `results.channels[0].alternatives[0].words[]` + `metadata.duration`
  into the flat `{words:[{word,start,end,confidence}], text, duration, language}`
  the editor expects (same shape whisper emits). Prefers `punctuated_word` so
  retake sentence-splitting sees terminal punctuation.
- `src/app/(app)/dashboard/page.tsx` — provider switch
  (`NEXT_PUBLIC_TRANSCRIBE_PROVIDER==="deepgram"` else whisper);
  `startDeepgramTranscription` (now points at the proxy route, not browser-direct),
  `startWhisperTranscription`, shared `readErrorReason`.

**C. Dashboard transcription-status UX (dashboard/page.tsx).** Upload now shows
a loading→success/error toast (error includes the server's real reason) and flips
the row to `failed` immediately on error instead of spinning "Transcribing…"
forever. Mounted a `<Toaster>` on the dashboard (editor already had its own).

## Decisions made

- **Deepgram must be proxied through our server, NOT uploaded browser→Deepgram.**
  The pre-recorded REST endpoint (`/v1/listen`) is not CORS-enabled, so a
  cross-origin browser fetch with an Authorization header fails preflight
  ("Failed to fetch"). The temp-key/browser-direct design in the old
  `/api/transcribe/init` route only works for Deepgram's streaming/WebSocket API.
  → `/api/transcribe/init` is now **dead code** (delete once Deepgram confirmed).
- Whisper stays the local default token-saver; provider is env-switchable.
- protectedKeeps protection is minimal (revealed sliver) and un-doable (manual cut).

## Problems solved

- **`/init` 500 root cause:** `.env.local` `DEEPGRAM_PROJECT_ID` was wrong
  (`0da49bd7-…`, not on the key's account). Deepgram 404'd. Fixed to
  `5959aa16-80e9-4083-88e9-74e5b25878db` ("contact@thesubi.shop's Project" — the
  only project the API key can see). NOTE: the proxy route doesn't use the project
  ID at all (only the key); it mattered only for the old init temp-key minting.
- **CORS wall** on browser→Deepgram (see decision above) → built the proxy route.
- Verified with a synthetic WAV that the **server→Deepgram call itself works**
  (HTTP 200 + request_id, even with a `callback` param) — so Deepgram is not the
  blocker; the proxy 500 is upstream of the Deepgram fetch.
- DB status is checkable directly via a throwaway node script using the neon
  driver: `node -r dotenv/config script.cjs dotenv_config_path=.env.local`.
  Used it to mark a stuck `processing` project `failed`.

## Current state

- Review fixes: DONE, tested (28 pass), tsc+eslint clean — **uncommitted**.
- Deepgram: **NOT working end to end yet.** Upload to the proxy route returns a
  generic 500 `{"error":"Failed to start transcription."}` **without** the new
  `detail` field — which proves the running **dev server is serving a STALE
  compile** (my route edits aren't live). Real cause still unknown.
- Leading suspect for the proxy 500: `await request.arrayBuffer()` buffering a
  large video into memory. Fix if confirmed: stream `request.body` straight to
  Deepgram (`duplex:"half"`) instead of buffering.
- `.env.local` now has `NEXT_PUBLIC_TRANSCRIBE_PROVIDER=deepgram` (+ corrected
  project id). Both need a dev-server restart to take effect.
- Earlier successful transcript on `0502.mov` (ready) was via whisper.

## Next session starts with

1. **Restart the dev server** (`next dev --webpack`) — mandatory; it's on stale
   code. Re-upload via the **tunnel URL** (not localhost).
2. Read the failure toast's `detail` (or terminal `Error starting Deepgram
   transcription:`) to get the real proxy-500 cause. If it's memory/arrayBuffer,
   switch the route to stream `request.body` → Deepgram.
3. Confirm the round-trip: status `idle→processing→ready`, transcript populated,
   editor shows words + auto rough cut. Watch that `allowedDevOrigins` in
   `next.config.ts` (pinned to `bidding-bend-pockets-gif.trycloudflare.com`)
   matches the live tunnel host.
4. Clean up: remove the TEMP `detail` field from the proxy route; delete the
   unused `/api/transcribe/init` route.
5. **Commit everything** (review fixes + Deepgram + dashboard UX) on a branch +
   open PR. `gh` still not authenticated.
6. Then proceed to **Phase 5 (WebCodecs MP4 export)** — the big missing pillar.

## Open questions

- Real cause of the proxy-route 500 (pending restart to see `detail`).
- Stream vs buffer the upload to Deepgram.
- Keep `allowedDevOrigins` in sync with whatever tunnel host is live.
- Are the Deepgram params (nova-3 / smart_format / punctuate) the right defaults?
- User asked to surface operational state in UI (done for transcription) — offered
  to save that as a standing preference; not yet answered.
- Still deferred: Phase 5 export, filler-word detection, semantic/rambling trim,
  preset value tuning against real footage.
