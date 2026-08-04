# Verify: B-Roll Generator high level design · spec 0001 · updated 2026-08-04

_Acceptance criteria derived from the HLD and from Phase 0's measured results.
`/check verify` runs these; `/test` locks the durable ones._

Phase 0 criteria (AC-1 to AC-6) are **already met** and are recorded here so a
later regression is detectable. AC-7 onward are gates for the build phases and
cannot pass until the code exists.

---

## Phase 0 — spikes · COMPLETE

- [x] AC-1 — A Web Worker encodes synthesized `OffscreenCanvas` frames to H.264.
      Measured: `avc1.640028`, 180 chunks, 651 KB, 1791 ms for 6 s @ 1080p30.
- [x] AC-2 — The encoder config is chosen by probing a candidate list at runtime,
      not hardcoded. A level-3.1 string cannot encode 1080p and produced a false
      "unsupported" in the first Phase 0 run.
- [x] AC-3 — `@imgly/background-removal` produces clean edges on Gemini-generated
      characters in **every style shipped**. Verified at ≥4× zoom on `#000000`,
      not on a checkerboard, for `anime` and `3D render`. ~4 s/image steady state.
- [x] AC-4 — Character identity holds across a full 6-emotion set, with later
      turns anchored on the previous *output* image and the style description not
      restated. ~110 s per set.
- [x] AC-5 — A transcript that quantifies only vaguely ("most", "a huge share",
      "skyrocketed") yields **no chart**: `chart: null`, `visual_type: "text"`.
- [x] AC-6 — A chart whose `source_span` is not a verbatim transcript substring,
      or whose values are not stated in that span, is rejected server-side.
      Timecode digits do not count as stated numbers.

## Commands

- [ ] `npm run lint` → passes
- [ ] `npm run typecheck` → passes
- [ ] `npm run test` → passes, including `packages/transcript` and `apps/broll`
- [ ] `gh api repos/:owner/:repo/branches/main/protection --jq '.required_status_checks.contexts'`
      → includes the new `Vercel – subi-web-app-broll` context → AC-20

---

## Phase 1 — skeleton

- [ ] AC-7 — `apps/broll` runs on port **3003** and resolves every cross-app URL
      through `src/lib/env.ts`; no raw `process.env.NEXT_PUBLIC_*` read exists in
      the workspace.
- [ ] AC-8 — Schema migration adds `broll_projects`, `broll_assets`,
      `broll_scenes`. No table named `projects`, `assets`, `scenes`, or `users` is
      added or altered in a way that collides with rough-cut's.
- [ ] AC-9 — `broll_projects.source_project_id` is a **nullable** FK to
      `projects.id` with `onDelete: "set null"`. Creating a b-roll project from an
      uploaded SRT, with no rough-cut project, succeeds.
- [ ] AC-10 — `credit_ledger` has a nullable `broll_project_id` FK plus a CHECK
      that at most one of `project_id` / `broll_project_id` is non-null. Inserting
      a row with both set fails.
- [ ] AC-11 — `@repo/transcript` exists, is imported by **both** rough-cut and
      b-roll, and re-exports the frame math from rough-cut's `timebase.ts` /
      `frame-math.ts` rather than reimplementing it.
- [ ] AC-12 — rough-cut exports a timed transcript JSON that is **post-EDL** and
      word-level. A clip claiming 2:35 corresponds to 2:35 on the creator's final
      cut, verified against a 29.97 drop-frame source.
- [ ] AC-13 — A production domain is configured and registered in Clerk's
      multi-domain SSO. A missing URL env var throws at import time.

## Phase 2 — character pipeline

- [ ] AC-14 — Generation debits credits via **reserve → generate → settle**, not
      check-then-act. Forcing a concurrent spend between reserve and settle never
      results in a paid Gemini call against an overdrawn balance.
- [ ] AC-15 — A repeated Generate request (double-click, retry) is rejected by the
      `gen_claim_at` atomic claim and charges once, not twice.
- [ ] AC-16 — Every ledger row written by b-roll populates `cost_micros`.
- [ ] AC-17 — Image bytes never traverse a Vercel Function: uploads and downloads
      use presigned R2 URLs. Network inspection during a full character set shows
      no image payload on an `/api/*` route.
- [ ] AC-18 — Stored cutouts are alpha-trimmed. A stored PNG's dimensions match
      the character's bounding box, not the generation frame.
- [ ] AC-19 — No JPEG intermediate exists anywhere between Gemini and R2.
- [ ] AC-20 — The review gate previews cutouts on the **scene background** by
      default, with a background toggle available.
- [ ] AC-21 — Variants populate progressively as each turn completes; the UI never
      shows an unqualified spinner for the full ~110 s.
- [ ] AC-22 — The reference photo is not persisted. No R2 object and no DB row
      retains it after generation completes.

## Phase 3 — planner

- [ ] AC-23 — The prompt's output-shape section is **generated from the schema**
      (or a `responseSchema` is passed). Adding a field to the schema without
      touching prose changes the model contract.
- [ ] AC-24 — A plan containing one malformed scene returns the remaining valid
      scenes plus a visible rejection, rather than failing wholesale.
- [ ] AC-25 — Planning debits credits on **re-runs only**; the first run of a
      project is bundled.
- [ ] AC-26 — `/api/plan` is rate-limited per user via `@repo/server-shared`.
- [ ] AC-27 — Model availability is checked at runtime with a clear error. A
      retired model ID surfaces as an actionable message, not a raw 404.
- [ ] AC-28 — Selectivity tuned against at least one real ten-minute transcript;
      the `× 1.2` multiplier is either confirmed or changed with a recorded reason.

## Phase 4 to 6 — render and export

- [ ] AC-29 — WebCodecs support is feature-detected **at load** and refuses
      clearly. Nothing fails mid-export after credits are spent.
- [ ] AC-30 — Worker errors reach Sentry.
- [ ] AC-31 — A render that fails after generation was paid for follows a stated
      refund path; a retried refund cannot double-credit.
- [ ] AC-32 — One scene failing does not block the batch; that scene retries alone.
- [ ] AC-33 — Exported filenames carry the timecode (`scene_04__02-35.mp4`).
- [ ] AC-34 — Charts render values with their `unit`. A transcript saying "80%"
      never produces a chart labelled `80`.
- [ ] AC-35 — Export is free. No credit is debited by rendering or downloading.
- [ ] AC-36 — Top-up deep-links to the Wallet app and returns; b-roll contains no
      Stripe integration.

---

## Security

- [ ] AC-37 — Every API route authorises server-side against the Clerk session and
      scopes queries by `user_id`. No route accepts a `user_id` from the client.
- [ ] AC-38 — No cross-user asset or project access under any code path, including
      by guessing an R2 key or a project id.

---

## Notes on coverage

AC-1 through AC-6 were verified in a throwaway prototype outside this repo,
deleted after the findings were folded into [rationale.md](./rationale.md). They
are listed here so that a Phase 4 regression — a codec change, a new style, a
prompt edit that weakens the chart guarantee — is caught rather than assumed.

**AC-5 and AC-6 are the ones worth re-running whenever the planner prompt or model
changes.** Every other failure in this product is visible; a fabricated statistic
rendered as a clean bar chart is not, and it publishes under the creator's name.
