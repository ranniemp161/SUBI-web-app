# Memory — Roadmap reconciliation + prod-* skills install

Last updated: 2026-07-11

## What was built

- Ran `/roadmap` (replan behavior, no argument) against the `_root` (ecosystem-wide) workspace roadmap in a monorepo split by workspace (`docs/roadmap/index.md`, `docs/roadmap/_root/roadmap.md`, `docs/roadmap/rough-cut/roadmap.md`).
- `docs/roadmap/_root/roadmap.md`: enrolled feature 2 "Demo-only free credits gate" as `existing` (shipped off-plan via commits fd01b3d + 0f57c7c, no ADR: `is_member` now defaults to false, monthly grant restricted to a single `MEMBER_ALLOWLIST_EMAIL`). Queued feature 3 "Auto-recharge notification channel" and feature 4 "AI Cut differentiated retail rate" as new `planned` rows, sourced from ADR `_root/0002-usd-wallet`'s Follow-up section. Reworded the Open Questions note on the member monthly grant to clarify the allowlist gate is an interim demo stopgap, not the client's final decision.
- `docs/roadmap/index.md`: updated the `_root` rollup line to reflect the above.
- `docs/roadmap/rough-cut/roadmap.md`: reviewed, no changes needed — its Deferred section and Accepted risks already covered everything in its ADRs' Follow-up sections; two other recent commits (wallet nav rename, Vercel Deployment Protection bypass for Deepgram callback) are pure fixes inside already-`existing`/`done` features, not new decisions.
- Copied six new skills from `.agents/skills/` into `.claude/skills/` so they're invocable as Claude Code slash commands: `prod-architecture`, `prod-cloud-infra`, `prod-code-review`, `prod-launch-checklist`, `prod-readiness`, `prod-security`. (`.agents/skills/` and `.claude/skills/` were exact mirrors for every pre-existing skill; only these six were missing from `.claude/skills/`.)
- Updated the auto-memory naming record: wallet app nav now reads "Founder's Frame Wallet" (was tracked as placeholder "SUBI Wallet"), per commit 6e37de1.

## Decisions made

- Enrolled the free-credits-gate change as `existing` rather than `done`, since it shipped without going through `/architect`/`/develop` (no ADR) — matches the roadmap skill's "drift" convention for off-plan shipped work.
- Kept both new `_root` follow-ups (notification channel, AI Cut rate) as `planned`/queued rather than actively sequencing them now — neither is blocking, and pricing-rate change explicitly needs real `cost_micros` usage data first.
- Chose to copy (not symlink) the prod-* skill folders into `.claude/skills/`, matching how the rest of the skills already exist as independent copies in both `.agents/skills/` and `.claude/skills/` (no existing symlink pattern to follow). Flagged to the user that this means future `.agents/` installs won't auto-sync and will need the same manual copy (or a symlink setup, if preferred).

## Problems solved

- None — this session was reconciliation/config, not debugging.

## Current state

- Roadmap files (`_root/roadmap.md`, `index.md`) are edited in place and reflect current shipped state as of commit 0f57c7c. Not yet committed to git (uncommitted working tree changes).
- The six `prod-*` skills are live in `.claude/skills/` and confirmed showing up in the available-skills list (verified via a tool-search round trip after copying).
- No code changes this session, only docs/roadmap + memory + skill files.

## Next session starts with

- If picking up either queued `_root` follow-up: run `/architect auto-recharge notification channel` or `/architect ai cut differentiated retail rate` (neither is urgent/blocking).
- Consider whether to symlink `.claude/skills/` ↔ `.agents/skills/` instead of copying, if more skills get installed there in the future — currently a manual-copy step is needed each time.
- Separately still open from prior sessions: whether/how to commit long-uncommitted changes (Editor Studio UX Safety, wallet auto-recharge/security fixes) — status unconfirmed this session, worth checking `git status` at the start of the next one.

## Open questions

- The member monthly grant's final money-era form (dollar grant vs free minutes vs dropped) is still an open client conversation — the allowlist-email gate shipped this week is explicitly a stopgap, not the answer.
- Prod deploy readiness: last confirmed NOT yet deployed as of 2026-07-08 (per `project_vercel_deploy_readiness` memory); this session did not re-verify current deploy status.
