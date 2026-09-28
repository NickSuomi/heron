# Heron design book

Heron is a self-hosted code-review bot for GitLab merge requests. It reviews one merge request at its current head, writes one report note, and sets a verdict label. It never approves, merges, or edits code.

This book sets the rules for how Heron looks, moves, and sounds. The files it describes live next to it:

- `tokens.json` and `tokens.css` hold every colour, font, size, space, and radius value.
- `assets/` holds the mark, the lockups, the favicon, and the social preview as SVG, with PNG renders.
- `tools/build_tokens.py` writes both token files and prints the contrast tables in this book.
- `tools/build_assets.py` writes every SVG in `assets/` from one heron drawing.
- `tools/build_site.py` writes `site/public/brand/index.html`, the web version of this book, and copies the assets and fonts next to it.

To change a colour or a path, edit the script and run it. Do not edit the generated files by hand.

## The idea

The site is one face of a dark monolith. A merge request's code climbs the face as the reader scrolls and folds over the top edge. The heron stands on that edge and looks down at what comes over. Each gate is a band the code passes through. A line the heron objects to is marked once as it crosses the edge, then pinned as a finding. When the page reaches its end, the face lies flat and the verdict is what remains.

Everything in the brand serves that picture: a night-dark surface, hairline edges, one cold light, and a bird that stays still.

## Principles

1. **Stillness first.** Heron reads the whole merge request, then writes one note. The brand moves only when the reader scrolls, and the heron moves once.
2. **Point at the line.** Every finding names a path and a line at the reviewed head.
3. **Calm is a feature.** CHANGES REQUESTED is ordinary news. Colour and words report the state and do not raise the alarm.
4. **Stable words for machines.** The verdict words PASS, CHANGES REQUESTED, BLOCKED, and SUPERSEDED never change. Styling can sit next to them but never replaces them.
5. **Nothing leaves the page.** The site, the design book, and the assets load no external fonts, scripts, images, or trackers.

## Name

Write the name as "Heron" in prose and `heron` in code. Do not write "HERON", "HeronBot", or "the Heron".

| Thing | Name |
|---|---|
| Product name in prose | Heron |
| Package | `heron-review` |
| Command | `heron` (from source: `pnpm heron`) |
| Repository | `NickSuomi/heron` |

## Colour

The palette is a near-black with a slight cool tint, three raised surfaces, grey text set by opacity, and one accent. The accent is **plume** `#9097CC`, the blue-grey of a grey heron's back at dusk. It is desaturated on purpose: it reads as light on the night surface, not as a brand colour competing with the code. Plume marks exactly the things the heron looks at: a caught line, a pinned finding, the verdict, and the rim light.

### Palette

| Token | Hex | Role |
|---|---|---|
| `night` | `#08090C` | Page base |
| `night-1` | `#0E1014` | First raised surface: bands, code |
| `night-2` | `#13151A` | Cards, the heron's body |
| `night-3` | `#1A1D23` | Hover, pressed, active rows |
| `hairline` | `#1C1D1F` | 1px borders. In CSS: white at 8% |
| `hairline-strong` | `#2B2B2E` | Emphasised borders and the rim. In CSS: white at 14% |
| `frost` | `#F4F5F8` | Primary text |
| `frost-2` | `#9FA0A3` | Secondary text. In CSS: frost at 64% |
| `frost-3` | `#7E7F82` | Tertiary text. In CSS: frost at 50% |
| `frost-4` | `#454649` | Line numbers, rules, disabled. In CSS: frost at 26%. Never body text |
| `plume` | `#9097CC` | The accent |
| `plume-deep` | `#3B4070` | Accent fills and glows |
| `sage` | `#86B8A5` | PASS on night |
| `sand` | `#D2B48C` | CHANGES REQUESTED on night, outside the site |
| `rose` | `#D48F8F` | BLOCKED on night |
| `paper` | `#F7F8FA` | Light background, for README images and print |
| `paper-line` | `#DCDEE3` | Borders on light |
| `ink` | `#0D0E12` | Text on light |
| `ink-2` | `#5B5F6B` | Secondary text on light |
| `plume-ink` | `#4C5391` | Accent on light |
| `sage-ink`, `sand-ink`, `rose-ink` | `#2F6B55`, `#7A5520`, `#9A3B3B` | Verdict text on light |

The site uses plume for the CHANGES REQUESTED verdict it shows, because that verdict is what the heron found. Sage, sand, and rose exist for places that show all four verdicts side by side, such as labels and dashboards. SUPERSEDED uses `frost-2`: it is not a judgement.

### Surfaces and light

