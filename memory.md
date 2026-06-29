# Memory — Rough Cut App — Access-Code Race Fix + Phase 2 Transcription Pipeline

Last updated: 2026-06-30

## What was built

**Access-code race fix:**

- `src/lib/access-code.ts` (new) — extracted `hasValidAccessCode(unsafeMetadata)` helper, shared by the Clerk webhook and both write routes that need it.
- `src/app/api/projects/route.ts` — `POST` now re-validates the access code via `currentUser()` on every request (not just the webhook). Closes a real race: `signUp.create()` grants a session immediately, before the async `user.created` webhook has had a chance to delete an invalid signup — without this check, a fast enough invalid signup could create real `users`/`projects` rows in that window.
- `src/app/api/webhooks/clerk/route.ts` — switched to use the shared `hasValidAccessCode` helper instead of inline duplicate logic.

**Phase 2 — Transcription pipeline (architecture revised twice this session, see Decisions):**

- `src/db/schema.ts` — added `transcriptStatus` (`"idle" | "processing" | "ready" | "failed"`, default `"idle"`) and `transcriptCallbackToken` (nullable) to `projects`. Pushed live to Neon via `drizzle-kit push` (confirmed via direct query — both columns exist in production).
- `src/lib/projects.ts` (new) — extracted `getOwnedProject(projectId, clerkId)` out of `src/app/api/projects/[id]/route.ts` into a shared helper; both that route and the new transcribe routes import it now.
- `src/app/api/transcribe/init/route.ts` (new) — auth + access-code check, looks up the project via `getOwnedProject`, mints a Deepgram temporary API key (5-min TTL, `usage:write` scope, via `@deepgram/sdk`'s `manage.v1.projects.keys.create`), generates a random callback token (`crypto.randomBytes(32)`), sets `transcriptStatus: "processing"` + stores the token, returns `{ temporaryApiKey, callbackUrl }` to the browser.
- `src/app/api/transcribe/callback/route.ts` (new) — receives Deepgram's finished-transcript POST. No Clerk auth (Deepgram calls it directly). Validates `projectId` is a well-formed UUID (regex check — added after testing surfaced an unhandled 500 on malformed input), compares the token with `crypto.timingSafeEqual`, writes the transcript and flips `transcriptStatus` to `"ready"`/`"failed"`, clears the token after use (one-time-use).
- `src/proxy.ts` — added `/api/transcribe/callback` to the public-route allowlist (same pattern as `/api/webhooks/clerk`), since Deepgram's callback has no Clerk session.
- `src/app/(app)/dashboard/page.tsx` — `handleFileSelected` now actually uses the selected `File` (was previously ignored, named `_file`): after project creation, calls `startTranscription(projectId, file)`, which hits `/api/transcribe/init` then uploads the **video file directly to Deepgram's `/v1/listen`** from the browser using the temp key. Added polling (`useEffect` + `setInterval`, 4s) that refetches `/api/projects/:id` for any project still `"processing"`, and a status badge (`TRANSCRIPT_STATUS_LABEL`) on each project row.
- `.env.example` and `.env.local` — added empty `DEEPGRAM_API_KEY` / `DEEPGRAM_PROJECT_ID` placeholders. **Real values still need to be filled in** — nothing Deepgram-related has been tested against a live account yet.
- `package.json` — added `@deepgram/sdk` (v5.5.0). **`libav.js` was installed then fully removed** (see Decisions) — not in the final dependency list.

## Decisions made

- **Deploy target is Vercel.** Decided this session after weighing Vercel vs Railway/Render — Vercel was the better fit once the streaming-proxy upload design (which only works on a persistent server) was dropped. No deploy config exists in the repo yet (no `vercel.json`) — that setup itself hasn't happened.
- **Architecture pivoted twice this session, ending at: browser uploads the video file directly to Deepgram, our server never touches it.**
  1. Original (from last session's memory): stream the audio through our own `/api/transcribe` route to Deepgram. Rejected — Vercel serverless functions cap request body size before route handler code runs, so an in-code streaming passthrough wouldn't reliably work there.
  2. Revised: extract audio client-side via libav.js in a Web Worker, then upload the extracted audio directly to Deepgram using a short-lived scoped key. Audio never touches our server, sidestepping the Vercel body-size question entirely.
  3. Final (after starting on #2): libav.js turned out to be a raw low-level ffmpeg binding (no "extract audio" helper — would require hand-writing a demux/decode/resample/encode/mux pipeline with no way to test it against a real video file in this environment). Decided to drop libav.js entirely and **upload the whole video file directly to Deepgram** — Deepgram accepts common video containers (MP4/MOV/WebM) directly and extracts audio server-side. Tradeoff accepted: more upload bandwidth for very large files, in exchange for not shipping an untested, high-risk hand-rolled audio pipeline.
- **Deepgram callback is treated as unsigned.** The per-project random `transcriptCallbackToken`, compared with `crypto.timingSafeEqual`, is the only verification on `/api/transcribe/callback`. Token is cleared after first use (one-time-use), closing a replay window.
- **Access-code re-check belongs in every write route, not just the webhook** — `hasValidAccessCode` is now called from `/api/projects` POST and `/api/transcribe/init`, and should be added to any future write route too.

## Problems solved

- **Stale auto-generated Drizzle migration would have tried to `CREATE TABLE` on tables that already exist.** The project's `users`/`projects` tables were created via `drizzle-kit push` originally (no tracked migration files existed, `drizzle/` wasn't in git). Running `drizzle-kit generate` for the schema change produced a fresh `0000_*.sql` that recreated both tables from scratch. Caught before applying — deleted the generated migration, used `drizzle-kit push` instead (consistent with how the schema was originally applied), confirmed via a direct query that only the two new columns were added, no data loss.
- **`/api/transcribe/callback` threw an unhandled 500 on a malformed `projectId`** (e.g. non-UUID string) because the initial `db.select()` lookup wasn't wrapped in a try/catch and Postgres rejects invalid UUID syntax. Fixed by validating the UUID format with a regex before querying, returning a clean 400 instead.
- **Deepgram's `@deepgram/sdk` `keys.create()` return type isn't wrapped in `{ data }`** — initial code destructured `{ data: tempKey }` based on a guess; `tsc` caught it immediately (`Property 'data' does not exist on type 'CreateKeyV1Response'`). Fixed by awaiting the call directly.

## Current state

- Access-code race fix is live and type-checked (`tsc --noEmit`, `eslint`, `next build` all pass), but not re-tested end-to-end in a browser this session (Phase 1 signup flow was already verified live last session; this fix only adds a redundant server-side check on top, didn't re-run the manual signup test).
- Phase 2 transcription plumbing is fully built and passes `tsc --noEmit`, `eslint`, and `next build`. Manually curl-tested both new routes locally (with the existing dev server already running on port 3000) — confirmed Clerk's dev-mode auth redirect behavior on `/api/transcribe/init` (expected, not a bug — curl has no Clerk dev-browser cookie) and confirmed `/api/transcribe/callback` now returns clean 400/401 for bad input instead of crashing.
- **Nothing Deepgram-related has been tested against a real account.** `DEEPGRAM_API_KEY` and `DEEPGRAM_PROJECT_ID` are still empty placeholders in `.env.local`. The full round-trip (mint key → browser uploads video → Deepgram calls back → `transcriptStatus` flips to `"ready"` with a populated `transcript`) is unverified.
- No Vercel deployment config exists yet in the repo.

## Next session starts with

1. Get real Deepgram credentials (API key + project ID) and fill them into `.env.local`.
2. Manually test the full Phase 2 flow: sign in, upload a small video from the dashboard, confirm `transcriptStatus` flips `idle → processing → ready` in Neon and `projects.transcript` gets populated. Deepgram can't reach `localhost` directly, so this needs a tunnel (cloudflared, same approach as the Clerk webhook test from the prior session) pointed at the local dev server, with that tunnel URL reachable from `/api/transcribe/callback`'s callback URL (which is built from `request.url`'s origin — confirm this resolves to the tunnel URL, not `localhost`, when testing through the tunnel).
3. Once the pipeline is confirmed working, set up actual Vercel deployment config/project (none exists yet) and add the Deepgram + other env vars there.

## Open questions

- Whether Deepgram's `nova-3` model + `smart_format=true` (the options currently hardcoded in `dashboard/page.tsx`'s `startTranscription`) are the right defaults — not deliberated this session, just picked as reasonable starting values.
- No retry/cleanup logic exists yet for a project stuck in `"processing"` forever (e.g. if the browser's direct upload to Deepgram fails silently, or the callback never arrives). Not addressed this session.
- File-size practicality of uploading full videos (rather than extracted audio) to Deepgram for very large files (the existing 20GB warning in `file-picker.tsx`) hasn't been tested — this was an accepted tradeoff, not a verified-fine outcome.
