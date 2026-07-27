# Verify: Transcript and Timeline Live Sync · spec 0002 · updated 2026-07-21

_Steps derived from spec 0002 acceptance criteria. `/check verify` runs these; `/test` locks the durable ones._

## UI / manual

- [ ] In the Rough Cut studio, click a transcript word → playback seeks and the timeline playhead jumps to that word's start time → AC-1
- [ ] Click/scrub the timeline → playback seeks and the transcript's active word highlight updates → AC-2
- [ ] Drag-select three consecutive words in the transcript → the matching time range highlights on the timeline (video + audio tracks) → AC-3
- [ ] Select a kept clip on the timeline → the matching words highlight in the transcript; trim a clip boundary → the highlight updates live as the drag moves → AC-4
- [ ] Hover a transcript word (no click) → a lightweight marker appears at that time on the timeline; playback position and video frame do not change → AC-5
- [ ] Hover a position on the timeline (no click) → the matching transcript word gets a lightweight preview highlight; playback does not move → AC-6
- [ ] Start playback, then hover a different timeline position while it plays → the transcript keeps auto-scrolling with the real playhead, and the hover marker shows without pausing or seeking → AC-7
- [ ] Drag-select words in the transcript, then press Play (button, then repeat with Spacebar, then repeat by seeking while paused and resuming) → the selection highlight clears the moment playback starts → AC-8
- [ ] Cut a word, restore it, then cut an adjacent word — repeat a few times — confirm the playhead, the active-word highlight, and the cut boundary on the timeline all agree at the millisecond (no visible seam or gap) → AC-9
- [ ] Compare the playhead's color/style, the active-word highlight, a hover preview, and a selection highlight side by side between the transcript panel and the timeline bar → each concept reads as the same color family in both panels → AC-10
- [ ] Cut a word and restore it → both panels update instantly (no lag); watch the save indicator go "saving" → "saved" within ~800ms of the last edit, and confirm a burst of rapid edits still saves within the 5s ceiling → AC-11

## Value sourcing coverage

- [ ] Hover a transcript word → confirm the timeline marker lands exactly at that word's own `start` time (not a rounded/nearby time) → Value sourcing row 1
- [ ] Hover a timeline position that falls inside a silence gap (between words) → confirm no transcript word is highlighted (findActiveWordIndex returns no match) → Value sourcing row 2
- [ ] Drag-select in the transcript starting mid-word and ending mid-word → confirm the published range is exactly [first selected word's start, last selected word's end] → Value sourcing row 3
- [ ] Trim a clip boundary in the timeline into a silence gap with no words → confirm the transcript shows no cross-highlight (no word falls in the range) → Value sourcing row 4
- [ ] With a selection active, press Play → confirm the selection clears exactly on the player's own `playing` event, not on a delayed timer → Value sourcing row 5

## Commands

- [x] `npm -w @repo/rough-cut typecheck` → passes clean → all
- [x] `npm -w @repo/rough-cut test` → all existing tests pass, especially `edl.test.ts` (AC-9), `edl-autosave.test.ts` (AC-11), `transcript-panel.test.tsx`, `timeline-bar.test.tsx` → AC-9, AC-11
- [x] `npm -w @repo/rough-cut run lint` → passes clean → all

## Acceptance-criteria coverage

- AC-1 … covered by the transcript-click UI step (pre-existing, regression only)
- AC-2 … covered by the timeline-scrub UI step (pre-existing, regression only)
- AC-3 … covered by the transcript drag-select UI step + value-sourcing row 3
- AC-4 … covered by the timeline select/trim UI step + value-sourcing row 4
- AC-5 … covered by the transcript-hover UI step + value-sourcing row 1
- AC-6 … covered by the timeline-hover UI step + value-sourcing row 2
- AC-7 … covered by the hover-during-playback UI step
- AC-8 … covered by the selection-clears-on-play UI step + value-sourcing row 5
- AC-9 … covered by the repeated cut/restore boundary-drift UI step + the `edl.test.ts` command
- AC-10 … covered by the color-comparison UI step
- AC-11 … covered by the instant-propagation/autosave-timing UI step + the `edl-autosave.test.ts` command
