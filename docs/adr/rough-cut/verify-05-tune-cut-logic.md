# Verify: Tune cut logic against utterance boundaries · updated 2026-07-09
_Steps derived from roadmap task 5. `/verify` runs these; `/test` locks the durable ones._

## Automated Tests
- [ ] `npm run test -w apps/rough-cut` → Verify all tests pass, including the new "falls back to pause heuristic" test case.

## Manual Verification
- [ ] Upload a test video with run-on speech and long pauses. → Run AI Cut or let manual cuts populate. → Confirm retake detection correctly identifies long pauses as boundaries, even within long Deepgram utterances.
