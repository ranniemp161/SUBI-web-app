# 0001. Founder's Frame Landing Page

**Date**: 2026-07-17
**Status**: Proposed

## Summary

This spec outlines the design and architecture for the new Founder's Frame landing page, built as a standalone static website within our Turborepo. It will serve as the central gateway to introduce our products (MyFirstCutApp, Thumbnail, Infographics) with a focus on high-converting copywriting. We will use Next.js 16 (Static Export) and deploy on Vercel to reuse our existing `packages/ui` design system and maintain brand consistency without adding architectural overhead.

## Context

We need a central website to explain our product offerings under the "Founder's Frame" brand. While the wallet app acts as the gateway for monetary transactions, this new landing page must act as the primary marketing and sales hub. The main challenges are ensuring it is highly converting, looks consistent with our existing apps by reusing our UI tokens, and remains lightweight as a static site without requiring its own backend or authentication logic.

## Requirements

**User stories**:
- As a visitor, I want to understand what Founder's Frame is so that I can decide if its products are useful for me.
- As a prospective customer, I want to easily navigate to MyFirstCutApp or the Wallet app so that I can sign up and start using the products.

**Acceptance criteria**:
- **AC-1**: The landing page correctly loads all sections (Hero, Product Showcase, Features/Benefits, Footer) and renders consistently with the `packages/ui` design system.
- **AC-2**: The primary Call to Action (CTA) deep-links directly to MyFirstCutApp (or Wallet) for sign-ups.
- **AC-3**: The site is statically exported and deployable to Vercel with no server-side rendering or API routes.
- **AC-4**: A custom 404 page is implemented that redirects or links visitors back to the main Hero section.

## Options considered

### Option 1: Next.js 16 (Static Export)

Build a new Next.js 16 app in the monorepo (`apps/founders-frame`), configured with `output: 'export'` for purely static HTML generation.

**Pros**:
- Seamlessly reuses existing React components and design tokens from `packages/ui`.
- Integrates perfectly with the current Turborepo and Vercel hosting setup.

**Cons**:
- Slightly heavier bundle size compared to vanilla HTML/JS, though minimal for a static export.

### Option 2: Vite + React (Static SPA)

Build a lightweight React Single Page Application using Vite.

**Pros**:
- Very fast build times and a lighter weight setup than Next.js.

**Cons**:
- Harder to share Next.js-specific UI components (like `next/link` or `next/image` wrappers) that might exist in `packages/ui`.

### Option 3: Vanilla HTML/CSS/JS

Write the static site by hand without a framework.

**Pros**:
- Maximum performance and zero JavaScript overhead.

**Cons**:
- Cannot reuse any of our existing React UI components, breaking visual consistency and slowing down development.

## Decision

**Chosen option**: Option 1: Next.js 16 (Static Export)

We will use Next.js 16 with static export to build the Founder's Frame landing page, hosting it on Vercel alongside the rest of our Turborepo apps.

## Rationale

Reusing our existing `packages/ui` is critical to maintaining exact visual consistency between the marketing site and our actual products. Option 1 allows us to leverage our current Turborepo tooling, Next.js knowledge, and component library without any friction. Because we will use `output: 'export'`, we avoid the cost and complexity of a Node.js server while still getting the developer experience of Next.js.

## Feature design

**Data model sketch**:
Static content only. No database entities or schema required.

**API surface**:
| Endpoint | Method | Key inputs | Key outputs | Auth | Key errors |
|---|---|---|---|---|---|
| None | N/A | purely static site | N/A | public | 404 Not Found |

**Value sourcing**:
| Action | Value produced / displayed | Source |
|---|---|---|
| Page Load | Marketing Copy & Assets | Hardcoded in React components (or static CMS files if added later) |
| CTA Click | Destination URL | Hardcoded deep-link to MyFirstCutApp / Wallet URL (read from `env.ts` config) |

**Key invariants**:
- The site must never require a server runtime (no API routes, no SSR).
- The site must be completely public (no authentication required to view any page).

**Security model**:
Publicly accessible marketing site. No sensitive data, no user sessions, and no database connections.

**Configuration required**:
- `NEXT_PUBLIC_WALLET_APP_URL`: URL to the Wallet app for the CTA deep-link.
- `NEXT_PUBLIC_ROUGH_CUT_APP_URL`: URL to the Rough Cut app for the CTA deep-link.

**Critical test scenarios**:
- Happy path: A visitor navigates to the page, sees the Hero section and Founder's Frame logo, and clicks the CTA which correctly links to the product app, verifies **AC-1**, **AC-2**.
- Failure case: A visitor navigates to a non-existent route (`/unknown`) and sees the custom 404 page directing them back to the Hero section, verifies **AC-4**.
- Auth/permission: N/A, the site is entirely public.

## Build plan

1. Scaffold a new Next.js 16 app at `apps/founders-frame` configured for `output: 'export'` and add it to the Turborepo workspace, satisfies **AC-3**.
2. Integrate `packages/ui` and configure Tailwind/CSS to match the existing apps, satisfies **AC-1**.
3. Implement the page sections (Hero, Product Showcase, Features, Footer) using existing design tokens and assets, satisfies **AC-1**.
4. Wire up the CTA buttons to deep-link to the product apps using environment variables, satisfies **AC-2**.
5. Create a custom `not-found.tsx` page to handle 404s gracefully, satisfies **AC-4**.

## Consequences

**Positive**:
- Consistent brand experience across marketing and product surfaces.
- Very fast page loads and cheap hosting due to static export.
- Rapid development by reusing existing UI components.

**Negative / tradeoffs**:
- Content updates require a code deployment (unless a static CMS is integrated later).

**Neutral**:
- We are adding another application to the Turborepo, which slightly increases turbo build times.

## Follow-up

- [ ] Provide the specific copywriting text for the Hero and Features sections prior to implementation.
- [ ] Determine the exact asset paths for the Founder's Frame logo and product screenshots.
