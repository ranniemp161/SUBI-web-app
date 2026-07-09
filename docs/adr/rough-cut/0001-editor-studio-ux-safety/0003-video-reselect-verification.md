# Child 3 — Video Reselect Verification

## Summary

Because the source video is never stored server side, reopening a project asks the user to reselect the file. Today the picker accepts any video, so picking the wrong file silently loads it and the original transcript's timestamps get applied to an unrelated timeline, producing garbage cuts and seeks with no warning. We add a duration match check on reselect against the stored `durationMs` and block a mismatch outright.

## Context

`FilePicker.processFile` (`apps/rough-cut/src/components/file-picker.tsx:34-78`) validates only MIME type (`video/*`, line 39) and warns non-blockingly above 20 GB (line 46). It reads duration from a hidden `<video>` element (line 57-58) and calls `onFileSelected` unconditionally (line 61).

The reselect call site (`page.tsx:976-993`) renders `<FilePicker onFileSelected={(file) => setSourceFile(file)} />` when `!sourceUrl`, and does no comparison against the current project. Any file the user picks is loaded, and the original transcript's timestamps are then applied against that file's timeline.

The project's duration is already stored: `durationMs: integer("duration_ms")` (`packages/db/src/schema.ts:81`). The picker already computes the selected file's `durationMs` (`file-picker.tsx:58`). So the check needs no new schema, no migration, and no new probe: it compares two numbers that already exist.

## Options considered

**Option A — Duration match with a small tolerance, block on mismatch (chosen).**
Compare the reselected file's `durationMs` to the stored `durationMs`; if the absolute difference exceeds a tolerance, block and ask the user to pick the correct file.
Pros: uses data already present, no new storage, catches the real failure (a genuinely different video is off by seconds or more); zero added complexity. Cons: it cannot distinguish two different videos that happen to have near-identical durations; a legitimate re-encode that shifts duration past the tolerance would be wrongly rejected (rare, and the safe direction to fail).

**Option B — Content hash / fingerprint match.**
Hash the file (or a sampled fingerprint) and compare to a stored hash.
Pros: near-certain identity. Cons: requires reading the whole file to hash, storing a new field (new migration), and re-hashing on every reselect. Heavy cost and added storage for a marginal gain over duration matching, which already catches the overwhelming majority of wrong-file cases. Rejected by the engineer as too much complexity.

**Option C — Filename match.**
Compare `file.name` to a stored original filename.
Pros: cheap. Cons: filenames are renamed, copied, and re-exported constantly, so this both false-rejects the right file and false-accepts a wrong file with a coincidental or reused name. Weaker than duration on every axis. Rejected.

## Decision

On reselect, before accepting the file, compare the selected `durationMs` to the project's stored `durationMs`:

```
const TOLERANCE_MS = 1500;
if (Math.abs(selectedDurationMs - project.durationMs) > TOLERANCE_MS) {
  // block, show message, reset the picker
}
```

**Tolerance: 1500 ms.** Reselecting the same physical file decodes to the same duration, so the expected drift is essentially zero. Real drift appears only when the file was remuxed or re-encoded: different container muxing, trailing padding, or codec frame alignment typically shift measured duration by tens to a few hundred milliseconds, rarely approaching a second. 1500 ms sits comfortably above that noise floor while staying far below the error of an actually wrong video, which is almost always off by whole seconds, minutes, or the entire runtime. It is forgiving enough for a legitimate re-encode of the same content and tight enough to catch a genuinely different file.

**On mismatch: block outright.** Do not accept-with-warning. Reset the `FilePicker` (clear its input and error-to-message state) so the user can immediately try another file. Show:

> **That video does not match this project.** The file you picked is a different length than the original. Reopen this project with the same source video you transcribed, then try again.

The check applies only on the reselect (reopen) path, where a stored `durationMs` exists to compare against. The initial upload path has no prior duration and is unaffected.

## Rationale

The failure being prevented is silent and total: a wrong file loads without complaint and every downstream timestamp is meaningless. The engineer explicitly rejected warn-but-allow because an override reopens exactly that silent-garbage risk. Blocking is the correct default when the alternative is undetectable corruption of the edit.

Duration is the right signal because both numbers already exist (no new storage, no migration, no probe) and it discriminates well: a same-length wrong video is a rare coincidence, while a re-encode of the right video stays inside a tight, physically-motivated tolerance. A hash would be more certain but costs a full file read and a schema change for a gain that does not change the outcome in practice. The tolerance is derived from the actual noise source (muxing and re-encode drift), not picked arbitrarily.

## Requirements

- **AC-1**: On the reselect path, a file whose `durationMs` differs from the project's stored `durationMs` by more than 1500 ms is rejected: `onFileSelected` is not called and the file is not loaded.
- **AC-2**: On rejection, a clear message is shown stating the file does not match, and the picker is reset so the user can immediately select another file.
- **AC-3**: A file within 1500 ms of the stored duration is accepted and loads normally.
- **AC-4**: The initial upload path (no stored `durationMs`) is unchanged: no duration comparison is applied.
- **AC-5**: MIME-type validation and the existing 20 GB warning still behave as before.

## Build plan

1. Extend `FilePicker` to accept an optional `expectedDurationMs` prop; when present, compare the extracted `durationMs` in the `onloadedmetadata` handler (`file-picker.tsx:57-66`) and, on a difference over `TOLERANCE_MS`, set the error message and return without calling `onFileSelected`. (AC-1, AC-2, AC-3, AC-4)
2. Ensure the picker resets cleanly on rejection so a subsequent selection re-runs the check (clear the file input value and prior state). (AC-2)
3. At the reselect call site (`page.tsx:976-993`), pass the project's `durationMs` as `expectedDurationMs`; leave the initial-upload render without it. (AC-4, AC-5)

## Consequences

**Positive**: The most damaging silent failure in reopen (wrong-file, garbage timeline) is caught before any corruption. No new storage, migration, or probe.

**Negative / tradeoffs**: Two genuinely different videos with durations within 1500 ms of each other would pass the check, a rare blind spot duration cannot cover. A heavy re-encode or a trimmed copy that shifts duration past 1500 ms would be wrongly rejected even though it is "the same" content; the user would have to reselect the original untrimmed file, which is the intended source anyway.

**Neutral**: No migration; `durationMs` already exists. Applies only on reselect. Fully revertable in one commit.

## Follow-up

- Known blind spot: same-duration different videos. If this ever bites in practice, a lightweight second signal (file size within a band, or a sampled fingerprint of the first few seconds) could be layered on without going to a full content hash.
- If users routinely reopen with trimmed or re-encoded exports rather than the true original, revisit the tolerance or the block-outright stance; today the design assumes reopen means the same source file.
