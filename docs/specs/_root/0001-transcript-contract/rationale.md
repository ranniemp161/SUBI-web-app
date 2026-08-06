# 0001. Transcript contract: reasoning and options

Decision record for [index.md](index.md). Not read during a build.

## Context

> ⚠️ Premise note: the B-Roll high level design's AC-11 asks `@repo/transcript` to "re-export the frame math from rough-cut's `timebase.ts` / `frame-math.ts`". That is not buildable as written, because a package in `packages/` cannot import from an app in `apps/`; npm workspaces run the dependency the other way. Anyone building to the literal wording either inverts the dependency (which will not resolve) or quietly reimplements the arithmetic, which is precisely the failure section 3 of that spec exists to prevent. The intent is sound and is kept. The mechanism has to invert: the code moves into the package, and Rough Cut imports it back.

B-Roll takes a creator's transcript and returns short clips named by the timecode where they belong, for example `scene_04__02-35.mp4`. The creator drags that file onto their finished timeline at 2:35. Every part of that promise depends on a timing chain that currently has a break in it, and the break is not in the arithmetic. It is in provenance.

Rough Cut's timing is correct and hard won. Spec `0004` built one rounding rule shared by the editing path and the export path, kept NTSC rates as exact rationals so 29.97 does not drift over a long timeline, and implemented drop frame timecode counting. Spec `0003` tightened each word's boundaries against the real decoded audio. None of that helps B-Roll unless B-Roll computes with the same arithmetic and the same frame rate, and today it can do neither: the arithmetic lives inside `apps/rough-cut`, where no other workspace can reach it, and the frame rate lives only in one browser tab. `detectVideoFps` runs in the browser against a reselected `File`, using mediabunny packet statistics, and the result is held in React state. It is written to no column and no file. Reload the page and it is gone.

Two other forces shape the problem. First, B-Roll deliberately accepts a plain subtitle upload from someone who never used Rough Cut, which is why `broll_projects.source_project_id` is a nullable foreign key. A subtitle file has cue timing, no word timing, no confidence values, and no frame rate at all, so whatever contract is chosen has to represent both a rich Rough Cut export and a sparse subtitle without pretending they are equally precise. Second, the transcript export that section 3 of the B-Roll design diagrams does not exist yet. Rough Cut emits FCPXML, CMX 3600 EDL, and FCP7 XML, all NLE timeline formats. There is no timed transcript output, so this is unbuilt work in a different app rather than an integration against something already shipped.

The cost of not deciding is specific and quiet. If the frame rate has no named source, the builder invents one, and the most natural invention is the 30 frames per second default that spec `0004` deliberately removed as an export fallback. Every clip cut from a 29.97 source would then land slightly wrong, drifting further the longer the video runs, and nothing would throw. The product would ship looking correct and be wrong by a frame and a half a minute in.

## Options considered

### Option 1: One shared package owning both ends of the wire, with the frame rate persisted

`@repo/transcript` defines the document, validates it, writes it, and reads it, and it holds the frame arithmetic moved out of Rough Cut. Two nullable columns on `projects` store the rate the browser detects, so a server route can build the same document the browser download builds. A subtitle import is represented as timed cues without words.

**Pros**:
- The writer and the reader are one unit, so the two ends of the handoff cannot ship out of step.
- The frame rate has a real, named, durable source, and the server can serve an inherited transcript without the user going back to Rough Cut.
- The subtitle path is representable without fabricating anything.

**Cons**:
- A shared schema migration driven by another app's requirement; Rough Cut gains two columns it does not read itself.
- Old projects have no stored rate until reselected once.
- Consumers branch on two segment shapes forever.

### Option 2: Contract only package, frame rate carried in the file alone

The package defines the document and the arithmetic but writes nothing itself, and no column is added. The rate lives only in the exported file, taken from client session state at export time. Inheriting a transcript means the user opens Rough Cut, reselects their source, exports, and hands the file over; `source_project_id` records provenance rather than being a data path.

**Pros**:
- No migration at all, and the smallest Phase 1.
- One rule holds everywhere with no exceptions: a frame rate only ever comes from real detection, never from a stored value that might be stale.
- No cross origin request, so no cookie behaviour to depend on.

**Cons**:
- Inheriting becomes heavy: the creator must find and reselect a large source video before they can start a B-Roll project, for data the system already holds.
- The nullable foreign key to `projects` then carries no capability, which is a misleading schema.
- It makes the easy path (a linked project) more work than the fallback path (a subtitle upload), which is backwards.

