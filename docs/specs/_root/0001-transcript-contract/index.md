# 0001. Transcript contract for the Rough Cut to B-Roll handoff

**Date**: 2026-08-05
**Status**: In Progress

## Summary

B-Roll turns a creator's transcript into clips named by timecode, and its whole promise is that a clip labelled 2:35 really sits at 2:35 on the creator's finished edit. This decision defines the file that carries that timing between the two apps, and it creates a shared package, `@repo/transcript`, that owns both the file's shape and the frame arithmetic behind it. The two things that were genuinely undecided are now settled: the frame rate is measured in the browser and stored on the project, so the server can put it in the file; and a plain subtitle upload keeps its own cue timing rather than having word timings invented for it. Nothing in the file is ever a fabricated number.

## Requirements

**User stories**:

- As a creator who has cut a video in Rough Cut, I want to hand that exact timing to B-Roll, so the clips it produces land where I expect on my final timeline.
- As a creator who has never used Rough Cut, I want to start from a subtitle file I already have, so I am not pushed through a tool I do not need.
- As an engineer, I want exactly one implementation of the frame arithmetic in this repo, so two apps can never round the same timecode differently.

**Acceptance criteria**:

- **AC-1**: `@repo/transcript` exists as a workspace package and holds the only implementation in the repo of `secondsToFrame`, `msToFrame`, `frameToSeconds`, `frameToMs`, `frameDurationSeconds`, `toFrames`, `formatTimecode`, `snapToStandardFps`, `isDropFrame`, `nominalFps`, and `minClipSeconds`. No app reimplements any of them.
- **AC-2**: `apps/rough-cut/src/lib/frame-math.ts` and `apps/rough-cut/src/lib/export/timebase.ts` survive as one line re-export shims, so every existing import site and the key files table in `apps/rough-cut/AGENTS.md` stay correct. The moved tests still pass from their new home.
- **AC-3**: The package exports a Zod schema that is the single definition of a valid transcript document, and the TypeScript type is inferred from that schema, so the runtime check and the type cannot disagree.
- **AC-4**: A transcript document carries `version`, `fps` (an exact rational, nullable), `duration`, `generatedAt`, `wordsAligned`, `source` (`kind`, `projectId`, `edlFingerprint`), and `segments`. All times are seconds, and zero is the first frame of the final cut.
- **AC-5**: A segment may hold words or omit them. A Rough Cut export always has words. A plain SRT import has none. A WebVTT file carrying inline cue timestamps parses into words.
- **AC-6**: No field in a document reports a measurement that was never taken. An imported subtitle's words omit `confidence` entirely rather than defaulting it, and its `fps` is null rather than guessed.
- **AC-7**: Rough Cut writes the detected frame rate to `projects.source_fps_num` and `projects.source_fps_den` when the user reselects the source file and `detectVideoFps` resolves.
- **AC-8**: Rough Cut's export modal offers the transcript JSON as a download beside FCPXML, CMX 3600, and FCP7 XML, disabled whenever `sourceFps` is unknown, exactly the gate spec `0004` applied to the other exports.
- **AC-9**: `GET /api/projects/:id/transcript` returns output identical to that download in every field except `generatedAt`, built by the same builder function, and only for the project's owner. A signed in non owner is denied. (`generatedAt` is a clock read, so the two paths cannot match on it; the point of the criterion is that one builder serves both, not that the bytes are reproducible.)
- **AC-10**: When a project has no stored frame rate, the route refuses with a message naming the fix (open the project in Rough Cut and reselect the source file once), rather than serving a document without a timebase.
- **AC-11**: A word whose span is partly removed by a cut is clamped to the kept span. It is dropped only when what remains is shorter than one frame at the document's frame rate, measured with `minClipSeconds`. A word straddling two disjoint kept ranges (two cuts inside one word) collapses to its larger surviving fragment, never to two entries.
- **AC-12**: Times in the document are contiguous and non decreasing, and no time falls inside a cut range. A position reported as 2:35 corresponds to 2:35 on the final cut, checked against a 29.97 drop frame source.
- **AC-13**: The schema rejects a document exceeding the byte cap or the segment count cap, naming which limit was hit.
- **AC-14**: A document with zero segments is structurally valid and parses. Refusing to plan against an empty transcript belongs to the planner, not the parser.
- **AC-15**: B-Roll's browser calls the Rough Cut route with the user's own Clerk session. No shared service secret is introduced, and the allowed origin is named explicitly rather than opened to all.
- **AC-16**: The cut collapse stays inside `apps/rough-cut`. Rough Cut computes post cut times from its own EDL using the existing `getKeepRanges` plus a clamp aware remapper, then hands the package already collapsed segments plus the frame rate. `@repo/transcript` contains no EDL type and no knowledge of how a cut is represented.

