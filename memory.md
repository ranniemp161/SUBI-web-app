# Memory — Hybrid AI rough cut (Gemini semantic pass + rule-based repetition)

Last updated: 2026-07-04 (evening)

## What was built

All committed and pushed — `main` = `b7280aa`, CI green, 152/152 tests.

### Semantic layer (Gemini 2.5 Flash, server-side only)
- `src/lib/ai-rough-cut.ts`: transcript → Gemini as indexed words (`[i]word`),
  structured JSON back as inclusive word-index ranges (never timestamps — LLMs
  hallucinate those). Rubric ships as `systemInstruction`, calibrated on the
  user's real footage (see Decisions). `thinkingBudget: 24576` (flash's max),
  240s timeout, 50k-word size guard. Plain fetch, no SDK. Key read from
  `GEMINI_API_KEY` env (already in `.env.local`; never commit/print it).
- `src/lib/ai-cuts.ts`: pure shared half — `sanitizeAiRanges` (clamp/drop/
  coalesce untrusted model output), `applyAiCuts` (reason `"ai"`, re-asserts
  `protectedKeeps` after so user restores always win), `buildInitialEDLWithAi`
  (same 10% keep-floor; drops only the AI layer if tripped).
- Auto pass in `src/app/api/transcribe/callback/route.ts` AFTER the transcript
  is stored (second DB update, strictly soft-fail). On-demand re-run:
  `POST /api/projects/[id]/ai-cut` (Clerk auth, 10/user/hour rate limit).
- `projects.ai_cuts` jsonb column — applied to dev Neon via `db:push`;
  `drizzle/manual/0002_projects_ai_cuts.sql` for prod later.
- Studio: "AI Cut" rail button (Wand2, badge = live AI-cut count, toast flow),
  sky-blue `"ai"` cuts on timeline + transcript, sensitivity re-runs re-apply
  stored aiCuts on top of regenerated heuristics.

### Deterministic layer (every build/re-run, zero tokens)
- `src/lib/repetition-detection.ts`: word stutters ("the the") keep the LAST
  instance — guards: trailing punctuation = deliberate emphasis ("very, very"),
  all-capitalized pair = proper noun ("Duran Duran"), "I I" still cut; adjacent
  2–8-word phrase repeats cut ONLY when ≥0.35s pause separates instances
  (`PHRASE_PAUSE_SECONDS`) — fluid repeats are delivery, left to AI/user.
- Wired into `buildAutoLayer` (edl.ts) between silence and retake passes
  (retake re-labels overlaps). New EDL reason `"repetition"` (edl.ts +
  validation.ts enums), teal styling in timeline-bar + transcript-panel.

## Decisions made

- **Hybrid split is deliberate**: rules catch exact duplicates free on every
  re-run; AI (once per transcript + button) handles semantic judgment.
- **User's confirmed editorial rulings** (baked into the prompt): keep the
  LAST complete take; spoken production notes ("insert clip No. 3", "start
  again", off-camera asides) = new AI category `direction`, cut from playback
  but visible in transcript as B-roll markers; deliberate rhetorical
  repetition KEPT when it completes cleanly; punchline re-reads keep final.
- **Thinking budget from measurement, not guess**: 0 tokens = 28s but shallow
  (162 fragmented cuts, user rejected); dynamic ≈19k tokens = 87s, 71 quality
  cuts. Capped at 24576 = full quality with hard latency ceiling. Routes have
  `maxDuration = 300` (Vercel's cap).
- AI Cut on an already-AI-cut project: run AI Cut, then "Re-run rough cut"
  sweeps stale `"ai"` cuts (they're not manual, so re-run drops them) and
  re-applies the latest stored aiCuts.

## Problems solved

- **502 on AI Cut** = Gemini's default *dynamic* thinking outliving the 60s
  timeout on real transcripts (tiny probes pass, real ones don't). Any future
  "AI pass failed" report: check elapsed vs timeout first.
- Next.js only reads `.env.local` at server start — new env vars need a dev
  server restart (that was the first AI Cut failure, 503).
- PowerShell 5.1 mangles quotes in `git commit -m @'…'@` with inner double
  quotes — write the message to a file and use `git commit -F`.
- Probe scripts in scratchpad need `createRequire(<project package.json>)` to
  resolve the project's node_modules; `--experimental-strip-types` runs the
  TS lib directly (type-only imports are erased).

## Current state

- Feature complete and shipped; typecheck + 152 tests + CI green on `b7280aa`.
- Prompt template A/B'd on real JZ transcript: 9/9 spoken directions caught
  (old prompt ~2/9 and it cut the "March and March" movement name); rule pass
  adds 19 cuts incl. the triple "booby prize" re-read both AI runs missed.
- Ground-truth manual edit doc: `H:\My Drive\Download\JZ Raw footage\JZ Raw
  footage — edit analysis.md` (also indexed in auto-memory).
- User has NOT yet reviewed a full AI+hybrid cut end-to-end in the studio.
- Pre-existing ESLint errors (3) confirmed present on committed tree before
  this work — not ours, CI doesn't run lint.

## Next session starts with

1. User reviews a full hybrid cut in the studio (JZ or 0615 project: AI Cut →
   Re-run rough cut). Tune from real misjudgments — prompt rules for semantic
   misses, `PHRASE_PAUSE_SECONDS` if the pause gate mis-fires.
2. Then the standing production list: access-code rotation fix (architecture
   still undecided: accessGranted flag vs per-invite codes) → Vercel deploy
   (add `GEMINI_API_KEY` to Vercel env; run `drizzle/manual/0002` on prod DB;
   callback-mode e2e on public host) → 4K/HEVC export verification.

## Open questions

- Is the old fuzzy retake matcher (`retake-detection.ts`) still earning its
  place now the AI handles reworded retakes better? Candidate for demotion.
- Studio UI/UX overhaul from last session (filmstrip, paragraphs, pills) still
  awaiting the user's visual pass with a real video.
- Older backlog: access-code architecture, orphaned "ruffcut" Blob store,
  R2-vs-Blob client conversation, prod Neon migration, Vercel passkey issue.
