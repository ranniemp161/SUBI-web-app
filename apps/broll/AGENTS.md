# B-Roll Generator (apps/broll)

## Overview
Takes a timed transcript and a photo of the creator, and returns a folder of
short, timecode-named B-roll clips ready to drag into an NLE. The transcript
comes from Rough Cut's export, so this is the second half of one workflow rather
than a separate product. **The output is not a finished video**: it is a batch of
independent 4 to 8 second assets that slot into an edit already in progress.

Runs on port **3003**. Shares the Clerk instance and the Neon database with
`apps/rough-cut` and `apps/wallet`; deep-links to Wallet for every top-up and
never processes a payment itself.

**Status: Phase 1 complete.** A user can create a project by uploading a
transcript or inheriting one from Ruff Cut, and see its parsed segments. Nothing
generates, plans, or renders yet.

## Key files
| File | Owns |
|---|---|
| `src/proxy.ts` | Clerk auth gate plus the public-route allowlist (landing page and the sign-in pages only). Everything else needs a session, because every row here is scoped by `user_id`. Named `proxy.ts`, not `middleware.ts` — Next.js 16 renamed it |
| `src/lib/env.ts` | Validated cross-app URLs (`ROUGH_CUT_URL`, `WALLET_URL`) — the only place allowed to read `NEXT_PUBLIC_*` cross-app vars. Throws at import time in production if unset |
| `src/app/dashboard/page.tsx` | The project list. The **explicit column list is load-bearing**, see Conventions |
| `src/app/globals.css` | This app's local surface treatment on top of `@repo/ui`'s ecosystem tokens. Dark only, no light mode |
| `src/app/actions.ts` | The two intake paths, `createProjectFromUpload` and `importFromRoughCut`. **May export nothing but async functions, not even a type** — `actions.test.ts` guards that, see the root AGENTS.md for what it cost Rough Cut |
| `src/lib/projects.ts` | Every `broll_projects` query, and the home for this feature's shared types (they cannot live in `actions.ts`) |
| `src/lib/styles.ts` | The character styles, pure so the client form can import it without pulling server code into the browser |

## Commands
```bash
npm -w @repo/broll dev         # next dev -p 3003 (port pinned, Turbopack — same as the build)
npm -w @repo/broll test        # vitest run
npm -w @repo/broll typecheck
```

## Conventions
- **Never select `broll_projects.transcript` in a list query.** It holds a
  document of up to 5 MB and no list displays it, so a page of twelve projects
  that selects it moves tens of megabytes over the Neon HTTP driver (spec
  `broll/0002` AC-39). Nothing in the database enforces this; it is a
  convention, which is exactly why it is written down.
- **Money never moves here.** Every charge, hold, settle and refund goes through
  `@repo/billing`, and every purchase deep-links to the Wallet app. This app
  contains no Stripe integration and must never gain one.
- **Cross-app URLs go through `src/lib/env.ts`**, never a raw `process.env`
  read: Next.js inlines `NEXT_PUBLIC_*` by literal name at build time.
- **Dark only.** There is no light mode. The hover state shifts *hue* (Key
  Yellow to Interactive Blue), not lightness — that is the established
  ecosystem behaviour, not a bug to fix. Text on yellow is `#111111`, because
  white on yellow fails contrast.
- Rendering is client-side (WebCodecs in a Worker) by design: no render queue,
  no ffmpeg, and export is free to the user because it costs us nothing.

## Gotchas
- **The Ruff Cut handoff is server to server on purpose, and must stay that way.**
  B-Roll gets its own domain rather than a subdomain, so in production it is
  genuinely cross site with `myfirstcut.app`. A credentialed cross origin fetch
  from the browser would therefore depend on the `SameSite` value Clerk puts on
  its session cookie, which is Clerk's setting and not ours. `importFromRoughCut`
  instead fetches from b-roll's **server**, carrying a forwarded Clerk session
  token: no cookie, no CORS, nothing to depend on. It works because all three
  apps share one Clerk instance, and Rough Cut still runs its own owner check, so
  b-roll cannot reach a project the signed in user does not own.
  - Do not "simplify" this into a browser `fetch` with `credentials: include`.
    It would appear to work locally and fail in production, because
    `localhost:3000` and `localhost:3003` are different origins but the **same
    site**, and `SameSite` is site based.
- **Segment granularity differs by intake path.** Measured on real transcripts:
  a Ruff Cut handoff gives roughly one segment per 12 seconds (utterances, with
  word timings and an exact frame rate), an uploaded subtitle file gives one per
  2 seconds (caption cues, no word timings, no frame rate). Both are correct, and
  `@repo/transcript` is deliberate about not merging cues into utterances it
  cannot measure. The planner assumes the utterance shape, so this is a Phase 3
  decision, not a bug. See the b-roll scope's decision debt.
- **B-Roll must be registered as a satellite domain in the Clerk Dashboard
  before it can run in production.** There is no `isSatellite` setting anywhere
  in this repo's source — the multi-domain SSO set is configured entirely in
  Clerk's Dashboard, so this step is invisible to the codebase, to tests, and to
  CI. Local development needs none of it: a Clerk development instance handles
  several localhost ports, which is how rough-cut (3000) and wallet (3001)
  already coexist.
- **The production domain is still undecided**, and it is what blocks deploying
  this app. Founder's Frame cannot supply it: that app is a fully static export
  (`output: 'export'`, no API routes), so it can link to b-roll but never host
  it. See open question 4 in the high level design.
- `rough-cut`'s `BROLL_URL` is deliberately **optional**, resolving to `null` in
  production when unset, because this app has no production domain yet. Null
  means no cross-origin caller is authorized on Rough Cut's transcript route,
  never a wildcard.

## Related specs
- `docs/specs/broll/0001-high-level-design/index.md` — how this app sits in the
  monorepo, the money flow, and the open questions that still gate it.
- `docs/specs/broll/0002-data-model/index.md` — every column of `broll_projects`,
  `broll_assets` and `broll_scenes`, reconstructed after the original spec was
  lost. Its `rationale.md` marks each part Decided or Inferred.
- `docs/specs/broll/design-prompt.md` — the UI brief: eight screens, the exact
  palette, and the one UX principle everything follows.

_Drafted by /develop from the scaffolding change, worth a quick human pass._
