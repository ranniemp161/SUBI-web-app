# Memory — USD Wallet: reconciliation + hardening cleanup

Last updated: 2026-07-08

## What was built

- No new features this session. This was a **reconciliation session**: the prior `memory.md` was stale (claimed slice 3/wallet-ui was still pending), so I cross-checked it against `docs/roadmap/_root/roadmap.md`, `docs/adr/_root/0002-usd-wallet/index.md`, and git log.
- Fixed `docs/adr/_root/0002-usd-wallet/verify-wallet-ui.md`: the file was corrupted (UTF-8 head + an accidentally UTF-16LE-encoded tail appended, making the whole file read as garbage/binary "data"). Recovered the lost tail content byte-by-byte (found the UTF-8/UTF-16LE boundary at byte offset 2665) and rewrote the file as clean UTF-8. No content was lost — the 4 recovered checklist items (dashboard 2/3 grid layout, ecosystem apps section, Rough Cut app card link, Infographics/Thumbnail "Coming Soon" cards) are preserved, unchecked, under a new `## UI / manual (dashboard layout & app launcher)` subheading.

## Decisions made

- Confirmed (via roadmap + ADR, not just git log) that the **entire USD-denominated Wallet feature is `done`** — all 3 slices (money-ledger, auto-recharge, wallet-ui) built, verified, and tested per `docs/roadmap/_root/roadmap.md`. Slice 3 (premium wallet UI, commit `20f52dc`) was already complete; the previous session's memory was out of date on this point.
- Did not touch the uncommitted `packages/db/src/index.ts` change (retry-timeout scaling by attempt number + a cross-realm `instanceof` fallback for `DbTimeoutError`) — it's unrelated to the wallet feature and was left as-is pending a user decision on how to handle it.

## Problems solved

- Diagnosed and fixed the corrupted `verify-wallet-ui.md` (see above). Root cause was almost certainly a PowerShell `Out-File`/similar write using UTF-16 default encoding appended to an existing UTF-8 file in a prior session.
- Verified the two `docs/hardening/2026-07-08-uncommitted.md` should-harden findings (missing fetch timeout/abort, swallowed network errors in `apps/wallet/src/app/dashboard/autorecharge-panel.tsx`) are **already fixed** in the current code — no action needed, avoided redundant work.
- Verified the critical hardening finding from `docs/hardening/2026-07-08-main.md` (fail-open `CRON_SECRET` bypass in `apps/wallet/src/app/api/cron/autorecharge/route.ts:60`) is **already fixed** — code fails closed.

## Current state

- Wallet feature is functionally complete and verified on dev per the roadmap. Nothing code-wise was changed this session except the doc-encoding fix.
- **Uncommitted in working tree:** `docs/adr/_root/0002-usd-wallet/verify-wallet-ui.md` (encoding fix, ready to commit) and `packages/db/src/index.ts` (unrelated retry-timeout tweak, pre-existing from before this session, not yet committed or reviewed in depth).
- Still true from before: prod migrations `0002`–`0004` not yet applied; app not yet deployed to Vercel.

## Next session starts with

- Ask the user whether to commit the `verify-wallet-ui.md` fix (and whether to bundle or separate it from the `packages/db/src/index.ts` retry change — they're unrelated, so likely separate commits).
- Then either move to prod deploy readiness (migration baseline + apply 0002–0004, per `packages/db/MIGRATIONS.md`) or address the still-open ADR follow-ups (member monthly grant form, notification channel for auto-recharge declines) — user has not yet chosen which.

## Open questions

- Same as ADR 0002 "Follow-up" section: member monthly grant money-era form (deferred to client), auto-recharge notification channel (deferred), AI Cut retail rate (deferred).
- Whether/how to commit the unrelated `packages/db/src/index.ts` retry-timeout change — was it finished, or is it mid-edit from an earlier session?