- Layer surfaces instead of drawing boxes. A card is `night-2` or a 3% to 1% white gradient, a 1px `hairline` border, and a 4% white inner highlight on its top edge.
- Borders are always 1px. Radii are 6, 10, and 14 px, plus pills.
- Light comes from one side: a soft plume radial glow where the heron stands, and a faint white beam at about 110 degrees across the sky. Glows stay under 22% opacity.
- The display headline uses gradient text from soft white to 52% white, top to bottom. The verdict word runs from soft white to plume. No other text uses a gradient.

### Theme tokens

Components use theme tokens, never palette tokens. The site is dark only. `.heron-light` in `tokens.css` supplies light values for documents and README images on white.

| Theme token | Dark | Light |
|---|---|---|
| `--heron-bg` | `night` | `paper` |
| `--heron-surface` | `night-2` | `paper` |
| `--heron-code-bg` | `night-1` | `paper` |
| `--heron-text` | `frost` | `ink` |
| `--heron-text-muted` | `frost-2` | `ink-2` |
| `--heron-text-faint` | `frost-3` | `ink-2` |
| `--heron-border` | `hairline` | `paper-line` |
| `--heron-accent` | `plume` | `plume-ink` |
| `--heron-pass`, `--heron-changes`, `--heron-blocked`, `--heron-superseded` | `sage`, `sand`, `rose`, `frost-2` | `sage-ink`, `sand-ink`, `rose-ink`, `ink-2` |

### Contrast

`tools/build_tokens.py` computes every ratio below with the WCAG 2.x relative-luminance formula. AA needs 4.5:1 for body text, AAA needs 7:1. Every text pair passes AA. Borders are decorative and carry no meaning alone.

| Theme | Text token | Background token | Text | Background | Ratio | WCAG |
|---|---|---|---|---|---|---|
| dark | `text` | `bg` | `#F4F5F8` | `#08090C` | 18.26 | AAA |
| dark | `text` | `surface` | `#F4F5F8` | `#13151A` | 16.75 | AAA |
| dark | `text` | `code-bg` | `#F4F5F8` | `#0E1014` | 17.47 | AAA |
| dark | `text-muted` | `bg` | `#9FA0A3` | `#08090C` | 7.61 | AAA |
| dark | `text-muted` | `surface` | `#9FA0A3` | `#13151A` | 6.98 | AA |
| dark | `text-faint` | `bg` | `#7E7F82` | `#08090C` | 4.97 | AA |
| dark | `accent` | `bg` | `#9097CC` | `#08090C` | 7.10 | AAA |
| dark | `accent` | `surface` | `#9097CC` | `#13151A` | 6.51 | AA |
| dark | `pass` | `bg` | `#86B8A5` | `#08090C` | 8.92 | AAA |
| dark | `changes` | `bg` | `#D2B48C` | `#08090C` | 10.10 | AAA |
| dark | `blocked` | `bg` | `#D48F8F` | `#08090C` | 7.70 | AAA |
| dark | `superseded` | `bg` | `#9FA0A3` | `#08090C` | 7.61 | AAA |
| light | `text` | `bg` | `#0D0E12` | `#F7F8FA` | 18.15 | AAA |
| light | `text` | `surface` | `#0D0E12` | `#F7F8FA` | 18.15 | AAA |
| light | `text` | `code-bg` | `#0D0E12` | `#F7F8FA` | 18.15 | AAA |
| light | `text-muted` | `bg` | `#5B5F6B` | `#F7F8FA` | 6.00 | AA |
| light | `text-muted` | `surface` | `#5B5F6B` | `#F7F8FA` | 6.00 | AA |
| light | `text-faint` | `bg` | `#5B5F6B` | `#F7F8FA` | 6.00 | AA |
| light | `accent` | `bg` | `#4C5391` | `#F7F8FA` | 6.69 | AA |
| light | `accent` | `surface` | `#4C5391` | `#F7F8FA` | 6.69 | AA |
| light | `pass` | `bg` | `#2F6B55` | `#F7F8FA` | 5.89 | AA |
| light | `changes` | `bg` | `#7A5520` | `#F7F8FA` | 6.28 | AA |
| light | `blocked` | `bg` | `#9A3B3B` | `#F7F8FA` | 6.45 | AA |
| light | `superseded` | `bg` | `#5B5F6B` | `#F7F8FA` | 6.00 | AA |

