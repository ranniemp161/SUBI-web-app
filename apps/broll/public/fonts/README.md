# Fonts served to the render worker

These two files exist so that **an exported clip is set in the brand faces**, and
they are the only reason `apps/broll/public/` exists at all.

## Why they are here rather than coming from `next/font`

`src/app/layout.tsx` loads Space Grotesk and DM Sans through
`next/font/google`, which self-hosts them into the build under a content-hashed
name with no stable public URL. The DOM gets them; the **render worker cannot**.

A worker's `OffscreenCanvas` resolves font families against `self.fonts`, which
starts empty and which nothing on the page can populate on its behalf. So naming
`"Space Grotesk"` in a canvas `font` string renders correctly in the on-page
preview and silently falls back to a system face in the encoded MP4 — and the
preview disagreeing with the export is the exact failure `render/renderable.ts`
exists to prevent.

Serving the files ourselves gives both the page and the worker one stable URL to
register a `FontFace` against. See `src/lib/render/fonts.ts`.

## What these files are

| File | Family | Axes | Subset |
|---|---|---|---|
| `space-grotesk-latin-var.woff2` | Space Grotesk | `wght` 300–700 | latin (U+0000–00FF) |
| `dm-sans-latin-var.woff2` | DM Sans | `wght` 100–1000, `opsz` 9–40 | latin (U+0000–00FF) |

Variable rather than one file per weight: the renderer uses 400, 600 and 700
today and a design pass may want others, and two variable files are smaller than
six static ones (85 KB together).

**Latin only, deliberately.** The clip renderer burns the speaker's own words on
screen, so a transcript in a language outside this subset will fall back to a
system face for the characters it lacks. Widening it is adding a subset file
here and a second `FontFace` per family — worth doing the day a non-latin
transcript is a real case, and not before, because every extra subset is bytes
every render waits on.

## Provenance

Downloaded 2026-08-17 from the URLs Google Fonts' own CSS API serves for these
families:

```
https://fonts.gstatic.com/s/spacegrotesk/v22/V8mDoQDjQSkFtoMM3T6r8E7mPbF4Cw.woff2
https://fonts.gstatic.com/s/dmsans/v17/rP2Hp2ywxg089UriCZOIHQ.woff2
```

## Licence

Both families are licensed under the **SIL Open Font License 1.1**, which
permits this bundling and redistribution.

- Space Grotesk — © Florian Karsten. <https://fonts.google.com/specimen/Space+Grotesk/license>
- DM Sans — © Colophon Foundry, Jonny Pinhorn, Indian Type Foundry.
  <https://fonts.google.com/specimen/DM+Sans/license>

**The full `OFL.txt` for each family is not vendored here yet, and it should
be.** The OFL asks that the licence text travel with the font. Fetching both
failed on the day these landed — `raw.githubusercontent.com` rate-limited during
a GitHub incident and jsDelivr refuses to serve from `google/fonts` because the
repository exceeds its size cap — so this note records the position rather than
leaving a silent gap. Copy `ofl/spacegrotesk/OFL.txt` and `ofl/dmsans/OFL.txt`
from <https://github.com/google/fonts> into this directory when convenient.
