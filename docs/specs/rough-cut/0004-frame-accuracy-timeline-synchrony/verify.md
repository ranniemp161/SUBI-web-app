# Verify: Frame Accuracy and Timeline Synchrony · spec 0004 · updated 2026-07-24
_Steps derived from spec 0004 acceptance criteria. `/check verify` runs these; `/test` locks the durable ones._

## Commands
- [x] `npm -w @repo/rough-cut exec -- vitest run src/lib/frame-math.test.ts` → all pass (frame boundary, mid-frame rounding, round trip within one frame at every standard rate) → AC-1, AC-4
- [x] `npm -w @repo/rough-cut exec -- vitest run src/lib/export/` → full existing export suite still passes unchanged after `toFrames` delegates to `frame-math` → AC-2
- [x] `npm -w @repo/rough-cut exec -- vitest run src/components/video-player.test.tsx` → step forward/back, clamp at 0, rVFC-confirmed path, step-through-a-cut all pass → AC-11, AC-12, AC-13, AC-15
- [x] `npm -w @repo/rough-cut run typecheck` and `npm -w @repo/rough-cut run lint` → clean (no persisted/DB change; ms stays the stored unit) → AC-3
- [x] Search: no export code path reads `DEFAULT_FPS` as a live fallback (`grep -n "DEFAULT_FPS" "src/app/(app)/dashboard/[id]/page.tsx"` shows only comments) → AC-7

## UI / manual (real browser — Chrome/Edge, WebCodecs available)
- [ ] Open a returning project, do NOT reselect the source video yet → the Export button's timeline formats are blocked; open Export, pick Final Cut Pro / DaVinci Resolve / Premiere Pro → a visible "Reselect your source video…" message shows and Export Now is disabled → AC-5, AC-6
- [ ] Reselect the source video → the reselect message disappears with no reload, and a timeline export (e.g. FCPXML) downloads a file → AC-5, AC-6
- [ ] Export the same cut as FCPXML and as MP4 on a non-30fps source (e.g. a 29.97 or 24fps clip) → the cut boundaries line up frame-for-frame between the two (one shared rounding rule) → AC-2, AC-1
- [ ] After reselect, at several zoom levels and scroll positions, the waveform peaks and filmstrip thumbnails line up with the clips and the playhead → AC-8, AC-10
- [ ] Before reselecting a source, the two frame-step buttons (either side of Play) are disabled with a "reselect" tooltip; the `,` / `.` keys do nothing → AC-14
- [ ] After reselect, press `.` repeatedly → the playhead advances exactly one frame each press at the source rate (watch the time readout / a frame-numbered test clip); press `,` → steps back one frame; the buttons do the same → AC-11, AC-12
- [ ] Frame-step forward across a cut boundary → the playhead steps INTO the cut range frame by frame, it does not jump over the cut to the next kept clip → AC-13
- [ ] Play the project with cuts end to end → playback still skips cut ranges and the timing feels unchanged from before this change → AC-16
- [ ] (If available) on a browser without `requestVideoFrameCallback` → frame stepping still moves one frame per press with no error, just without the exact-frame confirmation → AC-15

## Acceptance-criteria coverage
- AC-1 … frame-math.test.ts + cross-format export match · AC-2 … export suite unchanged + FCPXML/MP4 match · AC-3 … typecheck/lint, no DB change · AC-4 … frame-math.test.ts round trip
- AC-5, AC-6 … export blocked + reselect message, then enabled · AC-7 … no DEFAULT_FPS live fallback
- AC-8, AC-10 … waveform/filmstrip alignment at zoom/scroll · AC-9 … `positioningDuration` always uses the shared duration + dev warning (covered by construction; visible in the alignment check)
- AC-11, AC-12 … step buttons + `,`/`.` move one frame · AC-13 … step through a cut · AC-14 … disabled until reselect · AC-15 … rVFC fallback · AC-16 … playback + cut skip unchanged
