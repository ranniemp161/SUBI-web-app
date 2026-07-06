# Roadmap — Rough Cut App

The core video transcription and AI cutting application.

**Build approach**: Tracer Bullet — vertical slices; each feature built end-to-end through every layer, working.
**Weight profile**: mostly lean and medium

## At a glance

| # | Feature | Phase | Status |
|---|---------|-------|--------|
| 1 | Buy Credits Redirect | Slice 1 | done |

## Slice 1

### 1. Buy Credits Redirect · done
Redirect the local Stripe checkout modal to the separated Wallet app.
**Done when:** clicking "Buy credits" anywhere in Rough Cut deep-links the user to the Wallet app (e.g., localhost:3000) instead of opening the local Stripe popover.
- [x] Build it: `/develop buy credits redirect`
