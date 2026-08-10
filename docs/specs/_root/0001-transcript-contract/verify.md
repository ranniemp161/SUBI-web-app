# Verify: 0001 transcript contract

Checked by `/check verify`. Each box maps to an acceptance criterion in [index.md](index.md).

## Package and frame math

- [x] **AC-1** `packages/transcript` exists and is a workspace dependency of `apps/rough-cut`. Searching the repo for a second definition of `formatTimecode`, `toFrames`, `snapToStandardFps`, `isDropFrame`, `nominalFps`, `minClipSeconds`, `secondsToFrame`, `msToFrame`, `frameToSeconds`, `frameToMs`, or `frameDurationSeconds` finds exactly one each, all inside the package. _Checked 2026-08-10: all eleven return exactly one definition, six in `src/timebase.ts` and five in `src/frame-math.ts`. `@repo/transcript` is a dependency of both `apps/rough-cut` and `apps/broll`._
- [x] **AC-2** `apps/rough-cut/src/lib/frame-math.ts` and `apps/rough-cut/src/lib/export/timebase.ts` still exist and only re-export. `npm run typecheck` and `npm run test` pass with no import site edited beyond those two files. The moved tests run from the package. _Checked 2026-08-10: both files are a doc comment plus one `export { … } from "@repo/transcript/…"`, no logic. `lint`, `typecheck` and `test` green across all nine workspaces (1,098 tests)._

## Document shape

- [ ] **AC-3** The package exports one Zod schema, and the exported TypeScript type is inferred from it (`z.infer`), not declared separately.
- [ ] **AC-4** A document produced from a real project contains `version`, `fps`, `duration`, `generatedAt`, `wordsAligned`, `source`, and `segments`. Times are seconds. The first segment's `start` is at or near zero, not at the source's embedded start timecode.
- [ ] **AC-5** A Rough Cut export has `words` on its segments. An imported SRT has segments with no `words` key. A WebVTT file containing inline cue timestamps produces segments that do have `words`.
- [ ] **AC-6** In an imported document, `fps` is `null` and no word carries a `confidence` key. Confirm the key is absent, not present with a value.
- [ ] **AC-14** A document with `segments: []` passes schema validation and parses without error.

## Frame rate

- [ ] **AC-7** Open a project, reselect the source file, and confirm `projects.source_fps_num` and `source_fps_den` are written. For a 29.97 source they read 30000 and 1001, not 30 and 1.
- [ ] **AC-10** For a project whose fps columns are null, `GET /api/projects/:id/transcript` refuses and the message names the fix (reselect the source file in Rough Cut). It does not return a document.

## Export surfaces

- [ ] **AC-8** The export modal lists the transcript JSON beside FCPXML, CMX 3600, and FCP7 XML. Before reselecting a source it is disabled with a visible reason; after reselecting it enables with no reload.
- [ ] **AC-9** The document downloaded from the modal and the one returned by the route, for the same project and the same EDL, are identical in every field except `generatedAt`. Compare with that one field excluded; it is a clock read and will differ by design. A second signed in user requesting that project's transcript is denied.
- [x] **AC-15** The route responds to the B-Roll origin with credentials allowed and that origin named explicitly. Confirm no wildcard origin, and confirm no new secret was added to `.env` or to `turbo.json`'s build `env` array. _Driven live 2026-08-10 against `next dev` on :3000. `OPTIONS` with `Origin: http://localhost:3003` → **204**, `access-control-allow-origin: http://localhost:3003` (the exact origin, no wildcard), `access-control-allow-credentials: true`, `access-control-allow-methods: GET, OPTIONS`, `vary: Origin`. A foreign origin → **403**, a missing origin → **403**, `GET` signed out → **401**. No `BROLL` entry in `turbo.json`, and none needed: the var is `NEXT_PUBLIC_`, not a secret._
  - **This contradicts a gotcha recorded in `apps/rough-cut/AGENTS.md` and in the b-roll scope**, both of which say that under `next dev` every `OPTIONS` on this route answers `404` regardless of origin (measured 2026-08-08). It no longer reproduces: the specced behaviour holds exactly, in dev, today. The first attempt did return nothing, but that was a 5 second curl timeout against a route compiling for the first time, not a 404. Worth re-checking before anyone acts on that note.

## Timing correctness

- [ ] **AC-11** On a project with a razor cut placed through the middle of a word, that word appears in the document with its span clamped to the kept side. Place a second cut leaving under one frame of a word and confirm that word is absent. Place two cuts inside a single word and confirm it appears once, as the larger surviving fragment, not twice.
- [x] **AC-16** Search `packages/transcript` for any reference to the EDL type, to `segments` with a `status` field, or to cut handling of any kind. There should be none. The collapse lives in `apps/rough-cut` and the package receives times that are already post cut. _Checked 2026-08-10: eight non test matches for `EDL`, all of them prose in doc comments stating the package deliberately does not know what an EDL is. No import of the type, no `status` field, no cut handling._
- [ ] **AC-12 (boundaries)** A kept range spanning two Deepgram utterances yields two segments. Each segment boundary equals the `end` of a real word, not the raw `utteranceEnd` value it was derived from. A kept range too short to hold any surviving word emits no segment at all, though its length still counts toward `duration`.
- [ ] **AC-4 (fingerprint)** Build the same project's document twice and confirm `edlFingerprint` matches. Then trigger a write that touches the project row but no EDL segment (an AI Cut run sets `updated_at`) and confirm the fingerprint still matches. Finally change one cut and confirm it changes.
- [ ] **AC-12** The load bearing check, and it needs a real 29.97 drop frame source. Cut a video so that a known phrase sits at 2:35 on the final timeline. Export the transcript, take that phrase's start time, format it through `formatTimecode` at the document's fps, and confirm it reads `00:02:35;NN` with the drop frame separator. Then scrub the exported cut in a player to 2:35 and confirm the same phrase is being spoken. Also confirm no time in the document falls inside a cut range and that times never decrease.