## Decision

**Chosen option**: Option 1: one shared package owning both ends of the wire, with the frame rate measured in the browser and persisted on the project.

`@repo/transcript` defines the document, validates it, writes it, and reads it, and it holds the frame arithmetic moved out of Rough Cut. Rough Cut stores the frame rate it already detects, so the same builder can serve both a browser download and a route B-Roll calls. A subtitle upload is represented honestly as timed cues without words, rather than being padded out to look word level.

**Where the boundary sits.** "Both ends of the wire" means both ends of the *document*: shaping, validating, hashing, serializing, and parsing. It does not extend to the cut collapse. Turning raw Deepgram times into post cut times needs the EDL, and the EDL is Rough Cut's private editing model, which is exactly why sharing it was rejected (see the rationale's Option 3). So Rough Cut collapses first, using the `getKeepRanges` and remapper code it already has, and passes the package a list of post cut segments. Both surfaces that build a document, the modal download and the route, run inside `apps/rough-cut`, so both reach that code. AC-16 states this, and it exists because the first draft of this spec put the collapse in the package and reproduced the same impossible dependency direction it corrects below.

**A correction to the B-Roll spec's AC-11.** That criterion says `@repo/transcript` should "re-export the frame math from rough-cut's `timebase.ts` / `frame-math.ts`". Read literally that is not buildable: a package in `packages/` cannot import from an app in `apps/`, because the dependency runs the wrong way. The intent (do not reimplement the arithmetic) is right and is preserved here. The mechanism inverts: the code moves into the package and Rough Cut imports it back. AC-1 and AC-2 above state the buildable form, and a follow up item amends the B-Roll spec.

## Feature design

**Data model sketch**:

The wire document, defined and validated in `@repo/transcript`:

| Entity | Field | Type | Required | Notes |
|---|---|---|---|---|
| **TranscriptDocument** | `version` | integer | yes | Format version, `1`. |
| | `fps` | `{ numerator, denominator }` or null | yes, nullable | Exact rational, so 29.97 stays 30000/1001. Null only when `source.kind` is `"import"`. |
| | `duration` | number, seconds | yes | Total runtime after cuts. |
| | `generatedAt` | ISO 8601 string | yes | |
| | `wordsAligned` | boolean | yes | Whether timings were tightened against real audio (spec `0003`). |
| | `source` | object | yes | Provenance, below. |
| | `segments` | TranscriptSegment[] | yes | May be empty. |
| **source** | `kind` | `"rough-cut"` or `"import"` | yes | |
| | `projectId` | string or null | yes, nullable | Null for an upload. |
| | `edlFingerprint` | string or null | yes, nullable | Hash of the EDL this was cut from. Unused in Phase 1, and the input Phase 3 compares to detect a stale transcript. |
| **TranscriptSegment** | `start`, `end` | number, seconds | yes | Post cut. Zero is the first frame of the cut. |
| | `text` | string | yes | |
| | `words` | TranscriptWord[] | no | Present from Rough Cut, absent from a plain subtitle. |
| **TranscriptWord** | `word` | string | yes | |
| | `start`, `end` | number, seconds | yes | |
| | `confidence` | number | no | Absent, never defaulted, when the source never measured it. |

Persistence changes:

| Table | Change | Nullability | Written by |
|---|---|---|---|
| `projects` | add `source_fps_num`, `source_fps_den` (integers) | nullable | The browser, on source reselect, from `detectVideoFps`. Null for any project not reselected since this shipped. |
| `broll_projects` | `transcript` jsonb (the segments), `transcript_meta` jsonb (the envelope without segments) | nullable | B-Roll on upload or inherit. The table itself is created by the sibling `broll_*` migration task, not this spec. |

