# Review, client-preview, 2026-07-11

**Reviewed by**: claude-opus-4-8 (author on unknown)
**Scope**: ~30 files, branch `client-preview` vs `main` (merge-base e9ada52), incl. uncommitted working tree
**Verdict**: Changes requested

## Summary
The branch does three things: restricts the monthly credit grant to a single allowlisted demo email (schema default flip + `provisionUser` allowlist + one-time backfill migration), hardens per-user API responses with `Cache-Control: no-store`, and removes the placeholder auto-recharge notification seam. It also rebrands the wallet header, adds a local-only demo top-up script, widens `turbo.json` build env passthrough, adds a Vercel Deployment-Protection bypass to the Deepgram callback URL, and drops the auto-recharge cron from every-2-minutes to once daily.

The headline verification requested — that removing `apps/wallet/src/lib/notifications.ts` did not weaken billing — passes: `recordAutoRechargeFailure` (counter bump + auto-disable in one statement), `depositAutoRecharge` (idempotent deposit + failure reset), the daily cap, and the idempotency key are all untouched. The removal only dropped best-effort, off-billing-path notify calls. Overall quality is high with genuine test coverage. Two things should be confirmed before merge: the cron cadence change and the migration's hardcoded email.

## Major
### 🟠 Auto-recharge cron dropped from every 2 min to once daily, `vercel.json:9`
**Problem**: The schedule changed from `*/2 * * * *` to `0 5 * * *`. Auto-recharge now sweeps only once per day at 05:00 UTC.
**Why it matters**: Auto-recharge exists so a user's balance never strands mid-work. With a daily sweep, a user who drops below their threshold just after 05:00 waits ~23 hours before the top-up fires, during which the child-0001 non-negative CHECK gates their service at $0. That materially changes the feature's contract (near-real-time safety net → daily batch). It may well be intentional cost control for a single-account client preview — but it should be a conscious decision, not an incidental one, and ideally the ADR/roadmap notes the reduced responsiveness.
**Suggested fix**: Confirm intent. If preview-only, leave a comment in `vercel.json` or the ADR follow-up noting the cadence is deliberately reduced and should be restored (e.g. every 5–15 min) before general availability.

## Minor
### 🟡 Migration backfill hardcodes the allowlist email, diverging from the runtime env var, `packages/db/drizzle/0009_dizzy_human_fly.sql:7`
**Problem**: The one-time backfill hardcodes `lower('rannieandtj@gmail.com')`, while runtime membership is decided by `MEMBER_ALLOWLIST_EMAIL` (`apps/rough-cut/src/lib/users.ts`). The two sources of truth are independent.
**Why it matters**: If `MEMBER_ALLOWLIST_EMAIL` in a given environment is ever set to a different address than the one baked into the migration, the backfill grants membership to the wrong existing row, and the app then flips it on the next `provisionUser`. Today they happen to match, so impact is low, but the coupling is invisible and easy to break later. Also note the operational dependency this creates: if `MEMBER_ALLOWLIST_EMAIL` is unset in prod, the demo account that the migration set to `is_member=true` will be silently reverted to `false` on its next sign-in (since `isAllowlistedMember` returns false). `MEMBER_ALLOWLIST_EMAIL` is a hard prod requirement for the demo to keep working — it is now in `turbo.json` build passthrough, good, but it must also be present at runtime.
**Suggested fix**: Leave a comment in the migration cross-referencing `MEMBER_ALLOWLIST_EMAIL` and stating the value must match the prod env var; and add `MEMBER_ALLOWLIST_EMAIL` to the required-prod-env checklist (it is a silent-revocation risk if missing).

