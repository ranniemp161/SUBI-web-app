# Memory — Rough Cut App — Local Whisper Transcription (temporary Deepgram stand-in)

Last updated: 2026-06-30

## What was built

**Deepgram credential mismatch discovered (still unresolved):**

- The `DEEPGRAM_API_KEY` / `DEEPGRAM_PROJECT_ID` pair in `.env.local` does not work — verified directly against Deepgram's API (`GET /v1/projects` and `GET /v1/projects/:id`) multiple times. The key only has access to project `5959aa16-...`, but `.env.local` has `edc4565c-...` (the project ID the user says was given by their client). Every combination tried returned `403`/`404` from Deepgram directly — not a guess, confirmed via direct API calls.
- User is having a Google Meet with the client soon to sort out the correct key/project pairing. Decision: **temporarily swap the transcription backend to local faster-whisper** to keep testing the rest of the pipeline (upload → transcribe → dashboard status) without waiting on Deepgram.

**Local faster-whisper pipeline (temporary, parallel to the existing Deepgram code — Deepgram code is untouched):**

- `scripts/transcribe_whisper.py` (new) — standalone script, takes a media file path as argv[1], runs `faster_whisper.WhisperModel("small", device="cpu", compute_type="int8")`, prints a JSON transcript (segments + full text) to stdout. Confirmed working: Python 3.14.5 + faster-whisper 1.2.1 + PyAV 16.1.0 + ffmpeg are all installed locally.
- `src/app/api/transcribe/whisper/route.ts` (new) — POST route. Auth + `hasValidAccessCode` check (same pattern as `/api/transcribe/init`), `getOwnedProject` lookup, accepts multipart `projectId` + `file`, sets `transcriptStatus: "processing"`, saves the upload to a temp dir (`fs/promises.mkdtemp`), then **kicks off `execFile("python", [scriptPath, mediaPath])` without awaiting it** and returns `{ received: true }` immediately — the actual whisper run + DB write to `"ready"`/`"failed"` happens in the background after the response is sent. This was a deliberate redesign (see Problems Solved) to avoid blocking the HTTP response for the full transcription duration.
- `src/app/(app)/dashboard/page.tsx` — `startTranscription` now POSTs a `FormData` (`projectId` + `file`) to `/api/transcribe/whisper` instead of hitting `/api/transcribe/init` + uploading straight to Deepgram. Comment marks this as TEMPORARY with a pointer back to the Deepgram flow.
- `next.config.ts` — added `experimental.proxyClientMaxBodySize: "2gb"` (the correct, non-deprecated key — `middlewareClientMaxBodySize` is deprecated in this Next version). Needed because `clerkMiddleware` (`src/proxy.ts`) runs on `/api` routes and defaults to buffering only 10MB, which silently truncated video uploads and corrupted the multipart body.
- `src/app/globals.css` — added a plain CSS `@keyframes indeterminate-progress` + `.animate-indeterminate-progress` class (not a Tailwind utility — this project's globals.css had no prior custom-utility pattern to follow).
- `src/app/(app)/dashboard/page.tsx` — added an indeterminate animated progress bar under any project row with `transcriptStatus === "processing"`. Also fixed a related bug: newly-created projects were added to local state with their server-returned default status (`"idle"`), but the polling `useEffect` only polls projects whose *current client state* is `"processing"` — so the new project was invisible to both polling and the progress bar until a later state already existed. Fixed by optimistically setting `transcriptStatus: "processing"` in the same `setProjects` call that adds the new project.
- `src/app/(auth)/sign-in/[[...sign-in]]/page.tsx` — added `fallbackRedirectUrl="/dashboard"` to the Clerk `<SignIn>` component. It was missing entirely, so successful sign-in landed back on the marketing homepage instead of the dashboard (sign-up already had its own correct `router.push("/dashboard")`).

## Decisions made

- **Local whisper is explicitly temporary** — only meant to unblock testing while Deepgram credentials get sorted with the client. The original Deepgram code (`/api/transcribe/init`, `/api/transcribe/callback`) is untouched and is the intended path to restore once Deepgram works.
- **Fire-and-forget background processing instead of a synchronous request/response.** First attempt awaited the whole whisper run inside the route handler — this worked correctly end-to-end in one test (confirmed: DB ended up with a real `"ready"` transcript) but the browser-visible response routinely exceeded the dev cloudflared tunnel's ~100s edge timeout (524 errors), even though the server-side work had actually succeeded. Switched to: save the upload, set `"processing"`, return immediately, run whisper unawaited in the background, write `"ready"`/`"failed"` when it finishes — the dashboard's existing 4s polling picks up the change.
- **The Cloudflare tunnel is unnecessary for the whisper flow and actively gets in the way.** It was only needed for Deepgram's webhook callback to reach localhost from the internet. Local whisper has no external caller, so testing should go through `http://localhost:3000` (or the LAN IP) directly, not the `trycloudflare.com` tunnel URL.
- **Progress UI: indeterminate animated bar, not a real percentage** — explicit user choice over building real per-segment progress tracking (would require the Python script to stream progress through the route to the client), since this whisper path is temporary and will be replaced once Deepgram works. Real percentage tracking deferred until after Deepgram is sorted, since Deepgram's API may expose progress differently anyway.

## Problems solved

- **`/api/transcribe/whisper` request body was being truncated at 10MB**, corrupting the multipart upload (`TypeError: Failed to parse body as FormData`) — `clerkMiddleware` defaults to a 10MB body-buffer cap on `/api` routes. Fixed via `experimental.proxyClientMaxBodySize: "2gb"` in `next.config.ts` (first tried the deprecated `middlewareClientMaxBodySize` key, Next logged a deprecation warning pointing to the correct one).
- **Synchronous whisper route caused Cloudflare 524 timeouts** even though the server-side work completed successfully — see Decisions above. Root-caused by checking Neon directly (`transcript_status` did flip to `"ready"` with a real transcript shortly after the tunnel had already returned a 524 to the browser).
- **Accidentally overwrote a real, successfully-generated transcript with placeholder test data** while debugging the above — ran a manual `UPDATE ... SET transcript = '{"text":"manual test"}'` against the live DB to verify the write path worked, not realizing the real transcript had landed moments earlier. Disclosed to the user; the original transcript content is unrecoverable, but the pipeline bug itself was real and is now understood.
- **New project uploads silently never reached the server at all** (no log line, no error) when `handleFileSelected` called `router.push('/dashboard')` right after creating the project — completely redundant since the user was already on `/dashboard`, but the navigation interrupted the in-flight fire-and-forget upload before its `fetch` could leave the browser. Fixed by deleting the redundant `router.push` call (and the now-unused `useRouter` import/`router` variable).
- **Deepgram project ID mismatch root-caused conclusively**, not just suspected — `curl`'d Deepgram's API directly with the exact `.env.local` key and got a `404 NOT_FOUND` for the specific project ID on file, and a `GET /v1/projects` listing showing the key only has access to a *different* project ID. This rules out "it's just a typo on my end" guesses — the key and project ID genuinely don't belong together as configured.
- **Stuck-at-`"processing"`-forever gap** (flagged in a `/code-review` pass): the synchronous prefix of `/api/transcribe/whisper` (status update, `mkdtemp`, `writeFile`) wasn't wrapped in try/catch — if any of it threw, the project would be stuck at `"processing"` with no failure path. Fixed: that block is now wrapped in try/catch; on failure it sets `transcriptStatus: "failed"` and returns a 500 before the background whisper call is ever kicked off.

## Current state

- Local whisper pipeline is fully working end-to-end, confirmed with a real test video: upload → `"processing"` (with visible progress bar) → background whisper transcription → `"ready"` with real transcript text written to Neon → dashboard polling picks up the status change automatically.
- The stuck-at-`"processing"` error-handling gap is fixed and type-checked/linted clean (`tsc --noEmit`, `eslint` both pass).
- Three issues from the `/code-review` pass were explicitly deferred (not fixed) per user instruction, to be resolved when swapping back to Deepgram:
  1. Landing page (`src/app/page.tsx`) and `file-picker.tsx` still claim "your video never leaves your machine" / "100% private" / "nothing is uploaded" — currently false while the whisper path is active, since video is now uploaded to and processed on the server.
  2. The fire-and-forget background-after-response pattern in `/api/transcribe/whisper` will very likely not work on Vercel serverless (function execution typically stops once the response is sent) — fine for local dev testing, not deployable as-is.
  3. The whole video file is buffered into memory (`Buffer.from(await file.arrayBuffer())`) before being written to disk, rather than streamed — combined with the new 2GB body limit, large videos could cause memory pressure.
- Deepgram's actual root cause (key/project mismatch) is understood but **not yet resolved** — waiting on the user's Google Meet with the client to get a correctly-paired key + project ID.
- Local dev environment for testing: Python 3.14.5, faster-whisper 1.2.1, PyAV 16.1.0, ffmpeg all confirmed installed and working. Dev server should be run with `npx next dev --webpack` (Turbopack was crashing repeatedly with a Windows-specific `0xc0000142` DLL-init error spawning worker processes — webpack mode is the stable workaround on this machine). Test via `http://localhost:3000`, not the cloudflared tunnel.

## Next session starts with

1. After the user's Google Meet with the client: get the correct, matching Deepgram API key + project ID, verify with a direct `curl https://api.deepgram.com/v1/projects/:id -H "Authorization: Token $KEY"` before touching `.env.local` again (don't just trust what's reported — verify like this session did).
2. Once Deepgram is confirmed working, swap `dashboard/page.tsx`'s `startTranscription` back to `/api/transcribe/init` + direct-to-Deepgram upload, and decide whether to delete or keep `scripts/transcribe_whisper.py` + `/api/transcribe/whisper/route.ts` around as a fallback/offline testing path.
3. Revert the landing page / file-picker "100% private, nothing uploaded" copy back to being accurate (it's accurate again once Deepgram direct-upload is restored, since that path never touches our server).
4. Decide whether real percentage-based progress tracking is worth building once the final transcription backend (Deepgram) is locked in.

## Open questions

- Whether `nova-3` + `smart_format=true` (Deepgram options hardcoded in the original `dashboard/page.tsx` Deepgram path, not used while whisper is active) are still the right defaults — not re-litigated this session.
- No retry/cleanup logic exists for a project that's been stuck `"processing"` for an unreasonable amount of time (e.g. server crash mid-transcription) — the fix this session only covers synchronous failures before the background work starts, not failures *during* the background whisper run after a crash.
- File-size practicality of uploading full videos (rather than extracted audio) — still an accepted-but-unverified tradeoff, now doubly relevant since the whisper path also fully buffers the file in memory.
- No Vercel deployment config exists yet in the repo — and per the issues above, the current whisper route wouldn't work there even if it did.
