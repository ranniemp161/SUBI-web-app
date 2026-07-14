# 0001. Export the cut list to professional editors (FCPXML) — rationale

Decision history for [index.md](index.md). Not build input; kept here for reference.

## Context

Rough Cut's export today is a single path: a client side WebCodecs render that stitches the kept EDL (edit decision list, the keep or cut timeline) segments into one MP4, entirely in the browser (the source video is never uploaded to a server). That MP4 is a finished, flattened file. A user who wants to color grade, mix audio properly, or otherwise finish the video in a professional tool has no way to bring their edit decisions in with them. They would have to reopen the raw source footage in DaVinci Resolve or Premiere Pro and redo the cutting by hand, throwing away the work Rough Cut already did.

The forces at play: the app never stores the original video server side, so any export path must work from data already in the browser (the EDL plus the user's locally reselected source file), the same constraint the existing MP4 export already satisfies. The EDL model itself (`src/lib/edl.ts`) is simple: an ordered list of segments in seconds, each marked keep or cut with a reason. No frame rate is tracked anywhere in the app today; the existing frame snapping logic already assumes 30fps as a documented, accepted tradeoff (ADR 0004).

Not deciding this means every user who wants a professional finish continues to lose their AI assisted cut entirely and starts over by hand in their NLE (non linear editor, professional video editing software).

## Options considered

### Option 1: FCPXML only, hand rolled generator, extend the existing export control

Add a pure function that turns an EDL plus a project title and source filename into an FCPXML string, following the same pattern as the app's existing pure export logic (`src/lib/export/plan.ts`), no new dependency. Wire it into the same top bar control that already holds the MP4 export button and resolution dropdown, restyling that whole cluster at the same time.

**Pros**:
- No new dependency; matches the app's existing convention of hand rolling its own export logic rather than pulling in a video or XML library.
- One format to build, test, and maintain well, rather than splitting effort across two.
- FCPXML is read reliably by both DaVinci Resolve and Premiere Pro, so one file covers both target editors.
- Reuses the export gating and UI location the user already knows from MP4 export.

**Cons**:
- FCPXML carries more structure than a plain CMX 3600 EDL (clip names, format definitions); a hand rolled template has more XML shape to get right than the older, simpler EDL format would.
- Locks the interchange choice to one format; a future editor that only reads CMX 3600 EDL (some older Avid workflows) would need a second exporter later.

### Option 2: CMX 3600 EDL only

Generate the older, simpler EDL format instead: plain text, timecode in and out points, a reel name per event. Universally supported, including by tools FCPXML does not reach.

**Pros**:
- Simplest format to generate correctly; a well understood, decades old text format with a small, fixed grammar.
- Broadest possible compatibility, including older or non mainstream tools.

**Cons**:
- Carries far less information than FCPXML (no clip naming beyond a reel field, no richer metadata), a visibly thinner result when opened in a modern NLE.
- Timecode only, no native concept of a project or sequence name, so the import experience in DaVinci or Premiere is rougher than an FCPXML's.

### Option 3: Both EDL and FCPXML at once

Ship both formats in the same release.

**Pros**:
- Maximum compatibility from day one.

**Cons**:
- Roughly doubles the surface to design, build, and test for a first version of a feature nobody has used yet; the two formats have different enough shapes that this is not just running the same logic twice.
- No evidence yet that CMX 3600 EDL's narrower feature set is actually needed by this app's users; better to ship one format, see if it is used, then decide if a second is worth it.

## Rationale

FCPXML is the interchange format both target editors (DaVinci Resolve and Premiere Pro) read reliably, so Option 1 covers the stated goal (handoff for final polish) without needing a second format. The app already hand rolls its own export logic with no external video or XML library (see `src/lib/export/plan.ts`, a pure function with no dependencies); a hand rolled FCPXML template keeps that same convention rather than introducing a new dependency for what is, at its core, a text template. Option 3's extra format is not justified yet: this is a first version of a feature with no usage data behind it, and the cost (double the design, build, and test surface) is not worth paying speculatively when Option 1 already satisfies the stated use case. Option 2's simplicity is real but its thinner result (no clip naming, weaker metadata) is the worse first impression for a feature whose whole point is a clean handoff to a professional tool.

## Revision, 2026-07-12: adding CMX 3600 EDL

This spec's own Follow-up anticipated exactly this: "If usage shows real demand from tools that only read CMX 3600 EDL, revisit Option 2 as a second export format." The engineer has now made that call directly, without waiting on usage data: they want both formats offered as an explicit user choice, reasoning that CMX 3600 EDL's age and simplicity is itself a reliability advantage (broader tool support, a smaller and more stable grammar than FCPXML's), the same strength Option 2's Pros already named.

This reopens Option 3 (both formats at once), previously rejected here for doubling the build surface on a feature with no usage data yet. That objection no longer applies on its own terms: the feature has since shipped its first slice (FCPXML only, this spec's original Option 1), so the "surface to design, build, and test" is now additive on top of a working pipeline, not built from zero, and the engineer's request replaces "no usage data" with a direct requirement. Option 2's cost, thinner metadata than FCPXML, is no longer a reason to avoid CMX 3600 EDL entirely; it is only a reason to keep FCPXML as the richer of the two options, which this revision does, it does not replace FCPXML, it adds EDL alongside it.

The updated `## Decision` in `index.md` extracts the frame math and filename sanitizing FCPXML's implementation already built into shared helpers before writing the CMX 3600 EDL generator against them (basis: the existing project convention of small, dependency free, directly testable pure functions per format, seen in `plan.ts` and `fcpxml.ts`), rather than duplicating that logic a second time. This keeps the two formats' cut points and total duration mechanically guaranteed to agree, the specific risk that made "just ship both" costly the first time this option was considered.
