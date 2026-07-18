# 0002. Founder's Frame Landing Page Design and Copy

**Date**: 2026-07-17
**Status**: In Progress

## Summary

The Founder's Frame landing page design and copywriting have been formally ratified. We will maintain the existing dark-mode glassmorphism aesthetic (blue/amber gradients) to match our other apps, keep the current page composition (Hero, Showcase, Features, Footer), and use abstract UI mockups built with DOM/icons until real assets are ready. This unblocks the feature from its assumed state.

## Context

The initial implementation of the Founder's Frame landing page was built using an assumed specification for the design, copywriting, and asset strategy. To formally complete the feature, we needed to deliberate and confirm these UI decisions. The page serves as the primary entry point for creators to discover and access the Ruff Cut and Wallet apps, requiring a premium, cohesive aesthetic that aligns with the rest of the SUBI suite.

## Requirements

**User stories**:
- As a prospective user, I want to see a clear value proposition and product capabilities so that I can decide if Founder's Frame is right for me.
- As a returning user, I want to easily navigate to the Ruff Cut or Wallet applications so that I can manage my work and billing.

**Acceptance criteria**:
- **AC-1**: Navigate to the landing page, verify Hero, Showcase, Features, Footer render.
- **AC-2**: Click CTA button, verify it links to Ruff Cut and Wallet correctly.
- **AC-3**: Run `npm run build` and ensure static export succeeds.
- **AC-4**: Navigate to `/unknown`, verify custom 404 page shows and links to Home.

## Options considered

### Option 1: Consistent Dark-Mode Glassmorphism (Recommended)
Keep the color theme, typography, and abstract mockups consistent with the existing apps.
**Pros**:
- Zero additional design effort required; leverages existing packages/ui.
- Provides a unified brand experience across the monorepo.
**Cons**:
- Abstract mockups may not convert as highly as real product screenshots.

### Option 2: Vibrant Neon/Retro Style with Real Assets
Shift to a creator-focused neon aesthetic and introduce real image assets.
**Pros**:
- High visual impact tailored specifically to content creators.
**Cons**:
- Requires a significant redesign of the UI components and delays the launch while waiting for real assets.

## Decision

**Chosen option**: Option 1: Consistent Dark-Mode Glassmorphism

We will keep the color theme consistent with the existing apps (dark-mode, glassmorphism, blue/amber gradients) as well as the typography, maintain the current page structure, and use abstract UI mockups built with DOM/icons.

## Rationale

The engineer explicitly requested to keep the color theme and typography consistent with the existing app. Maintaining the current structure and abstract mockups allows us to ship the landing page immediately without blocking on external design or asset creation dependencies. This approach aligns with the Tracer Bullet build strategy, delivering a thin, functional end-to-end slice that we can iterate on later when real screenshots become available.

## Feature design

**Data model sketch**:
N/A - This is a static landing page.

**State transitions**:
N/A

**API surface**:
| Endpoint | Method | Key inputs | Key outputs | Auth | Key errors |
|---|---|---|---|---|---|
| N/A | N/A | N/A | N/A | public | N/A |

**Value sourcing**:
| Action | Value produced / displayed | Source |
|---|---|---|
| Deep-link to Ruff Cut | Ruff Cut URL | `NEXT_PUBLIC_ROUGH_CUT_APP_URL` env var |
| Deep-link to Wallet | Wallet URL | `NEXT_PUBLIC_WALLET_APP_URL` env var |

**Key invariants**:
- The page must be fully statically exportable (`output: 'export'`).

**Security model**:
- The landing page is public and unauthenticated. Access control is deferred to the linked apps.

**Configuration required**:
- `NEXT_PUBLIC_WALLET_APP_URL`: URL for the Wallet app
- `NEXT_PUBLIC_ROUGH_CUT_APP_URL`: URL for the Ruff Cut app

**Critical test scenarios**:
- Happy path: Navigate the site and click CTAs, verifies **AC-1**, **AC-2**
- Failure case: Navigate to an unknown route, verifies **AC-4**

## Build plan

Since this is an assumed spec ratification, the build has already been completed in `/develop`. No further build tasks are required.
1. Scaffold Next.js 16 app and configure output export, satisfies **AC-3**
2. Integrate packages/ui and implement page sections, satisfies **AC-1**
3. Wire up CTA deep-links and custom 404 page, satisfies **AC-2**, **AC-4**

## Consequences

**Positive**:
- The landing page is aligned with the rest of the SUBI suite brand.
- The feature is unblocked and ready for final verification.

**Negative / tradeoffs**:
- Placeholder UI mockups are used instead of real product screenshots, which may impact initial marketing effectiveness.

**Neutral**:
- None.

## Follow-up

- [ ] Replace abstract UI mockups with actual Ruff Cut screenshots once the product matures.