| Theme | Graphic token | Background token | Graphic | Background | Ratio | Use |
|---|---|---|---|---|---|---|
| dark | `mark-line` | `bg` | `#F4F5F8` | `#08090C` | 18.26 | pass 3:1 |
| dark | `border-strong` | `bg` | `#2B2B2E` | `#08090C` | 1.41 | decorative only |
| light | `mark-line` | `bg` | `#0D0E12` | `#F7F8FA` | 18.15 | pass 3:1 |
| light | `border-strong` | `bg` | `#DCDEE3` | `#F7F8FA` | 1.27 | decorative only |

## Typography

| Role | Family | Fallback stack | Licence |
|---|---|---|---|
| Display, headings, text | Inter, variable, with the optical-size axis | system sans | SIL Open Font License 1.1, [LICENSE.txt](https://github.com/rsms/inter/blob/master/LICENSE.txt) |
| Code, paths, verdict marker | JetBrains Mono, variable | `ui-monospace`, Menlo, Consolas | SIL Open Font License 1.1, [OFL.txt](https://github.com/JetBrains/JetBrainsMono/blob/master/OFL.txt) |

The site self-hosts both families from the `@fontsource-variable` packages. The licence texts ship with the site at `fonts/Inter-OFL.txt` and `fonts/JetBrainsMono-OFL.txt`, and next to the design book at `brand/fonts/`. With `font-optical-sizing: auto`, Inter switches to its display cut at large sizes, so there is one family for both roles.

| Token | Size | Weight | Tracking | Use |
|---|---|---|---|---|
| `--heron-size-display` | 3rem to 9.5rem | 520 | -0.045em | The one headline per page, gradient text |
| `--heron-size-2xl` | 3.5rem | 500 | -0.03em | Verdict word, section titles |
| `--heron-size-xl` | 2rem | 500 | -0.03em | Gate names, card titles |
| `--heron-size-lg` | 1.25rem | 400 | -0.011em | Lead paragraph |
| `--heron-size-base` | 1rem | 400 | -0.011em | Body |
| `--heron-size-sm` | 0.875rem | 400 | 0 | Code, tables |
| `--heron-size-xs` | 0.75rem | 500 | 0.12em | Mono labels in capitals |

Body line height is 1.6, display line height 0.95. Keep body lines under 72 characters. Headings use sentence case. Verdict words and mono labels are the only capitals. Mono type turns off ligatures and contextual alternates, so `=>` and `<!--` show as typed.

## The heron

### Drawing

The heron stands on an edge, neck in an S, head lowered, bill pointed down over the edge. It is a duotone silhouette: a `night-2` body with a 1.3 to 1.6 unit edge line in frost at about 72%, a solid bill, and legs as a single line. On dark, a faint plume glow sits behind the feet, as if the edge catches a cold light. The drawing has no eye and no pupil, and it never gets one.

`tools/build_assets.py` holds the drawing once, in a 200 by 280 unit box, facing left with its feet on y 277. The site's perch uses it as drawn, facing into the page. The mark mirrors it to face the wordmark. Those are the only two orientations.

### Mark and lockup

The mark places the heron on a 128 by 128 grid, standing on a 1.2 unit rim line at y 117.2. The wordmark `heron` is drawn as monoline paths, not set in a font, with its baseline on the same rim, so the word and the bird share one edge.

| File | Use |
|---|---|
| `assets/heron-mark.svg` | Duotone mark on light |
| `assets/heron-mark-on-dark.svg` | Duotone mark with rim glow on dark |
| `assets/heron-mark-mono-ink.svg`, `assets/heron-mark-mono-white.svg` | One-colour solid silhouette |
| `assets/heron-lockup.svg`, `assets/heron-lockup-on-dark.svg` | Mark and wordmark, light and dark |
| `assets/heron-lockup-mono-ink.svg`, `assets/heron-lockup-mono-white.svg` | One-colour lockups. The site header uses the white one |
| `assets/favicon.svg` | Solid frost silhouette on a `night` tile with a plume rim |
| `assets/heron-mark-512.png` | Raster of the dark mark, 512 by 512, transparent |
| `assets/social-preview.svg`, `assets/social-preview.png` | Repository and link preview, 1280 by 640 |

Keep one eighth of the mark's height clear on every side. The smallest mark is 24 px tall and the smallest lockup is 120 px wide. Below 24 px, use the favicon.

### Misuse

- Do not add an eye, a pupil, or a face.
- Do not colour the heron with the accent. Plume is the light around it, not the bird.
- Do not rotate, stretch, or flip it beyond the two orientations above.
- Do not set the wordmark in a font.
- Do not animate the heron flapping, walking, or idling.

## Motion

Motion follows the reader's scroll, and only that.

1. **The fold.** Canvas UI [Bend](https://canvasui.dev/docs/components/bend) folds the face out over its top and bottom edges. Each fold zone is a quarter of the viewport height and reaches 84 degrees with a rounded crease. Each edge flattens as the page nears that end of the scroll, over 70% of the viewport height. Tilt and overscroll tumble are off, so the heron stays registered on the rim.
2. **The fallback fold.** Without HTML-in-canvas, CSS scroll-driven animations (`animation-timeline: view()`) tip each line with `perspective` and `rotateX` over the same quarter-height zones.
3. **The strike.** A caught line gets one plume underline, drawn right to left in 260 ms, and its finding plate lights up over 700 ms. The heron moves once per visit: one 1100 ms strike of the neck when the blocker crosses the edge.
4. **Nothing loops and nothing autoplays.** No idle animation, no parallax, no cursor effects.
5. **Reduced motion.** With `prefers-reduced-motion: reduce`, the CSS fold and the strike are off, Bend snaps instead of easing, and every finding is shown pinned from the start. The page stays complete.

## Voice and tone

Heron writes like a patient senior reviewer who has read the whole change: calm, plain, and exact. It names the path and the line, says what happens, then suggests the fix. It never hypes, scolds, or guesses at intent.

| Do | Don't |
|---|---|
| Archive deletes the project instead of archiving it (`src/projects/archive.ts:14`). | Critical bug!!! You deleted everything. |
| The archive button is enabled with nothing selected. | Awesome work, just one tiny thing! |
| The review could not finish: session `b1.gate.spec` failed. | Something went wrong. |
| The source branch moved during the review. These results describe `abc2c194` only. | Outdated review, ignore. |

Rules:

- Say what happens to a person or a system, not how the code feels.
- One finding per point. Put the location in the finding.
- State what Heron did not check. The report has a "Not checked" section for that.
- No exclamation marks, no emoji, no "simply", no "just", no long dashes.
- Page copy only states what the Heron docs state. No invented numbers, logos, or quotes.

## The report note

Heron writes one note per merge request and updates it on the next run. The format comes from `src/report.ts`:

1. A hidden marker: `<!-- heron:v1 mr=… head=… config=… verdict=… -->`.
2. The heading `## Heron review: VERDICT`.
3. The reviewed head and lane, then the summary.
4. `### Findings`: blockers first, then advisories, each with its gate and a link to `path:line` at the reviewed head.
5. `### Not checked`, when a session reported limits.
6. Two collapsed sections: `REVIEW CHECKS` (gate status table, matched rules, plan, config digest) and `AGENT PROVENANCE` (session, role, backend, model, effort, tokens, tool calls, duration, vendor cost, result).

Model-written text is posted as escaped plain text, never as Markdown. The brand does not restyle the note. GitLab renders it.

## Labels

Heron adds the verdict label named in its config and removes the other managed labels. It does not create labels, so they must already exist in the project or a parent group. Colours are yours to choose in GitLab. These values fit the palette and carry white text:

| Label (example config) | Colour | White text |
|---|---|---|
| `review::in progress` | `#4C5391` plume-ink | 7.11:1 |
| `review::passed` | `#2F6B55` sage-ink | 6.26:1 |
| `review::changes requested` | `#7A5520` sand-ink | 6.67:1 |
| `review::blocked` | `#9A3B3B` rose-ink | 6.86:1 |

## README header

Use the lockup, centred, with a dark-mode source:

```html
<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/brand/assets/heron-lockup-on-dark.svg">
    <img alt="Heron" src="docs/brand/assets/heron-lockup.svg" width="344">
  </picture>
</p>
```

## Social preview

`assets/social-preview.png` is 1280 by 640 px. It shows the rim, the heron on it under a cold beam, the headline "Every line passes the heron.", the tagline, and the repository address. Text stays inside a 64 px margin. The SVG embeds the Latin subsets of Inter and JetBrains Mono as data URIs, so it renders the same without the fonts installed. Upload the PNG in the repository settings under **Social preview**.

## Rebuilding

1. Run `pnpm install` in `site/`. The asset and book scripts read the font files from `site/node_modules`.
2. Run `python3 docs/brand/tools/build_tokens.py` to write the token files and print the contrast tables.
3. Run `python3 docs/brand/tools/build_assets.py` to write the SVGs.
4. Render the PNGs with a renderer that loads data-URI fonts, such as headless Chromium: the mark at 512 by 512 with a transparent background, and the social preview at 1280 by 640.
5. Run `python3 docs/brand/tools/build_site.py` to write the design book page and copy the assets and fonts into `site/public/brand/`.
6. Open the PNGs and check that the heron still reads as a heron at 32 px.
