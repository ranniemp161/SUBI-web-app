# Verify: export to davinci premiere fcpxml · spec 0001 · updated 2026-07-12
_Steps derived from spec 0001 acceptance criteria. `/check verify` runs these; `/test` locks the durable ones._

## UI / manual
- [ ] Open a project with a saved EDL that has at least one kept segment and some cut segments → click "For DaVinci / Premiere" → a `.fcpxml` file downloads → AC-1
- [ ] Open the downloaded FCPXML in a text editor / import into DaVinci Resolve or Premiere Pro → the clips on the timeline match exactly the kept ranges shown in the studio, in the same order → AC-1
- [ ] Open a fresh project with no saved EDL yet (or force the EDL's kept duration to zero) → "For DaVinci / Premiere" is disabled → AC-2
- [ ] With the button disabled (or by calling the handler directly in devtools against a zero-kept-duration EDL) → a "Nothing to export" toast appears and no file downloads → AC-3
- [ ] Inspect the exported FCPXML's asset `name`/`src` → it matches the project's original uploaded filename → AC-4
- [ ] Compute a kept segment's duration in the FCPXML (`duration="<frames>/30s"`) → equals `round((end - start) * 30)` from the EDL segment → AC-5
- [ ] Construct (or edit) an EDL with a kept segment under 1/30s (e.g. 0.02s) → export → that segment does not appear as its own `<clip>` in the output → AC-6
- [ ] Rename a project to include unsafe filename characters (`/ \ : * ? " < > |`) → export → the downloaded filename has those characters stripped, not present raw → AC-7
- [ ] Visually compare the resolution dropdown and the new "For DaVinci / Premiere" button → both use the same rounded, bordered, token-styled control (no native browser `<select>` chrome) → AC-8

## Commands
- [ ] `npm -w @repo/rough-cut run typecheck` → passes → all ACs (no type errors introduced)
- [ ] `npx vitest run` (from `apps/rough-cut`) → all tests pass, including `src/lib/export/fcpxml.test.ts` → AC-1, AC-4, AC-5, AC-6, AC-7

## Acceptance-criteria coverage
- AC-1 (valid FCPXML, only kept segments, sequential, matches studio playback) — covered by the manual import step and `fcpxml.test.ts`'s "includes only kept segments as sequential clips" test.
- AC-2 (disabled when no EDL / zero kept duration) — covered by the manual disabled-state step; gating logic in `page.tsx`'s `fcpxmlBlockedReason`.
- AC-3 (pre-generation guard, never downloads empty/broken file) — covered by `handleExportFcpxml`'s early return (`!edl || keptDuration(edl) <= 0`), which shows a "Nothing to export" toast and returns before any XML is built or downloaded, even if the disabled button were somehow bypassed.
- AC-4 (references source by original filename) — covered by the manual asset-name inspection step and `fcpxml.test.ts`'s filename test.
- AC-5 (30fps timebase in/out points) — covered by the manual frame-math step and `fcpxml.test.ts`.
- AC-6 (sub-frame segment dropped) — covered by `fcpxml.test.ts`'s "drops a kept segment shorter than one frame" test.
- AC-7 (sanitized filename from project title) — covered by `fcpxml.test.ts`'s `sanitizeFilename` tests and the manual rename step.
- AC-8 (one consistent styled control, not native select) — covered by the manual visual comparison step; both controls share `dropdownTriggerClass` / matching button styling in `page.tsx`.

# Verify addendum: CMX 3600 EDL + format picker · updated 2026-07-12
_Steps for the tasks added in this update (spec tasks 5 to 9). The "For DaVinci / Premiere" control from the steps above is now a menu with two entries instead of a single-click button — re-check AC-8's visual comparison against the menu trigger, not a bare button._

## UI / manual
- [ ] Open a project with a saved EDL that has at least one kept segment → click "For DaVinci / Premiere" → a menu opens with "FCPXML (.fcpxml)" and "CMX 3600 EDL (.edl)" entries, styled like the resolution dropdown → AC-16
- [ ] Click "CMX 3600 EDL (.edl)" → an `.edl` text file downloads → open it → one event per kept segment, in order, with sequential 3-digit event numbers and record timecodes that run back to back with no gaps → AC-9
- [ ] Force the EDL's kept duration to zero → both "FCPXML (.fcpxml)" and "CMX 3600 EDL (.edl)" are disabled together → AC-10
- [ ] With the menu disabled (or calling `handleExportCmx3600` directly against a zero-kept-duration EDL) → a "Nothing to export" toast appears and no file downloads → AC-11
- [ ] Compute an event's source/record timecodes in the exported EDL (`HH:MM:SS:FF`) → equals `formatTimecode(start/end)` at 30fps, matching the same segment's frame count in the FCPXML export of the same EDL → AC-12
- [ ] Construct an EDL with a kept segment under 1/30s → export both formats → that segment appears in neither the FCPXML `<clip>` list nor the EDL's events → AC-13
- [ ] Inspect the exported EDL's reel field and `* FROM CLIP NAME:` comment → the comment matches the project's original uploaded filename; the reel is an 8-character, uppercased, sanitized version of it → AC-14
- [ ] Give a source filename that sanitizes to nothing (e.g. all punctuation) → export the EDL → the reel field falls back to `AX` rather than being empty → AC-14
- [ ] Rename a project to include unsafe filename characters → export the EDL → the downloaded `.edl` filename is sanitized the same way as the FCPXML filename → AC-15

## Commands
- [ ] `npm -w @repo/rough-cut run typecheck` → passes
- [ ] `npx vitest run` (from `apps/rough-cut`) → all tests pass, including `src/lib/export/cmx3600.test.ts` (event ordering, sub-frame drop, reel/filename reference, `AX` fallback, timecode correctness, and the FCPXML/CMX 3600 cross-format consistency test) → AC-9 through AC-16

## Acceptance-criteria coverage (addendum)
- AC-9 (valid CMX 3600 EDL, one event per kept segment, sequential, back-to-back record timecodes) — covered by the manual EDL-import step and `cmx3600.test.ts`'s "includes only kept segments as sequential, back-to-back events" test.
- AC-10 (disabled when no EDL / zero kept duration, both formats together) — covered by the manual disabled-state step; shared `exportFormatBlockedReason` gate in `page.tsx`.
- AC-11 (pre-generation guard for EDL) — covered by `handleExportCmx3600`'s early return, mirroring `handleExportFcpxml`'s AC-3 guard.
- AC-12 (same 30fps timebase, FCPXML and EDL agree exactly) — covered by `cmx3600.test.ts`'s cross-format consistency test comparing clip/event counts and total kept duration between `buildFcpxml` and `buildCmx3600Edl`.
- AC-13 (sub-frame segment dropped from EDL) — covered by `cmx3600.test.ts`'s "drops a kept segment shorter than one frame" test.
- AC-14 (reel field + FROM CLIP NAME comment reference original filename, 8-char reel, `AX` fallback) — covered by `cmx3600.test.ts`'s reel-name and `AX`-fallback tests.
- AC-15 (sanitized `.edl` filename, same rule as AC-7) — covered by reuse of the shared `sanitizeFilename` from `filename.ts` for both formats' download filenames.
- AC-16 (both formats reachable from one shared, styled menu control) — covered by the manual menu-open step; `ExportFormatMenu` in `page.tsx` reuses `dropdownTriggerClass`/`dropdownOptionClass` from the resolution dropdown.

# Manual verification: engineer sign-off · 2026-07-12
_The `/check verify` run on 2026-07-12 was BLOCKED on the UI-only items below (no browser MCP available in that session). The engineer then ran the manual steps in the Studio directly and confirmed them working, closing the block._

- [x] Menu opens showing "FCPXML (.fcpxml)" and "CMX 3600 EDL (.edl)", styled consistently with the resolution dropdown → AC-8, AC-16 (confirmed by screenshot, both this session and the prior one)
- [x] Clicking each entry downloads its file (FCPXML and CMX 3600 EDL) → AC-9, AC-16
- [x] Downloaded files inspected, content matches expectations → AC-1, AC-4, AC-14
- [x] Disabled state and pre-download guard behave as specced → AC-2, AC-3, AC-10, AC-11
- Engineer attestation: "I testify that it all worked. I verified it." (2026-07-12)

**Spec conformance (final)**: PASS — AC-1 through AC-16 all met, combining the automated `/check verify` run (commands + unit-test-covered ACs) with this manual sign-off (UI-only ACs).
