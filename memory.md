# Memory — Deepgram large-upload fix + storage architecture decision

Last updated: 2026-07-01

## What was built

Confirmed (via committed code + git log) that the review fixes and Deepgram
integration from the prior session's memory were already **committed**
(`54f3509`, `b1d4925` — "implement Deepgram transcription integration and
enhance error handling in dashboard"). Working tree was clean at session start.

This session fixed the actual Deepgram upload failure and cleaned up leftover
debug/dead code:

- **`next.config.ts`** — `experimental.proxyClientMaxBodySize` raised from
  `"2gb"` → `"8gb"`.
- **`src/app/api/transcribe/deepgram/route.ts`** — replaced
  `Buffer.from(await request.arrayBuffer())` with streaming `request.body`
  straight into the Deepgram `fetch` call (`duplex: "half"`), plus a
  `!request.body` 400 guard. Also removed the TEMP `detail` field from the
  catch-block 500 response (was only for debugging).
- **Deleted `src/app/api/transcribe/init/route.ts`** (dead code — the
  browser-direct-to-Deepgram design it supported doesn't work, per last
  session's CORS finding). Updated two stale comments referencing it in
  `src/app/api/transcribe/whisper/route.ts` and `src/lib/access-code.ts`.
- Cleared `.next` (stale generated route types were breaking `tsc` after the
  route deletion — not a real bug, just cache).
- `tsc --noEmit` and `eslint` both clean after all changes.

## Decisions made

- **Root cause of the Deepgram 500/EPROTO crash:** NOT the API key (key was
  never reached — confirmed working via a synthetic-WAV test in the prior
  session). The Clerk proxy middleware buffers the *entire* request body in
  memory before any route runs (`proxyClientMaxBodySize`, matches all
  `/api/*` routes because `auth()` needs the middleware to have run). A
  2GB+ video got truncated at the old 2GB cap, then the route's
  `arrayBuffer()` + single-shot `fetch` body write blew up the socket
  (`write EPROTO`). Fix: raise the cap + stream instead of buffer.
- **Chose the quick fix (raise limit + stream) over object storage**, with
  eyes open about its ceiling: the Clerk proxy still holds one full copy of
  the upload in server RAM per request (now up to 8GB), so concurrent large
  uploads risk OOM, and this is likely incompatible with serverless deploy
  targets (body/memory/duration limits). Acceptable for current solo/testing
  scale; not scale-tested.
- **R2 (object storage) was deliberately removed from the stack earlier** by
  the user to save cost, after concluding the browser can hold the video and
  it gets deleted after MP4 export — no permanent server-side storage needed.
  This session's finding complicates that: since Deepgram's REST endpoint
  isn't CORS-enabled, video bytes still have to transit *the server's memory*
  (not truly storage-free) even without R2. This tradeoff has been written up
  and the user plans to raise it with their client before deciding whether to
  reintroduce object storage (signed URL + delete-after-export lifecycle).
  **Full detail saved separately** in the cross-session memory system at
  `project_r2_storage_decision.md` (not just this file) — check there for the
  long-form version of this decision.

## Problems solved

- Confirmed Deepgram API key is valid and functional — not implicated in any
  of today's errors.
- Diagnosed `write EPROTO` / `fetch failed` on large uploads as a body-size +
  buffering issue, not a network/auth issue (see Decisions above).

## Current state

- Deepgram proxy route now streams instead of buffers, and the proxy body
  cap is 8GB. **Not yet re-tested end to end** — needs a dev server restart
  (config changes don't hot-reload) and a fresh upload through the tunnel URL
  to confirm `idle → processing → ready` completes without error.
- Dead `/api/transcribe/init` route removed; whisper route remains as the
  token-saving local/dev transcription path, Deepgram is the production path.
- All of today's changes are uncommitted in the working tree.

## Next session starts with

1. Restart the dev server (`next dev --webpack`) so `next.config.ts` changes
   take effect.
2. Re-upload a large video through the tunnel URL and confirm the full
   round-trip: status goes `idle → processing → ready`, transcript populates,
   editor shows words + auto rough cut, no EPROTO/500.
3. If it works end to end, commit this fix + cleanup and open a PR (gh still
   not authenticated as of last session — check before assuming `gh pr
   create` will work).
4. Surface the R2/storage scalability tradeoff to the client (user's action
   item, not a coding task) — revisit only if the client wants object storage
   added back in.
5. Then continue toward **Phase 5 (WebCodecs MP4 export)** — still the big
   missing pillar per prior session's notes.

## Open questions

- Whether 8GB is actually sufficient for the client's real video sizes, or
  needs to go higher / be made configurable.
- Whether the client wants to reintroduce R2 (or similar) for scalability
  once they're past solo testing — pending discussion.
- Serverless deploy compatibility of the current buffer-in-memory proxy
  design has not been evaluated (relevant if/when moving off local dev).
- Still deferred from prior sessions: Phase 5 export, filler-word detection,
  semantic/rambling trim, preset value tuning against real footage.