### 🟡 Vercel bypass secret placed in the callback query string, `apps/rough-cut/src/app/api/transcribe/deepgram/route.ts:216`
**Problem**: `VERCEL_AUTOMATION_BYPASS_SECRET` is appended to the callback URL as `x-vercel-protection-bypass=...`. That URL is handed to Deepgram and is later requested by Deepgram's servers.
**Why it matters**: Query-string secrets tend to land in access logs (Vercel edge logs, Deepgram's outbound request logs, any proxy in between) in a way headers do not. This is Vercel's documented bypass mechanism so it is not wrong, but the secret's exposure surface is wider than a header would be. (The pre-existing `token` param has the same property, so this is an incremental, not new, exposure.)
**Suggested fix**: Acceptable as-is given it is the documented mechanism, but note the log-exposure trade-off; if Deepgram supports custom callback headers, prefer sending the bypass as a header. At minimum ensure the secret is rotatable.

### 🟡 Committed npm script points at a git-ignored file, `packages/db/package.json:17`
**Problem**: `"topup-demo-account": "tsx scripts/topup-demo-account.ts"` is committed, but `.gitignore` excludes `packages/db/scripts/topup-demo-account.ts` (local-only by design).
**Why it matters**: On any fresh clone or CI checkout the script file is absent, so `npm run topup-demo-account` fails with a missing-file error rather than anything actionable. A committed script referencing an intentionally-absent file is a footgun for the next developer.
**Suggested fix**: Either keep the script out of the committed `package.json` too, or add a short guard/README note that the target file is local-only and must be created from a template.

### 🟡 New Vercel-bypass branch is untested, `apps/rough-cut/src/app/api/transcribe/deepgram/route.ts:214`
**Problem**: The `if (process.env.VERCEL_AUTOMATION_BYPASS_SECRET)` branch that injects the bypass param has no test; the deepgram callback-mode tests exercise the URL only with the secret unset.
**Why it matters**: TESTS = configured here, and this is security-adjacent URL construction (a wrong param name would silently re-break the "stuck on processing" bug the change fixes). The switch from manual `encodeURIComponent` to `URL.searchParams` also changed encoding behavior and is only implicitly covered.
**Suggested fix**: Add a callback-mode case with `VERCEL_AUTOMATION_BYPASS_SECRET` set, asserting the callback URL carries `x-vercel-protection-bypass` and a correctly-encoded `blobUrl`.

## Nits
- ⚪ `apps/wallet/src/app/api/cron/autorecharge/route.ts:48` — docstring still says "the behaviour (notify, then auto-disable after N declines)"; the notify step is gone. Update to avoid referencing the removed seam.
- ⚪ `apps/wallet/src/lib/autorecharge.ts` (`recordAutoRechargeFailure` doc) — comment still says it returns disabled/failures "so the caller notifies"; the caller no longer notifies. The `{ failures, disabled }` return is now unused by the only caller — fine to keep, but the rationale comment is stale.
- ⚪ `apps/wallet/src/app/api/cron/autorecharge/route.ts:30` — `noteFailure` is now a one-line pass-through to `recordAutoRechargeFailure`; consider inlining, or keep it as a named seam if intended.
- ⚪ `packages/db/drizzle/0009_dizzy_human_fly.sql:7` — file has no trailing newline (`\ No newline at end of file`); harmless but inconsistent with other migrations.

## Strengths
- The requested regression check holds: billing correctness (failure counting, auto-disable, deposit-on-success, idempotency key) is fully preserved through the notifications removal; the deleted seam was genuinely off the billing path and never threw.
- `Cache-Control: no-store` added consistently to every per-user endpoint (credit balance, project status, auto-recharge settings) — correctly prevents a shared cache/proxy from serving one user's balance to another.
- Landing-page redirect moved from `page.tsx` `auth()` into `proxy.ts`, keeping the marketing page static/CDN-served while the middleware (which runs before cache) still guarantees the redirect — and both the signed-in and anonymous paths are unit-tested.
- Allowlist logic is clean: case-insensitive, env-driven, and covered by a new test asserting both the allowlisted and non-allowlisted outcomes.
- The demo top-up script derives its target from `MEMBER_ALLOWLIST_EMAIL` (no second hardcoded email), writes a real `credit_ledger` row instead of overwriting `balance_micros`, and is deliberately never exposed as a route — well-reasoned.

## Test coverage
Good for the app-logic changes: `provisionUser` allowlist (both branches), the proxy landing-page redirect (both branches), and the no-store header on the credits route are all newly covered. Gaps: the Deepgram Vercel-bypass URL branch is untested (Minor, security-adjacent), and the migration backfill has no verification. The notification-removal test edits correctly drop the now-dead `notices` assertions without weakening the billing assertions (`deposited`, `charged`, decline/cap counts remain). The `prod-*` skill markdown files are non-code workflow docs and were skimmed only.