**State transitions**: none. A transcript document is an immutable snapshot. The staleness lifecycle (a document that no longer matches the edit it came from) is deliberately out of scope here; `edlFingerprint` is the field Phase 3 will compare, and nothing reads it yet.

**API surface**:

| Endpoint | Method | Key inputs | Key outputs | Auth | Key errors |
|---|---|---|---|---|---|
| `/api/projects/:id/transcript` | GET | `id` (path) | The transcript document as JSON | Clerk session, owner only | 401 unauthenticated, 404 not the owner or no such project, 409 no stored frame rate, 429 rate limited |

The export modal's download is not an endpoint. It calls the same builder in the browser and writes the file through the existing `download-text-file.ts`.

**Value sourcing**:

| Action | Value produced | Source |
|---|---|---|
| Build a document (route path) | `fps` | `projects.source_fps_num` / `source_fps_den`, written at reselect by `detectVideoFps` |
| Build a document (download path) | `fps` | `sourceFps` in client session state, the same value, already required by the spec `0004` export gate |
| | `duration` | Summed lengths of the kept ranges in `projects.edl` |
| | `generatedAt` | Clock at build time, ISO 8601 |
| | `wordsAligned` | The existing `projects.words_aligned` column (spec `0003`) |
| | `source.kind` | Literal `"rough-cut"` on this path |
| | `source.projectId` | `projects.id` |
| | `source.edlFingerprint` | Hash over a **canonical** serialization of `edl.segments` only: fixed key order, times rounded to milliseconds (the precision `roundMs` already stores). Canonical because an optional `split` key or a float formatting difference would otherwise change the hash without the edit changing, and Phase 3 compares these hashes across time to detect drift. Scoped to `segments` so an unrelated column write does not read as a changed edit |
| | segment `start` / `end` | Deepgram word times in `projects.transcript`, remapped through the kept ranges by Rough Cut's own `getKeepRanges` plus a clamp aware remapper, so removed time is subtracted (AC-16) |
| | segment boundaries | The union of two sets: the edges of each kept range, and, for each value in `utteranceEnds`, the `end` of the last word at or before it. Every boundary is therefore a real word time. A raw `utteranceEnd` is never used directly as a boundary, because Deepgram's utterance ends do not equal word ends exactly (`retake-detection.ts` already compares them with a tolerance), and a boundary that matches no word would be a fabricated number |
| | segment `text` | Concatenated text of the words inside it |
| | a kept range with no surviving words | No segment is emitted. A sliver too short to hold a word carries no speech, an empty segment gives the planner nothing, and emitting one would consume the segment count cap. Its time still counts toward `duration`, since `duration` is runtime and segments are speech |
| | word `confidence` | Deepgram's per word confidence, passed through unchanged |
| Import an SRT or VTT | segment `start` / `end` | The cue's own timestamps, unchanged |
| | `words` | VTT inline cue timestamps where present; otherwise absent. Never interpolated. Decided per cue, not per file, so a VTT where only some cues carry inline timestamps parses successfully with words on exactly those cues. Mixed precision is a fact about the file, not an error |
| | `fps` | Null. No source for it exists in a subtitle file |
| | `wordsAligned` | `false` |
| | `source.kind` | Literal `"import"`; `projectId` and `edlFingerprint` null |
| Name a B-Roll clip | The timecode in the filename | `formatTimecode(start, fps)` from this package, with the drop frame separator decided by `isDropFrame` |
| Decide the export entry is enabled | Boolean | `sourceFps !== null` in client session state, the existing gate |
| Serve the route | Authorization | The `users` row plus `projects.user_id` ownership, through Rough Cut's existing `authz.ts` |

**Key invariants**:

- Zero on the timeline is the first frame of the final cut. The source's embedded start timecode (the `tmcd` track Rough Cut reads for NLE relink) is never added here.
- No time in a document falls inside a cut range, and times never decrease, across segments or across the words inside one.
- `fps` is null only when `source.kind` is `"import"`. A `"rough-cut"` document always carries a real detected rate.
- Nothing in a document is fabricated. A measurement that was not taken is absent, never defaulted to a plausible looking value. Every segment boundary and every word time in a document traces to a real measured time, never to an interpolation or to a value (like a raw `utteranceEnd`) that sits between two real ones.
- The frame arithmetic has exactly one implementation in the repo.
- The package never learns what an EDL is. Cuts are applied before the builder is called, so the document shape and the editing model can change independently of each other.
- `DEFAULT_FPS` moves with the rest but keeps the status spec `0004` gave it: a definitional default for the helpers and their tests, never a live fallback on any export path, including this new one.

