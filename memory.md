# Memory — Whisper removal + Ruff Cut landing page redesign

Last updated: 2026-07-04

## What was built

Everything below is **uncommitted** (working tree, on `main`). Two logical
chunks, user was offered a 2-commit split but hasn't said go yet:

### Chunk 1 — Whisper transcription path removed (Deepgram is now the ONLY provider)
- Deleted `src/app/api/transcribe/whisper/route.ts` (had no test file) and
  `scripts/transcribe_whisper.py` (scripts/ dir now empty).
- `src/app/(app)/dashboard/page.tsx`: removed the `TRANSCRIBE_PROVIDER` env
  switch (`NEXT_PUBLIC_TRANSCRIBE_PROVIDER`, which defaulted to whisper — the
  prod footgun) and `startWhisperTranscription()`; the Deepgram flow
  (extract audio → Blob upload → deepgram route) is now unconditional.
- `next.config.ts`: removed `experimental.proxyClientMaxBodySize: "8gb"`
  (existed only for whisper's raw video uploads).
- `LIMITATIONS.md`: "single long-running Node process" + "concurrent-upload
  memory ceiling" sections replaced with "serverless-compatible by design";
  size-limit wording now points at Blob token issuance; whisper Turbopack
  build-note section deleted (warning gone with the route).
- Comment cleanups: `src/lib/deepgram.ts`, `src/lib/edl.ts`,
  `src/app/(app)/dashboard/[id]/page.tsx`. The `reRoughCut` identifiers were
  deliberately left alone (film term, not branding).

### Chunk 2 — Landing page redesign + rebrand to "Ruff Cut"
- `src/app/page.tsx` rebuilt: sticky blur nav, hero with ambient glow,
  3-step "How it works", feature grid (hover polish), privacy callout
  section ("Your video never leaves your computer"), 8-item FAQ using native
  `<details>/<summary>` (zero client JS, server-rendered), bottom CTA.
  FAQ covers: video privacy, Chrome/Edge-only export, file re-selection on
  reopen, device-bound export speed/4K, H.264 MP4 formats, internet needed
  for transcription, Descript comparison, Skool access code.
- Brand "Rough Cut" → "Ruff Cut" in: `src/app/page.tsx`,
  `src/app/layout.tsx` metadata (description now includes privacy line),
  `src/app/(app)/layout.tsx` header.
- `src/app/(auth)/sign-in/[[...sign-in]]/page.tsx`: Clerk `<SignIn />`
  restyled via `appearance` prop with app design tokens (bg-background,
  foreground/xx, blue-600 primary, colorPrimary #2563eb) — **not yet
  visually verified by user**; Clerk footer element is the usual override
  holdout if anything still looks stock.

## Decisions made

- **Deploy target is Vercel (serverless) — locked.** That's WHY whisper was
  removed (needs Python + disk + long-running process). Don't rebuild it.
- **App name: "Ruff Cut"** — user's explicit choice (matches the Blob store
  name "ruffcut"), chosen over "Rough Cut" despite the dog-pun caveat being
  raised. Clerk Dashboard app name still says "My Application" — user's task.
- **Tier-based pricing: dropped.** Client changed their mind mid-planning
  (was going to be a $5 upgrade). Focus is production-readiness instead.
- **Auth stays as-is for now** — user is happy with the shared Skool
  access-code gate. Two known issues were flagged and "noted" (not fixed):
  (1) rotating ACCESS_CODE locks out EXISTING users because write routes
  re-check the live env var on every request (fix design: persist an
  accessGranted flag on users row at webhook time instead);
  (2) "Continue with Google" on the sign-in page can create an OAuth account
  with no access code → webhook deletes it → confusing UX; disabling Google
  in the Clerk Dashboard was suggested.

## Problems solved

- Deleting `.next` while the dev server is running breaks it (user saw
  "Internal Server Error" on Clerk's /sign-in/sso-callback) — fix is just
  restarting the dev server. Also: `tsc` fails after deleting a route because
  stale `.next/types/validator.ts` still references it — rebuild regenerates.

## Current state

- `tsc` clean, **104/104 vitest pass** (14 files), `next build` succeeds with
  NO warnings (the whisper Turbopack tracing warning died with the route).
- User's `.env.local` still has a dead `NEXT_PUBLIC_TRANSCRIBE_PROVIDER=deepgram`
  line (harmless; nothing reads it anymore).
- Local dev now always uses Deepgram (sync mode without PUBLIC_APP_URL) —
  the free local whisper option is gone, so local testing spends Deepgram credit.
- Sign-in restyle awaiting the user's visual check in the browser.

## Next session starts with

1. Ask if the sign-in page looks right (they were mid-verification); patch
   specific Clerk elements if anything is still stock-white.
2. **Commit the two chunks** (whisper removal; landing page + rebrand +
   sign-in styling) — long overdue, everything verifies.
3. Then the production-readiness list, in the order recommended: **CI setup
   (top priority, zero workflows exist)** → access-code rotation fix →
   callback-mode e2e test on a public host → 4K/HEVC export manual verification.

## Open questions

- CI: GitHub Actions running tsc + vitest + build on push — recommended,
  not yet approved/built.
- Access-code architecture decision (accessGranted flag vs per-invite codes)
  — user said "can't decide yet."
- Landing page FAQ promises only H.264 MP4; HEVC/WebM stay unadvertised
  until manually verified.
- Older backlog: orphaned private "ruffcut" Blob store (delete or ignore),
  R2-vs-Blob client conversation, prod Neon migration, Vercel passkey login
  issue (user's account).
