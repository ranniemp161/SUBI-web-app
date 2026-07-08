# Verify: USD-denominated Wallet (wallet-ui) · ADR 0002/0003 · updated 2026-07-08

_Steps derived from ADR 0002 acceptance criteria (AC-1, AC-2, AC-4, AC-5, AC-9). `/verify` runs these; `/test` locks the durable ones._

## UI / manual

- [ ] Visit `/dashboard` (wallet, port 3001) → balance hero shows `$X.XX` with "Available balance" label → AC-1
- [ ] Hero shows "About N minutes of transcription" derived from the balance → AC-1
- [ ] Auto-recharge chip in hero shows "Auto-recharge on below $X" (when enabled) or "Auto-recharge off" → AC-5/AC-9
- [ ] Low-balance banner appears when balance is below ~5 min and auto-recharge is off → AC-4/AC-9
- [ ] Low-balance banner shows "Add funds" and "Auto-recharge" action links that scroll to the correct sections → AC-4
- [ ] Bundle cards show three tiers with pay amount and credited balance (e.g. "Pay $79 — Get $95.00 balance") → AC-2/AC-9
- [ ] Larger bundle tiers show a green "+$X.XX bonus" badge → AC-2
- [ ] Clicking "Buy now" on a bundle card redirects to Stripe Checkout → AC-2
- [ ] Auto-recharge panel shows toggle, threshold/amount inputs, and saved card (brand + last4) → AC-5/AC-9
- [ ] Toggle and inputs are disabled with "Add a card" prompt when no card is saved → AC-5
- [ ] "Save settings" persists threshold/amount via the API → AC-5
- [ ] Transaction history table shows humanised reasons (e.g. "Credit purchase", "Auto-recharge", "Transcription") → AC-9
- [ ] Deposits show in green with a "+" prefix; charges show in neutral colour → AC-9
- [ ] Empty transaction table shows a friendly "No transactions yet" state → AC-9
- [ ] All sections render correctly in dark mode (toggle system preference) → AC-9
- [ ] Keyboard navigation: Tab through all interactive elements; focus-visible ring appears → AC-9
- [ ] rough-cut credits panel (header chip) shows `$X.XX`, turns amber when low, "Add funds" links to wallet → AC-4/AC-9
- [ ] rough-cut 402 toast (on insufficient credits) includes "Add funds" action linking to wallet → AC-4

## Commands

- [ ] `npm run typecheck` → both apps pass → AC-9
- [ ] `npx turbo run test --filter=wallet` → @repo/ui money tests pass → AC-9

## Acceptance-criteria coverage

- AC-1: Balance displayed as `$X.XX` — covered by hero steps
- AC-2: Bundle cards show pay-vs-get with bonus — covered by bundle card steps
- AC-4: Low-balance banner + rough-cut prompts — covered by banner + rough-cut steps
- AC-5: Auto-recharge panel settings and card — covered by panel steps
- AC-9: Premium redesign, light/dark, a11y, rough-cut prompt — covered by all UI steps