**Security model**:

The route is owner only, using the convention already in force in Rough Cut: the `users` row is the authorization, checked in `authz.ts` against `projects.user_id`. A transcript is the user's own content and is never public. The cross origin allowance names the B-Roll origin explicitly and is never a wildcard, and it is sent with credentials so the Clerk session travels. The route joins Rough Cut's existing `readRateLimit` bucket. No new secret is introduced, which is deliberate: the alternative service token would have to be registered in `turbo.json`'s build `env` array or it would silently read as undefined, a trap this repo has already been caught by once.

**Configuration required**:

- `NEXT_PUBLIC_BROLL_URL`: the B-Roll origin Rough Cut allows on the transcript route. Read through `apps/rough-cut/src/lib/env.ts` only, never as a raw `process.env` read elsewhere, matching how `WALLET_URL` is handled.

**Critical test scenarios**:

- Happy path: a project with a reselected source and a saved EDL exports a document whose times, converted at the stored rate, land exactly where the cut lands, verifies **AC-8**, **AC-12**.
- Frame accuracy: a 29.97 drop frame source, a word at a known position, formats to the expected drop frame timecode with the `;` separator, verifies **AC-12**.
- Clamp rule: a razor cut through the middle of a word yields a clamped word; a cut leaving less than one frame drops it entirely; two cuts inside one word yield one entry, the larger fragment, verifies **AC-11**.
- Boundary rule: a kept range spanning two Deepgram utterances splits into two segments, and each boundary equals a real word end rather than the raw `utteranceEnd` value, verifies **AC-12**.
- Empty sliver: a kept range too short to contain any surviving word emits no segment, while its time still counts toward `duration`, verifies **AC-12**, **AC-14**.
- Fingerprint stability: building the same project twice, and building it after a write that touches no EDL segment, both yield the same `edlFingerprint`, verifies **AC-4**.
- Boundary of ownership: `@repo/transcript` contains no reference to the EDL type and no cut handling, verifies **AC-16**.
- Failure case: a project with no stored frame rate makes the route refuse with the reselect message rather than serve a document, verifies **AC-10**.
- Auth: a signed in user requesting someone else's project transcript is denied, verifies **AC-9**.
- Import: an SRT parses to segments with no words and a null rate; a VTT with inline timestamps parses to segments with words and no confidence values, verifies **AC-5**, **AC-6**.
- Limits: an oversized upload and an over count upload are each rejected naming the limit hit, verifies **AC-13**.
- Empty: a document with zero segments validates and parses, verifies **AC-14**.
- Regression: every existing Rough Cut import of `@/lib/frame-math` and `@/lib/export/timebase` still typechecks through the shims and their tests pass, verifies **AC-2**.

## Build plan

Ordered as a Tracer Bullet: tasks 1 to 7 stand up a working thread through every layer (package, schema, migration, collapse, builder, UI) so a user can export a real transcript file before anything crosses an app boundary. Tasks 8 and 9 extend that thread to B-Roll. Tasks 10 and 11 thicken it with the second input path and B-Roll's storage.

