# Scope: Founder's Frame

The public marketing site for the SUBI ecosystem. It tells the brand story, sends
visitors into the products (Ruff Cut, the Wallet), and runs the mentorship booking
flow. A fully static export: no accounts, no database, no API.

**Build approach:** Tracer Bullet (vertical slices; each feature built end to end
through every layer, working).
**Workflow:** Alpha (after `/develop`, run `/check verify`). This app carries no
feature level test suite: a static export with no data layer has little unit
surface, so the browser pass is the check that carries the meaning here. That is a
statement about `/test`, not about CI. The repo wide gates still apply and are not
optional: `lint` and `typecheck` run for this workspace in the required `check`
job, and this app's Vercel production build is a required check on `main` too.
Turbo runs no `test` task here only because the workspace declares no `test`
script; adding one puts it straight into the gate. A feature's own tier tag (e.g.
`· Beta`) overrides the tier, never the gates.

_You are in charge. Every box below is a suggestion, not a gate: run any, skip
any, and mark a feature `done` when you decide it is._

## At a glance

| # | Feature | Phase | Status |
|---|---------|-------|--------|
| A | Mentorship section | Existing | existing |
| B | Legal and story pages | Existing | existing |
| 1 | Founder's Frame Landing Page | Slice 1 | done |
| 2 | Real Product Screenshots for Landing Page | Slice 2 | planned |

## Existing

Shipped off plan, with no scope row at the time. Confirmed from the code, so they
carry no task list. `/develop` and `/sync` leave `existing` rows alone.

### A. Mentorship section · existing
Migrated in from a standalone mentorship app, which was retired in the same change
(PR #70): the mentorship pitch page, the application page with the Calendly
booking widget mounted on it, and a redirect keeping the older `/mentorship/form`
link working.
**Done when:** a visitor can read the mentorship offer and book a call without
leaving the site, and no standalone mentorship app remains.
code in `src/app/mentorship/`, `src/components/CalendlyWidget.tsx`

### B. Legal and story pages · existing
The Privacy Policy and Terms of Service pages, plus the About page carrying the
founder story, added across several commits alongside the story redesign.
**Done when:** the site has the legal pages a real product needs, reachable from
the footer, and an About page that carries the brand story.
code in `src/app/privacy/page.tsx`, `src/app/terms/page.tsx`, `src/app/about/page.tsx`, `src/components/Footer.tsx`

## Slice 1

### 1. Founder's Frame Landing Page · done

**Intent**: Build the Founder's Frame static landing page using Next.js 16 to showcase our products and drive conversions.
**Done when**: The site is successfully exported as a static build and deployable to Vercel with all sections (Hero, Showcase, Features, Footer) rendering correctly.

- [x] Design it (spec) [0001](../../specs/founders-frame/0001-founders-frame-landing-page.md), [0002](../../specs/founders-frame/0002-founders-frame-landing-page-design-and-copy.md)
- [x] Build it: /develop Founder's Frame Landing Page
  - [x] Scaffold Next.js 16 app and configure output export (AC-3)
  - [x] Integrate packages/ui and implement page sections (AC-1)
  - [x] Wire up CTA deep-links and custom 404 page (AC-2, AC-4)
- [x] Verify it: /check verify Founder's Frame Landing Page
- Test it: no feature level tests, deliberately. This app has no test files of its
  own, so the Alpha tier closes on `/check verify`. If the cross app call to action
  links ever need locking down, that is the test worth writing first.

This is not an exemption from CI. The workspace still runs lint and typecheck in
the required `check` job, and its Vercel production build is a required check on
`main`, so a broken build cannot merge. Type errors fail that build as of
2026-07-28.

## Slice 2

### 2. Real Product Screenshots for Landing Page `from spec 0002` · needs a decision

**Intent**: Replace abstract UI mockups with actual Ruff Cut screenshots once the product matures.
**Done when**: The landing page displays real UI screenshots of the Ruff Cut product in action.

- [ ] Design it (spec): `/architect real product screenshots`

Worth knowing before starting: Rough Cut's editor is mid change. Three features
(Studio auto cut flow, Transcript and Timeline Live Sync, Frame Accuracy) are
in-progress and two of them are waiting on a live browser pass. Screenshots taken
now would be of a UI that is about to move. Landing this after those close means
shooting it once.

## Legend

- **Next step** = the first unticked box.
- **needs a decision** = run `/architect` first; otherwise straight to `/develop`.
- **Status** `planned` → `in-progress` → `done`, plus `existing` (shipped off plan
  or before this scope, `/develop` and `/sync` leave it alone) and `dropped`.
- **Workflow tier tag** beside a heading (e.g. `· Beta`) overrides the project
  default for that one feature; no tag means it inherits.
