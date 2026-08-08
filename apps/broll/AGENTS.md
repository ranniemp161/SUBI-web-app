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

**Status: scaffold only.** The app boots, gates on Clerk, and lists projects
from `broll_projects`. Nothing generates, plans, or renders yet.

## Key files
| File | Owns |
|---|---|
| `src/proxy.ts` | Clerk auth gate plus the public-route allowlist (landing page and the sign-in pages only). Everything else needs a session, because every row here is scoped by `user_id`. Named `proxy.ts`, not `middleware.ts` — Next.js 16 renamed it |
| `src/lib/env.ts` | Validated cross-app URLs (`ROUGH_CUT_URL`, `WALLET_URL`) — the only place allowed to read `NEXT_PUBLIC_*` cross-app vars. Throws at import time in production if unset |
| `src/app/dashboard/page.tsx` | The project list. The **explicit column list is load-bearing**, see Conventions |
| `src/app/globals.css` | This app's local surface treatment on top of `@repo/ui`'s ecosystem tokens. Dark only, no light mode |

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