1. Create `packages/transcript` mirroring `@repo/server-shared`'s layout (raw TypeScript, subpath exports, colocated Vitest). Move `frame-math.ts` and `export/timebase.ts` plus their tests into it, and leave one line re-export shims at both old paths, satisfies **AC-1**, **AC-2**.
2. Define the document as a Zod schema with the type inferred from it: segments holding optional words, times in seconds, zero at the cut's start, satisfies **AC-3**, **AC-4**, **AC-5**, **AC-14**.
3. Migration through `packages/db` adding `source_fps_num` and `source_fps_den` to `projects`, both nullable, satisfies **AC-7**.
4. Rough Cut writes the detected rate to those columns when `detectVideoFps` resolves at reselect, satisfies **AC-7**.
5. Add the collapse in Rough Cut, beside the existing `getKeepRanges` and `createTimeRemapper`: a clamp aware variant that keeps a partly cut word instead of dropping it, applies the sub frame and straddle rules, and derives segment boundaries from kept range edges plus word snapped utterance ends, satisfies **AC-11**, **AC-12**, **AC-16**.
6. Build the builder in the package: already collapsed segments plus the frame rate and provenance to a validated document, including the canonical EDL fingerprint, satisfies **AC-4**, **AC-12**, **AC-16**.
7. Add the transcript entry to the export modal, wired to the collapse plus the builder and disabled while `sourceFps` is unknown, satisfies **AC-8**.
8. Add `GET /api/projects/:id/transcript`, calling the same collapse and builder, owner only, rate limited, refusing with the reselect message when no rate is stored, satisfies **AC-9**, **AC-10**.
9. Allow the B-Roll origin on that route with credentials, reading it through `env.ts`, and confirm on a real deployment that the Clerk session actually reaches Rough Cut on a cross origin request, satisfies **AC-15**.
10. Add the readers to the package: JSON parse and validate with the byte and segment caps, plus SRT and VTT importers that keep cue timing, read VTT inline timestamps per cue where present, and omit confidence, satisfies **AC-3**, **AC-6**, **AC-13**.
11. Land `transcript` and `transcript_meta` on `broll_projects`, coordinated with the sibling `broll_*` migration task rather than as a second migration, satisfies **AC-4**.

Tasks 1 to 10 need no `apps/broll`. Only task 11, and the real exercise of task 9, wait on the scaffold sub task.

## Consequences

**Positive**:

- The frame arithmetic that the entire "2:35 means 2:35" promise rests on has one implementation, so B-Roll cannot round differently from Rough Cut.
- The frame rate stops being a value that exists only inside one browser tab and disappears on reload.
- The writer and the reader ship together, so the two ends of the handoff cannot drift apart in separate releases.
- A subtitle upload is representable without lying about how precise it is, which matters for a product whose selling point is that its numbers are real.
- Phase 3's staleness work has the field it needs already in circulation, so it will not require a format change to files already in the wild.

**Negative / tradeoffs**:

- A shared schema migration on `projects` is being driven by a B-Roll requirement, so Rough Cut carries two columns it does not itself read.
- Every project that predates the columns has no stored rate and cannot be inherited until it is opened and reselected once. This is visible and explained rather than silent, but it is real friction on old projects.
- Consumers must handle two segment shapes, with and without words, forever. That branch will be written in the planner, in any UI that shows the transcript, and in tests.
- The package takes a dependency on Zod, so it is no longer a pure zero dependency module. That was chosen deliberately over a hand written guard, but it is a cost.
- Cross origin credentialed requests are more fragile than a same origin call, and this one depends on browser cookie behaviour we do not control.

**Neutral**:

- `apps/rough-cut/AGENTS.md`'s key files table keeps describing `timebase.ts` accurately only because the shims stay. If a later change deletes the shims, that table and roughly thirteen import sites need updating together.
- Phase 1's b-roll scope was already flagged as bigger than its spec implied. This spec confirms that: it adds a route, a migration, and a UI entry inside a *different* app to a feature nominally about scaffolding B-Roll.

## Follow-up

- [ ] Amend AC-11 in `docs/specs/broll/0001-high-level-design/verify.md` to the buildable wording. As written it asks the package to import from an app, which the dependency direction forbids.
- [ ] Confirm before building task 8 that Clerk's session cookie is genuinely sent on a cross origin credentialed fetch from the B-Roll origin to `myfirstcut.app`. Multi domain SSO is configured, but a cross site request depends on the cookie's SameSite setting, which is Clerk's to set and not ours. If it does not travel, switch to the server to server variant carrying a forwarded token; that fallback is already weighed in the rationale and needs no new spec.
- [ ] Decide the concrete numbers for the byte cap and the segment count cap. They are named as rules here but not sized, and they should be set against a real ten minute transcript rather than guessed.
- [ ] Open question 1 in the B-Roll high level design (transcript staleness) stays open and stays Phase 3. This spec only reserves `edlFingerprint` for it and picks no policy.

## Rationale

Reasoning, the options weighed, and why each was rejected: see [rationale.md](rationale.md).