## Limits

- [ ] **AC-13** An upload over the byte cap is rejected and the message names the byte limit. A file under the byte cap but over the segment count cap is rejected and the message names the count limit. The two messages are distinguishable.

---

## Value sourcing, one step per row

_Added by `/develop`, 2026-08-05. The section above proves the criteria; this
one proves each produced value really comes from the source the spec named.
A value read from the wrong place can satisfy every criterion above and still
be wrong, so each step varies the input that would expose a mis-sourced value._

- [ ] `fps`, route path → Set `projects.source_fps_num` / `source_fps_den` to 24 and 1 on a project whose real source is 29.97, then call the route. The document reports 24/1, proving the route reads the stored columns and not a re-detection or a default. Restore the real values afterwards. → **AC-7**, **AC-10**
- [ ] `fps`, download path → With the same project open, the modal download reports the real detected 30000/1001 from session state. The two paths reading two different sources for the same field is the expected result of that experiment, and is why AC-9's comparison is run on a project whose stored and detected rates agree. → **AC-8**
- [ ] `duration` → Cut 30 seconds out of a 2 minute video. `duration` reads 90, not 120, and not the transcript's own `duration` field. Then cut a range containing no words at all and confirm `duration` still drops by that range's length — duration is runtime, not speech. → **AC-4**
- [ ] `generatedAt` → Two builds seconds apart differ in this field and in no other. → **AC-9**
- [ ] `wordsAligned` → Export before the word boundary refinement pass has run: `false`. Export after it completes: `true`. It tracks the `projects.words_aligned` column, not whether words happen to be present. → **AC-4**
- [ ] `source.kind` / `projectId` → A Rough Cut export reads `"rough-cut"` with the real project id. An SRT import reads `"import"` with `projectId: null`. → **AC-5**
- [ ] `source.edlFingerprint` → Covered by the AC-4 fingerprint step above. Additionally reorder nothing but re-save the EDL and confirm the hash holds. → **AC-4**
- [ ] segment `start` / `end` → Place a 10 second cut at the very start of the video. Every subsequent time in the document drops by exactly 10, proving removed time is subtracted rather than raw Deepgram times being copied through. → **AC-12**
- [ ] segment boundaries → On a transcript whose `utteranceEnds` contain a value matching no word's `end`, confirm that exact value appears nowhere in the document, and that the boundary used is the nearest earlier word end. → **AC-12**
- [ ] segment `text` → A segment's `text` equals its own words joined, not the whole transcript's text and not the pre-cut text of that span. Verify on a segment where a word was cut out of the middle: the cut word is absent from `text`. → **AC-4**
- [ ] a kept range with no surviving words → Covered by the AC-12 boundaries step above.
- [ ] word `confidence` → A word's confidence in the document equals Deepgram's value for that word, unrounded and unchanged. A word whose source entry had no confidence has no `confidence` key. → **AC-6**
- [ ] import segment times → An SRT cue timed `00:00:05,500 --> 00:00:08,250` produces a segment at exactly 5.5 and 8.25. → **AC-5**
- [ ] import `words` → A WebVTT file where only some cues carry inline timestamps parses successfully, with `words` on exactly those cues and absent on the rest. Mixed precision is not an error. → **AC-5**, **AC-6**
- [ ] clip naming → A clip named from a document position uses `formatTimecode` at the document's own `fps`, and a drop frame source yields the `;` separator rather than `:`. → **AC-12**
- [ ] the export entry's enabled state → Covered by the AC-8 step above. Confirm additionally that a project with a known frame rate but nothing kept still offers the transcript: an empty transcript is valid, and the transcript gate is the frame rate alone.
- [ ] route authorization → Covered by the AC-9 step above.

## What is not built yet

These are true of the build as it stands and are not failures of the steps above.

- [ ] Spec task 9's live confirmation is still owed: that Clerk's session cookie really travels on a cross origin credentialed fetch from the b-roll origin. `NEXT_PUBLIC_BROLL_URL` is read through `env.ts` and the route allows exactly that origin, but with no b-roll app and no domain there is nothing to test against yet. Unset, the route grants no cross origin access at all — never a wildcard.
- [ ] Spec task 11 (`transcript` and `transcript_meta` on `broll_projects`) waits on the `broll_*` migration, which is blocked on its own missing column inventory.
- [ ] `MAX_DOCUMENT_BYTES` and `MAX_SEGMENT_COUNT` are placeholders sized by arithmetic, not by the measurement the spec's follow-up asks for. They live as two named constants in `packages/transcript/src/document.ts`; retuning them is a one line change.
