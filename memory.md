# Memory — Landing page redesign (Figma design → live page) + copy honesty pass

Last updated: 2026-07-04 (late evening)

## What was built

All in the working tree — **NOT committed yet** (`src/app/page.tsx`,
`ui-registry.md`, `memory.md` modified).

### Landing page rebuild (`src/app/page.tsx`)
- Rewrote the whole page to match the user's design file ("Ruff Cut
  Landing.html", a bundled Figma/Claude-design export they attached in chat).
  Copy was preserved verbatim except the honesty corrections below.
- New look: fixed dark-navy marketing palette (`#070B12` bg, `#4D8DFF`/`#7EB2FF`
  accent), fonts **Bricolage Grotesque** (display) / **Instrument Sans** (body) /
  **IBM Plex Mono** (labels) loaded via `next/font` *inside page.tsx* so they
  only ship on this route.
- New design elements: hero app mockup (window chrome, transcript with
  strikethrough retakes + RETAKE/SILENCE chips, "Suggested cuts" panel,
  sine-generated waveform strip), three-steps section with mono 01/02/03,
  gradient feature cards, privacy card with disk→cloud→disk flow diagram,
  bottom CTA with struck-through "dead air".
- Page stays a **server component, zero client JS** — FAQ uses
  `<details name="faq-accordion">` (native exclusive accordion, first item
  `open`). Tradeoff: no open/close height animation.

### Copy honesty pass (user explicitly asked for non-deceptive copy)
- **Gated CTAs** (sign-up requires an access code before Clerk even creates the
  account, so "Get Started Free" was misleading): nav → "Get access", both big
  CTAs → "Get started with your code", hero note "Invite-only · access codes
  via the Skool community", bottom note "Have a code from the Skool community?
  Enter it when you create your account." (all from the design's gated variant,
  which was its default).
- **Internet FAQ** rewritten: exports can fail if you go offline mid-session
  (app is served from the web; mediabunny is bundled but worker chunk/session/
  saves need network). Old copy claimed exporting is fully local/offline.
- **4K FAQ**: now discloses 4K is "our least-tested path" (per LIMITATIONS.md
  "not yet verified end to end"); points to the 1080p/720p export selector.
- **Descript FAQ**: removed "there's no timeline" (the studio has one) →
  "editing is text-first — the timeline is there to show your cuts"; and
  "your media never sits in anyone's cloud" → "your video" (audio sits in Blob
  briefly).
- Verified-and-left-alone: "video never leaves your computer" (true),
  MP4-only formats claim (the conservative/honest option), Chromium-only note,
  re-select-file FAQ, "in minutes" headline (fair marketing claim).

### ui-registry.md
- Appended **"Marketing / landing surface — Established 2026-07-04"** section:
  full palette/typography/component recipes for the landing design language.
- Updated the accent note: app now has **three** accent treatments — editor
  violet, dashboard/auth Tailwind blue, landing custom `#4D8DFF`. Rule: match
  the surface you're on.

## Decisions made

- Landing uses a **fixed dark-only palette with arbitrary hex values**, NOT the
  `background`/`foreground` theme tokens — intentional, marketing-only; don't
  carry into editor/dashboard.
- Landing fonts scoped to the route (loaded in page.tsx, not layout.tsx) so
  Geist stays the app-wide font.
- Adopted the design's **gated** copy variant (its `gatedAccess` default was
  true) — aligns marketing with the real invite-gated signup.
- Kept FAQ zero-JS; offered a client component only if the user wants the
  open/close animation.

## Problems solved

- **Screenshot verification on Windows**: `chrome.exe --headless=new
  --window-size=1440,6200 --screenshot=...` captures the full page (no
  chromium-cli/playwright browsers installed). Anchor-URL screenshots (`/#faq`)
  race the scroll and come out black — instead crop the tall full-page PNG with
  PowerShell `System.Drawing` `Bitmap.Clone`.
- The design HTML's template has mojibake (`â`, `ââ`) — those are em dashes,
  middots, `→`, `⇅`, curly quotes; use real characters.
- `<details name="...">` works in React 19 / Next 16 for a no-JS exclusive
  accordion (typechecks fine).

## Current state

- Landing redesign complete and visually verified section-by-section against
  the design via headless-Chrome screenshots. Typecheck passes; all 152 tests
  pass. Dev server may still be running on :3000 from this session.
- **Nothing committed** — the user hadn't signed off on a commit yet.
- Prior feature (hybrid AI rough cut, `b7280aa`) unchanged: user has STILL not
  reviewed a full AI+hybrid cut end-to-end in the studio.

## Next session starts with

1. User eyeballs the redesigned landing page in a browser; then commit the
   redesign (`src/app/page.tsx` + `ui-registry.md`).
2. Carried over: user reviews a full hybrid cut in the studio (JZ or 0615
   project: AI Cut → Re-run rough cut); tune prompt rules /
   `PHRASE_PAUSE_SECONDS` from real misjudgments.
3. Then the standing production list: access-code rotation fix (architecture
   undecided) → Vercel deploy (add `GEMINI_API_KEY` env, run
   `drizzle/manual/0002` on prod DB, callback-mode e2e) → 4K/HEVC export
   verification (now also promised implicitly by the 4K FAQ wording).

## Open questions

- FAQ open/close animation: wanted? (needs a small client component.)
- Unify the three accent colors someday? The landing's `#4D8DFF` is the
  strongest brand candidate if so.
- Idea (not planned): preload the export-worker chunk when the studio opens so
  a brief offline drop mid-session can't block starting an export.
- Carried over: is `retake-detection.ts` still earning its place vs the AI
  pass; R2-vs-Blob client conversation; orphaned "ruffcut" Blob store; prod
  Neon migration; Vercel passkey issue.
