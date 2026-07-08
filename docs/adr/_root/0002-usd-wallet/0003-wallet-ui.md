# 0002/0003: Premium wallet UI and rough-cut prompts

Child of [0002 USD-denominated Wallet](./index.md). Depends on children `0001` (money data) and `0002` (auto-recharge settings). Read the umbrella first.

## Context

The current wallet dashboard is a basic scaffold: a plain "Available Tokens 2045" card, a stack of buy buttons, and a bare table. The client wants the wallet to feel premium and intuitive, in the spirit of the OpenAI billing screen (a calm money balance, clear "add funds", an auto-recharge settings panel, a clean history), and consistent with the ecosystem theme. There is no `design.md` and no Figma yet, so this child defines the direction to build, on the shared `@repo/ui` tokens.

## Decision

### 1. Build on the shared theme, no new design system

Use the existing `@repo/ui` tokens (`--background`, `--foreground`, geist fonts, the blue focus-visible ring, light and dark via `prefers-color-scheme` and the `data-theme` override). Premium comes from layout, spacing, hierarchy, and restraint, not a new palette. App-specific accents (surface shades, subtle elevation) stay in the wallet's own `globals.css`, per the `packages/ui` convention. No component library is introduced (0001 decision 6 defers that); the few pieces here are local wallet components.

### 2. Wallet billing layout

A single focused billing view (the OpenAI "Overview" analogue), top to bottom:

- **Balance hero.** Large `formatUsd(balance_micros)` as the focal element, a quiet label ("Available balance"), and a one-line status ("about N minutes of transcription" derived from the retail rate, and an auto-recharge state chip: on at $X, or off).
- **Add funds.** The three bundles as clean cards showing what you pay and the balance you get (surfacing the bonus on the larger tiers, for example "$79 → $95.00 balance"), with the primary buy action.
- **Auto-recharge panel.** A card mirroring the OpenAI pattern: an on/off switch, "when balance falls below $[threshold]", "automatically add $[amount]", the saved card (brand + last4), and an "add/replace card" action. Disabled controls with a clear prompt when no card is saved. Reflects the child `0002` settings and validation (amount must exceed threshold).
- **Low-balance banner.** When the balance is below the threshold (or auto-recharge is off and the balance is low), a calm inline banner offering "add funds" or "turn on auto-recharge", not an alarming modal.
- **History.** The ledger as a refined table: date, description (humanised reason including `purchase`, `auto_recharge`, `transcription`, `ai_cut`, `refund`, `conversion`, `grant`), and a signed `formatUsd(delta_micros)` amount, deposits and charges visually distinct, with an empty state.

States to design for every panel: loading, empty, error, and the no-card and mid-recharge states.

### 3. rough-cut: minimal, on-theme "add funds" prompt

rough-cut stays minimal (per scope). When a spend returns `insufficient` (the child `0001` gate), show an on-theme prompt: a short message that the balance is out, and a primary button deep-linking to the wallet billing view (via the validated cross-app URL in `src/lib/env.ts`, never a raw env read). Optionally show the current `formatUsd(balance_micros)` near the transcribe/AI-Cut actions so the user sees it running low before they hit the wall. No bundle or auto-recharge UI in rough-cut; buying always happens in the wallet.

### Implementation skills

None new. Uses `@repo/ui` tokens and the app's existing Tailwind v4 setup. The `formatUsd` helper comes from child `0001`.

## Options considered

- **Propose a brand-new premium theme/palette.** Rejected: the goal is consistency with the ecosystem, and a shared theme already exists; a new palette would fork the design system the wallet is supposed to match.
- **Introduce a component library (shadcn or similar) now.** Rejected: 0001 defers a shared component library until a second app needs a shared primitive; the handful of wallet pieces here do not justify it (YAGNI).
- **Full premium billing UI inside rough-cut too.** Rejected by the chosen scope: rough-cut gets only the deep-linking prompt so the premium build stays focused on the wallet, which is the billing home.

## Rationale

Premium here is achieved with hierarchy and restraint on the tokens both apps already share, so the wallet looks first-class without forking the design system or building speculative components. Keeping buying and auto-recharge entirely in the wallet, and giving rough-cut only a deep-linking prompt, matches both the single-billing-authority rule and the chosen UI scope, and keeps the change focused.

## Build plan

1. [x] **Balance hero + status (AC-1, AC-9).** Build the hero using `formatUsd`, the derived-minutes line, and the auto-recharge state chip.
2. [x] **Add-funds cards (AC-2, AC-9).** Bundle cards showing pay-vs-get with the bonus surfaced, wired to the existing checkout button.
3. [x] **Auto-recharge panel (AC-5, AC-9).** The settings card (switch, threshold, amount, saved card, add/replace), wired to child `0002`'s settings API with its validation and no-card disabled state. **Fix (2026-07-08):** "add/replace card" now actually completes — see child `0002` build plan task 2 for the Stripe Elements form that was missing.
4. [x] **Low-balance banner (AC-4, AC-9).** The calm inline banner with add-funds / enable-auto-recharge actions.
5. [x] **History table (AC-9).** Refined ledger table with humanised reasons (including `auto_recharge` and `conversion`), signed `formatUsd`, and an empty state.
6. [x] **rough-cut prompt (AC-4, AC-9).** Already complete from slices 1+2: `CreditsPanel` header chip shows `$X.XX` balance, goes amber when low, "Add funds" deep-links to wallet; 402 toast includes "Add funds" action.
7. [x] **Light/dark + a11y pass (AC-9).** All components use wallet theme tokens that respect `prefers-color-scheme`. Keyboard focus-visible ring from `theme.css`. Semantic HTML, heading hierarchy, `aria-label` on icon-only buttons, tabular nums for money.

## References

- `apps/wallet/src/app/dashboard/page.tsx` (current scaffold to replace), `apps/wallet/src/app/dashboard/checkout-button.tsx`.
- `packages/ui/src/styles/theme.css` (tokens), `apps/wallet/src/lib/env.ts` and `apps/rough-cut/src/lib/env.ts` (cross-app URLs).
