# 0001. Export the cut list to professional editors (FCPXML and CMX 3600 EDL)

**Date**: 2026-07-12
**Status**: Accepted

## Summary

Rough Cut can already export a finished MP4 in the browser, and (as of this feature's first slice) an FCPXML file that DaVinci Resolve and Premiere Pro read. This update adds a second interchange format, CMX 3600 EDL, a plain text format almost every video editor can read, and lets the user pick which one they want from one shared, styled menu in the export cluster. A user can keep using Rough Cut for the fast, AI assisted first pass, then hand the cut list to whichever professional tool and format their pipeline expects, instead of being locked to one.

See [rationale.md](rationale.md) for the context, options considered, and decision rationale behind this spec.

## Requirements

**User stories**:
- As a Rough Cut user who wants to finish their video in DaVinci Resolve or Premiere Pro, I want to export my cut list as a file those editors can open, so that I keep the cuts Rough Cut already made instead of redoing them by hand.
- As a Rough Cut user whose downstream tool or workflow expects the older, widely supported EDL format instead of FCPXML, I want a CMX 3600 EDL export option, so that I am not locked out of the handoff just because my tool does not read FCPXML.
- As a Rough Cut user, I want the export controls to look like the rest of the app, so that the resolution dropdown and the format choice do not stand out as unstyled default browser controls.

**Acceptance criteria** (the contract, each criterion is IDed and independently checkable):

*Already built (FCPXML, shipped in this feature's first slice):*
- **AC-1**: Given a project with a saved EDL containing at least one kept segment, selecting the FCPXML export option downloads a valid FCPXML file containing only the kept segments, as sequential clips in original order, matching exactly what the user sees and hears on playback in the studio.
- **AC-2**: Given a project with no saved EDL, or a saved EDL whose kept duration is zero, the FCPXML export option is disabled, the same gating rule the existing MP4 export already follows.
- **AC-3**: If export is somehow triggered against a zero kept duration EDL, the app validates before generating anything, shows an inline error, and never starts a browser download of an empty or broken file.
- **AC-4**: The exported FCPXML references the source clip by its original uploaded filename, so opening the file in DaVinci Resolve or Premiere Pro and relinking media is done by locating that same file on the user's machine.
- **AC-5**: Each clip's in and out points are derived from the EDL segment's start and end times (seconds) at a fixed 30 frames per second timebase, the same assumption the app's existing frame snap logic already uses.
- **AC-6**: A kept segment shorter than one frame (1/30th of a second) is dropped from the exported timeline rather than included as a zero length clip.
- **AC-7**: The downloaded file's name is derived from the project title, with characters unsafe for a filename replaced or stripped.
- **AC-8**: The export resolution dropdown and the FCPXML export entry point share one visually consistent, styled control that matches the app's existing design tokens, not the browser's native unstyled select element look.

*New in this update (CMX 3600 EDL, plus the two format picker):*
- **AC-9**: Given a project with a saved EDL containing at least one kept segment, selecting the CMX 3600 EDL export option downloads a valid `.edl` text file containing one event per kept segment, in original order, with sequential event numbers and record timecodes that run back to back with no gaps, matching exactly the kept ranges.
- **AC-10**: Given a project with no saved EDL, or a saved EDL whose kept duration is zero, the CMX 3600 EDL export option is disabled, the same gating rule AC-2 already defines for FCPXML.
- **AC-11**: If EDL export is somehow triggered against a zero kept duration EDL, the same pre generation guard as AC-3 applies: no download starts, an inline error is shown.
- **AC-12**: Each EDL event's source and record timecodes are derived from the EDL segment's start and end times at the same fixed 30 frames per second timebase used for FCPXML (AC-5), so the two formats always agree exactly on where every cut falls.
- **AC-13**: A kept segment shorter than one frame is dropped from the EDL output, the same rule AC-6 defines for FCPXML.
- **AC-14**: The EDL's reel field and a `* FROM CLIP NAME:` comment reference the source clip by its original uploaded filename (mirroring AC-4), sanitized and truncated to the 8 character reel name CMX 3600 requires.
- **AC-15**: The downloaded EDL file's name is derived from the project title, sanitized the same way as the FCPXML filename (AC-7), with a `.edl` extension.
- **AC-16**: The FCPXML and CMX 3600 EDL export options are both reachable from one shared, styled menu control (extending AC-8): a single entry point in the export cluster opens a small menu listing both formats by name; choosing either triggers that format's own gated download, and the menu shares the same visual treatment as the resolution dropdown.

## Decision

**Chosen option**: Ship both formats from one shared, format agnostic export pipeline: extract the frame math and filename sanitizing this feature already built for FCPXML into shared helpers, add a CMX 3600 EDL generator that reuses them, and turn the single "For DaVinci / Premiere" button into a small menu offering both formats by name.

This reverses the first slice's Option 1 (FCPXML only) call, which explicitly flagged "if usage shows real demand from tools that only read CMX 3600 EDL, revisit" as a Follow-up. The engineer has now made that call directly: ship both, let the user choose.

## Feature design

**Data model sketch**:
None. Still a pure client side transform: both formats are generated on the fly from the already saved EDL and the project's title, the same trigger point the FCPXML export already uses. Nothing new is stored in `packages/db`.

**API surface**:
None new. Generation runs entirely client side for both formats; no new route is added.

**Key invariants**:
- The exported timeline's total duration always equals the EDL's kept duration (`keptDuration(edl)` in `src/lib/edl.ts`), never more, never less, in either format.
- Clip/event order in either export always matches segment order in the EDL (already sorted by start time).
- A segment shorter than one frame at 30fps (about 0.0333 seconds) never appears as its own clip/event in either output.
- **The FCPXML and CMX 3600 EDL exports of the same EDL always agree exactly on cut points and total duration.** Both are built from the same shared frame math helper (one `FPS = 30` constant, one `toFrames`/timecode conversion function) and the same `getKeepRanges`/`totalKeptSeconds` helpers from `plan.ts`, so there is exactly one place that could get the timebase wrong, not two.

**Security model**:
Unchanged from the first slice. The studio page already requires an authenticated session that owns the project (enforced by `src/proxy.ts`); generating either format only reads data already loaded client side for that authorized user, the same trust boundary the MP4 export already operates inside.

**CMX 3600 EDL shape** (the new format's grammar, kept intentionally minimal, matching what the format actually supports):
- Header: a `TITLE:` line (the project title) and an `FCM: NON-DROP FRAME` line (declares the timecode style, matching the fixed 30fps non drop frame assumption both formats share).
- One event per kept segment (after the sub frame drop), each a fixed width line: 3 digit sequential event number, an 8 character reel name (derived from the sanitized, truncated, uppercased source filename; falls back to `AX`, the conventional reel name file based/auxiliary sources use when no real reel exists, if sanitizing leaves nothing), track type `V` (video), edit type `C` (cut), then source in, source out, record in, record out timecodes (`HH:MM:SS:FF` at 30fps).
- Each event is followed by a `* FROM CLIP NAME: <original filename>` comment line, the same relink-by-name mechanism as FCPXML's asset name (AC-14), which DaVinci Resolve and Premiere Pro both read on EDL import.
- Record timecode is cumulative across events with no gaps (mirrors FCPXML's back to back clip offsets), source timecode is the segment's own start/end, exactly like the FCPXML clip's `start` vs `offset` split.

**Format picker shape** (extends AC-8's styled control rather than introducing a new pattern):
- The existing "For DaVinci / Premiere" button becomes a menu button (adds a chevron, same trigger styling as the resolution dropdown already built). Opening it reveals two `role="menuitem"` entries: "FCPXML (.fcpxml)" and "CMX 3600 EDL (.edl)".
- These are actions, not a persisted selection (no third state to remember): clicking either immediately generates and downloads that format, then closes the menu. Both entries share one gating rule (disabled together when the EDL has no kept duration), since the underlying EDL is the same for both formats.
- No new visual language: reuse the trigger and option styling the resolution dropdown already introduced in this feature's first slice, so the whole cluster (resolution, format menu, MP4 export button) still reads as one consistent, token styled group.

**Critical test scenarios** (each maps to an acceptance criterion in ## Requirements):
- Happy path (FCPXML, already covered): a project with a mixed keep and cut EDL exports an FCPXML whose clips, in order, cover exactly the kept ranges, verifies **AC-1**, **AC-5**.
- Happy path (EDL, new): the same EDL exports a CMX 3600 EDL whose events, in order, cover exactly the kept ranges with back to back record timecode, verifies **AC-9**, **AC-12**.
- Cross format consistency (new): the same EDL's FCPXML and CMX 3600 EDL exports report the same total kept duration and the same number of clips/events, verifies the shared timebase invariant above.
- Failure case: a project whose EDL is entirely cut (zero kept duration) cannot trigger a download in either format, verifies **AC-2**, **AC-3**, **AC-10**, **AC-11**.
- Edge case: an EDL containing a kept segment shorter than one frame drops that segment from both outputs without breaking the surrounding boundaries, verifies **AC-6**, **AC-13**.
- Edge case: a project titled with filesystem unsafe characters downloads under a sanitized filename in both formats, verifies **AC-7**, **AC-15**.
- Edge case: a source filename that sanitizes to nothing (e.g. all punctuation) still produces a valid 8 character reel name (`AX` fallback), verifies **AC-14**.
- UI: opening the format menu shows both options styled consistently with the resolution dropdown, and each is independently disabled/enabled by the same kept duration rule, verifies **AC-16**.

## Build plan

*Already built (first slice):*
1. Add `buildFcpxml(edl, projectTitle, sourceFilename)` as a new pure function in `apps/rough-cut/src/lib/export/fcpxml.ts`, following the existing pure, dependency free pattern in `src/lib/export/plan.ts`: maps kept EDL segments to sequential FCPXML clips at a fixed 30fps timebase, drops sub frame segments, sanitizes the filename. Unit tested directly, no browser APIs, satisfies **AC-1**, **AC-4**, **AC-5**, **AC-6**, **AC-7**.
2. Wire a "For DaVinci / Premiere" export entry point into the `TopBar` component (`apps/rough-cut/src/app/(app)/dashboard/[id]/page.tsx`), next to the existing MP4 export button, gated by the same "has a saved EDL with kept duration greater than zero" rule the MP4 export already checks, satisfies **AC-2**.
3. Add the pre download validation guard (zero kept duration blocks the download with an inline error, mirroring the app's existing "can't export an empty timeline" guard) so the check holds even if the entry point is ever reachable in a state it should not be, satisfies **AC-3**.
4. Restyle the export controls cluster: replace the native `<select id="export-quality">` resolution dropdown with a styled control built on the app's existing design tokens (`packages/ui`), and place the new FCPXML entry point in the same visually consistent cluster, satisfies **AC-8**.

*New in this update:*
5. Extract the frame math this feature's first slice built inline in `fcpxml.ts` into a shared `apps/rough-cut/src/lib/export/timebase.ts` (the `FPS = 30` constant, `toFrames(seconds)`, and a new `formatTimecode(seconds)` returning `HH:MM:SS:FF` for CMX 3600's timecode fields), and extract `sanitizeFilename` into a shared `apps/rough-cut/src/lib/export/filename.ts`. Update `fcpxml.ts` to import both instead of holding its own copies. Refactor only, no behavior change; keeps **AC-5**, **AC-6**, **AC-7** passing, not weakened.
6. Add `buildCmx3600Edl(edl, projectTitle, sourceFilename)` as a new pure function in `apps/rough-cut/src/lib/export/cmx3600.ts`, mirroring `fcpxml.ts`'s structure and reusing the shared timebase/filename helpers from task 5: emits the `TITLE:`/`FCM:` header, one sequential event per kept segment (reel name, track/edit type, source and record timecodes) plus its `* FROM CLIP NAME:` comment, drops sub frame segments, satisfies **AC-9**, **AC-12**, **AC-13**, **AC-14**.
7. Reuse the shared `sanitizeFilename` unmodified for the `.edl` filename, satisfies **AC-15**.
8. Replace the "For DaVinci / Premiere" button in `TopBar` with a menu button (same trigger styling as the resolution dropdown) opening a small menu with two entries, "FCPXML (.fcpxml)" and "CMX 3600 EDL (.edl)"; each triggers its own format's build + download function, gated by one shared "has a saved EDL with kept duration greater than zero" check covering both, satisfies **AC-10**, **AC-11**, **AC-16**.
9. Add `cmx3600.test.ts` mirroring `fcpxml.test.ts`'s coverage (event ordering, sub frame drop, reel/filename reference including the `AX` fallback, timecode correctness), plus a cross format consistency test comparing an FCPXML and CMX 3600 EDL export of the same EDL, and update `page.test.tsx` if it asserts on the old single button label, satisfies **AC-9** through **AC-16**.

## Consequences

**Positive**:
- Users get a real handoff path to any professional editor's cut list import, not just the two named editors' FCPXML support, without losing the AI assisted cut they already approved.
- No new server side surface, dependency, or stored data; the feature stays inside the app's existing "nothing server side" export model.
- Sharing one timebase/filename implementation between both formats means there is exactly one place the frame math or filename sanitizing could be wrong, not two drifting implementations.

**Negative / tradeoffs**:
- The fixed 30fps timebase assumption is wrong by up to about one frame on non 30fps source footage (24fps, 60fps), the same accepted tradeoff already documented for frame snapping elsewhere in the app (ADR 0004), and now shared by both export formats identically.
- Relying on the original filename for relinking (FCPXML's asset name, the EDL's reel field and comment) means a user who renamed their local file, or no longer has it, must manually relink or relocate it in either tool; there is no embedded media reference beyond the name.
- CMX 3600 EDL carries far less metadata than FCPXML (an 8 character reel name and a comment line, no project or sequence name, no rich clip naming); a user who does not know which format their tool prefers has no in app guidance on which to pick, only two labeled options.
- Two export code paths (however much helper code they now share) is more surface to keep correct than one; the cross format consistency test scenario above exists specifically to catch the two formats drifting apart.

**Neutral**:
- No database migration and no new environment variable; this ships in a single deploy, same as the first slice.

## Follow-up

- [ ] No analytics currently records which export format a user picks. If a future decision needs real usage data (e.g. whether to simplify back to one format), add an event on each format's download before making that call.
- [ ] Revisit the 30fps assumption together with ADR 0004's existing frame snap tradeoff if non 30fps source footage becomes common; it now affects two export formats identically instead of one.
