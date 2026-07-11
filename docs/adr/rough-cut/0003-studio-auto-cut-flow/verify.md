# Verify: Studio auto-cut flow · ADR 0003 · updated 2026-07-11
_Steps derived from ADR 0003 acceptance criteria. `/verify` runs these; `/test` locks the durable ones. Run signed in, against a project whose transcript is `ready`. "Studio" = `/dashboard/[id]`._

## UI / manual
- [ ] On the dashboard, select a video → a confirm panel appears showing Transcription price, AI polish price, an "Estimated total", and an AI-polish toggle defaulted ON → AC-1
- [ ] Toggle AI polish OFF in the panel → the AI-polish line and its cost disappear from the total; toggle ON → they return → AC-1
- [ ] Cancel the panel (Cancel / Escape / backdrop) → no project is created and no charge is made → AC-1
- [ ] Upload with polish ON, confirm, wait for transcript ready, open the studio → the mechanical cut applies with no click, then the AI pass runs under the same loader (`AiCutOverlay`), landing on the polished result → AC-2, AC-3
- [ ] Upload with polish OFF, open the studio when ready → only the mechanical cut applies, no AI loader, no AI call → AC-2
- [ ] After the automatic AI pass, reload the studio → it does NOT auto-fire a second AI attempt (mechanical result already saved; one run exists) → AC-4
- [ ] Manually restore one AI-cut segment → "Restore AI suggestions" appears in the transcript summary card; press it → the segment is cut again and the button disappears, with no network request and no charge → AC-7
- [ ] With a run present and no manual divergence → neither "Polish with AI" nor "Restore AI suggestions" is shown → AC-6, AC-7
- [ ] On a project with zero runs → the transcript card shows "Polish with AI"; after a successful run it is gone permanently (even after reload) → AC-6
- [ ] Tool rail shows no "AI Cut" icon; status bar shows no run-list (switch/rename/delete), sensitivity picker + "Re-run rough cut" remain; the old floating "Create your rough cut" hero is gone → AC-6, AC-9
- [ ] Click a Dashboard link in the studio (TopBar or a StatusScreen) → a blocking "Leave the editor?" dialog opens (Leave / Keep editing); "Keep editing" stays; "Leave" navigates to the dashboard → AC-8
- [ ] While the AI pass is actively running, attempt to close the tab → the native browser "leave site?" warning fires; during ordinary editing it does not → AC-8
- [ ] Force the AI pass to fail (or hit 402 with $0 balance) on an automatic attempt → you land on the mechanical result with a clear message (402 shows an add-funds deep link to the wallet), the charge is refunded, and a manual "Polish with AI" button appears → AC-5
- [ ] Open a legacy/pre-existing project (created before this shipped, or one with saved manual edits) → nothing auto-fires; it opens exactly as before → AC-4, AC-10

## Commands
- [ ] `cd packages/db && npm run db:verify` → live schema matches Drizzle (confirms `projects.ai_polish_requested` is live) → AC-1, AC-4, AC-10
- [ ] `npm run test -w @repo/rough-cut` → all pass (auto-chain AC-2/AC-3/AC-4, removed-surfaces AC-6, exit dialog AC-8, validation AC-1) → AC-1..AC-8
- [ ] `npm run test -w @repo/ui` → all pass (money + ConfirmDialog exercised via studio page tests) → AC-8
- [ ] `npm run typecheck -w @repo/rough-cut && npm run lint -w @repo/rough-cut` → clean → all ACs
- [ ] `NEXT_PUBLIC_WALLET_URL=… NEXT_PUBLIC_WALLET_DASHBOARD_URL=… npm run build -w @repo/rough-cut` → compiles (ConfirmDialog client-boundary re-export is clean) → AC-8
- [ ] DB integration (no unit coverage): after any AI Cut claim, confirm `SELECT ai_polish_requested FROM projects WHERE id=…` is `false` — the flip is raw SQL in `claimAiCutSlot`, not unit-tested → AC-3, AC-4

## Acceptance-criteria coverage
- AC-1 (upload toggle + combined price + persisted flag) · confirm panel + `createProjectSchema.aiPolish` (validation.test.ts) + POST insert
- AC-2 (auto mechanical cut, no click, one loader) · auto-chain effect (page.test.tsx AC-2)
- AC-3 (auto AI pass chains after mechanical, same billing) · runAiCut(sourceEdl) + auto-chain (page.test.tsx AC-3)
- AC-4 (exactly one auto AI attempt; flip; legacy inert) · claimAiCutSlot flip + conjunctive auto-fire condition (page.test.tsx AC-4)
- AC-5 (AI failure / 402 lands on mechanical, refund, manual button) · reuses runAiCut's existing 402/refund branches; manual verify
- AC-6 (single conditional Polish button; run-list/always-on button removed) · transcript-panel.test.tsx + page.test.tsx removed-surfaces
- AC-7 (free client-side Restore) · divergence memo + restoreAiSuggestions (transcript-panel.test.tsx)
- AC-8 (blocking exit dialog; beforeunload only while AI runs) · ConfirmDialog + ExitToDashboardLink + aiBusy beforeunload (page.test.tsx exit-dialog)
- AC-9 (sensitivity picker in status bar; hero removed) · RoughCutHero deleted, status-bar picker retained · manual
- AC-10 (all safety preserved; legacy untouched) · claim/idempotency/refund reused unchanged; legacy-inert test (page.test.tsx AC-4)
