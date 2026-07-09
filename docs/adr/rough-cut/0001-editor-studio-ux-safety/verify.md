# Verify: Editor Studio UX Safety · ADR 0001 · updated 2026-07-09

_Steps derived from ADR 0001 acceptance criteria. `/verify` runs these; `/test` locks the durable ones. AC numbers are per child ADR._

## Child 1 — Exit navigation toast

### UI / manual
- [ ] Open a ready project in the editor, click the **Dashboard** link in the top bar → a "Project saved" toast shows on the dashboard, navigation is not blocked or delayed → AC-2, AC-4
- [ ] Open a project in a status-screen state (for example one still transcribing), click **Back to dashboard** → same toast, same non-blocking navigation → AC-1, AC-4
- [ ] Read the toast → it says both that edits are stored automatically and that reopening needs the same source video reselected → AC-3

## Child 2 — AI Cut re-run guard + Clear action

### Commands
- [ ] With a project whose AI Cut has already run, send a direct `POST /api/projects/<id>/ai-cut` (bypassing the UI, with a valid session) → response is 409 with `code: "AI_CUT_ALREADY_RUN"`, and the credit balance is unchanged (no charge, no Gemini run) → AC-1
- [ ] `DELETE /api/projects/<id>/ai-cut` on that project → 200, `aiCuts` is emptied, balance unchanged (no refund); a following POST runs and charges normally → AC-3
- [ ] Send the DELETE without a session, and against a project owned by another user → 401 and 404 respectively → AC-4

### UI / manual
- [ ] On a fresh project (no AI cuts), run AI Cut from the rail → it runs and charges exactly as before → AC-2
- [ ] With AI cuts present, click AI Cut in the rail → the "AI Cut has already run" toast shows (not a generic failure), offering a Clear action → AC-6
- [ ] Click **Clear AI cuts** in the status bar → a confirm toast appears; pressing Cancel or dismissing does nothing; pressing **Clear** fires the DELETE and shows the cleared confirmation → AC-5

## Child 3 — Video reselect verification

### UI / manual
- [ ] Reopen a project and reselect the correct source video → it loads normally → AC-3
- [ ] Reopen and pick a clearly different video (different length) → it is blocked with the "does not match this project" message, the video does not load, and picking another file immediately works (input was reset) → AC-1, AC-2
- [ ] Create a brand-new project (initial upload path) → any valid video is accepted with no duration comparison; non-video files still rejected and the 20 GB warning still shows → AC-4, AC-5

## Child 4 — Transcript frame accuracy

### Commands
- [ ] Transcribe a new video, then inspect the stored transcript words (DB or the project API response) → every `start`/`end` is a multiple of 1/30s (value × 30 is an integer within float noise) → AC-2
- [ ] Check the Deepgram request (log or network capture on transcribe) → query includes `utterances=true` and does not include `diarize` or `paragraphs` → AC-1
- [ ] Run `normalizeDeepgram` twice over the same payload (or over its own output values) → identical results, snap is idempotent → AC-4
- [ ] Confirm the transcript still renders and seeks in the editor (normalizer still reads `results.channels[0].alternatives[0].words`) → AC-5, AC-3

## Acceptance-criteria coverage
- Child 1: AC-1..AC-4 all covered above.
- Child 2: AC-1..AC-6 all covered above.
- Child 3: AC-1..AC-5 all covered above.
- Child 4: AC-1..AC-5 all covered above.