### Option 3: B-Roll reads Rough Cut's tables directly through the shared database

B-Roll queries `projects` through `@repo/db` and applies the EDL itself, which means the EDL type and the collapse logic move into the shared package alongside the frame math.

**Pros**:
- No network hop, no cross origin request, no CORS, and no cross app authentication to get right.
- Real precedent exists: the credit ledger is already read and written by more than one app.

**Cons**:
- Rough Cut's editing model (`segments`, `protectedKeeps`, `sensitivity`, the split flag) becomes a frozen shared contract. Those fields exist to serve the editor and change when the editor changes, and B-Roll would break on edits it has no stake in.
- The ledger precedent does not transfer cleanly: the ledger is a genuinely shared concept living in a shared package, whereas `projects` and `edl` are one app's private model.

### Option 4: Interpolate word timings so everything is uniformly word level

Every input becomes word level. A subtitle cue's span is divided across its words, in proportion to character count, so consumers only ever handle one shape.

**Pros**:
- The simplest possible contract, one shape everywhere, and no branching in the planner or any UI.
- The planner gets word granularity on every input, so scene boundaries can be placed the same way regardless of source.

**Cons**:
- It manufactures timestamps that were never measured, in a product whose stated guarantee is that its numbers are real. Section 3 of the B-Roll design and its chart honesty validator both rest on the opposite principle.
- The fabricated values are indistinguishable from measured ones downstream, so nothing can later warn that a boundary is a guess.

## Rationale

Option 1 was chosen because the forces above are mostly about provenance, and only Option 1 answers provenance for both inputs at once. The frame rate problem is not that the arithmetic is hard; spec `0004` already solved the arithmetic. It is that the value is measured in a browser and then thrown away. Storing it is a two column migration, and Phase 1 is already opening a migration on this schema for the `broll_*` tables and the ledger's second foreign key, so the marginal cost is close to zero while the capability it unlocks (a server that can answer for an inherited project) is what the scope's "upload or inherit" promise actually requires.

Option 2 is the honest minimal alternative and it was close. Its principle, that a frame rate should only ever come from live detection, is genuinely better than a stored value that could go stale. It was rejected on product grounds rather than technical ones: it makes inheriting from a linked project harder than uploading a subtitle from a stranger, which inverts the workflow the two apps exist to join. The staleness worry it protects against is also weaker than it looks, since the frame rate of a source file does not change, unlike the edit itself.

Option 3 was rejected on ownership. Sharing a database is not the same as sharing a model, and the distinction matters here: `@repo/db` exists so apps can share *the ledger*, a concept that belongs to no single app. Rough Cut's EDL belongs entirely to Rough Cut and changes whenever the editor changes. Freezing it into a shared package would make routine editor work a cross app breaking change. Serving a built document from a route keeps the coupling at the narrowest point, the finished bytes, which is the only thing B-Roll actually needs.

Option 4 was rejected on principle, and it is the one worth being firm about. B-Roll's differentiator is that it does not invent numbers; the planner has a validator whose entire job is rejecting fabricated statistics. A contract that silently fabricates timestamps would undercut that guarantee in the layer beneath it, and the fabrication would be invisible, because an interpolated timestamp looks exactly like a measured one. Carrying words as optional costs a branch in each consumer, which is a real and permanent cost, and it buys the ability to tell the truth about precision. That trade is worth making.

One consequence of rejecting Option 3 was missed in the first draft and is worth stating plainly, because it is the same mistake as the premise note above. If the EDL must stay private to Rough Cut, then the code that applies an EDL cannot live in the shared package either. The first draft asked the package's builder to take a transcript, an EDL, and a frame rate, which would have required exporting the EDL type into `packages/`, the very thing this option rejection forbids. The corrected boundary is in AC-16: Rough Cut collapses, the package shapes and validates what comes out. Both surfaces that build a document run inside `apps/rough-cut`, so nothing is lost by drawing the line there, and the package stays ignorant of how a cut is represented, which is what lets the editor keep evolving without breaking B-Roll.

Two smaller calls deserve recording. Zod was chosen over a hand written type guard even though it makes the package non pure, because B-Roll ingests untrusted uploads and the failure message a user sees when their subtitle file is rejected matters; Zod is already in this repo, so nothing new enters the dependency tree. And confidence is left absent rather than defaulted to `1` for imported subtitles because Rough Cut's `sanitizeAiRanges` drops low confidence ranges by averaging that field. A default of `1` would read downstream as high certainty that nobody ever measured, which is the same class of mistake as Option 4 in miniature.
