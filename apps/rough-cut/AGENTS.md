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
| `src/lib/blob.ts` | Vercel Blob direct-upload + delete-after-transcription |
| `src/lib/export/*`, `src/workers/export-worker.ts` | Client-side WebCodecs MP4 export (Chromium-only, see `LIMITATIONS.md`), plus browser-agnostic NLE interchange export (`fcpxml.ts`, `cmx3600.ts`) sharing `timebase.ts`/`filename.ts` frame-math and filename-sanitizing helpers, downloaded via `src/lib/download-text-file.ts` |
| `src/lib/authz.ts` | Write-route authorization — the `users` row (provisioned by the Clerk webhook or its fallback) IS the authorization; there is no separate access-code verify route (`src/lib/access-codes.ts` no longer exists) |
| `src/app/api/webhooks/clerk/route.ts` | Clerk user-sync webhook (svix-verified) |
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
  no-op until `SENTRY_DSN`/`NEXT_PUBLIC_SENTRY_DSN` are set.
- Tests are colocated `*.test.ts(x)` next to source, run with Vitest.
- **ESLint & Mocking**: When mocking components with `forwardRef` in tests, avoid anonymous arrow functions. Use named function expressions (e.g. `forwardRef(function VideoPlayerStub() {})`) to satisfy `react/display-name`. Do not declare unused arguments in callback parameters (e.g. `props`, `ref`, `url`, `init`) to satisfy `@typescript-eslint/no-unused-vars`.
- **Dropdowns/menus**: build on Radix (`@radix-ui/react-select` for a value picker, `@radix-ui/react-dropdown-menu` for an action menu), never hand-roll outside-click/Escape/focus logic — the same precedent `packages/ui/src/confirm-dialog.tsx` set for dialogs. See the export cluster's `StyledSelect`/`ExportFormatMenu` in `src/app/(app)/dashboard/[id]/page.tsx` for the pattern.

## Agent skills
- Declined: Radix UI tooling (`radix-ui-design-system` skill, `radix-mcp-server` MCP) — Radix's own docs plus the local `confirm-dialog.tsx`/`StyledSelect` precedent are enough for now.

## Gotchas
- Deepgram's transcription callback isn't signed — a per-project random token
  (`transcriptCallbackToken`) is the real gate, checked after the IP rate limit.
- On localhost (no public callback URL) transcription reads the transcript
  synchronously, holding the request open; set `PUBLIC_APP_URL` to force the
  production callback path locally.
- Deepgram enforces an upload size cap (2 GB by default, configurable via the `DEEPGRAM_MAX_UPLOAD_BYTES` environment variable) enforced at Blob token issuance (`maximumSizeInBytes`), not after upload.

## Related ADRs
- `docs/adr/_root/0001-monorepo-wallet-architecture.md`
