# Verify: Founder's Frame Landing Page · spec 0001 & 0002 · updated 2026-07-17
_Steps derived from spec 0001 acceptance criteria. `/check verify` runs these; `/test` locks the durable ones._

## UI / manual
- [ ] Navigate to the landing page, verify Hero, Showcase, Features, Footer render -> AC-1
- [ ] Click CTA button, verify it links to Ruff Cut and Wallet correctly -> AC-2
- [ ] Navigate to `/unknown`, verify custom 404 page shows and links to Home -> AC-4

## Commands
- [ ] `npm run build -w @repo/founders-frame` -> static export succeeds -> AC-3

## Acceptance-criteria coverage
- AC-1 is covered by step 1
- AC-2 is covered by step 2
- AC-3 is covered by step 4
- AC-4 is covered by step 3
