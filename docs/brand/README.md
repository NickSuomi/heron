# Heron design book

Heron is a self-hosted code-review bot for GitLab merge requests. It reviews one merge request at its current head, posts one report comment, and sets workflow labels. It never edits code, approves, or merges.

This book sets the rules for how Heron looks and sounds. The files it describes live next to it:

- `tokens.json` and `tokens.css` hold every colour, font, size, space, and radius value.
- `assets/` holds the logo, favicon, and social preview as SVG, with PNG exports.
- `tools/build_assets.py` writes every SVG in `assets/` from one set of paths.
- `tools/build_tokens.py` writes both token files and prints the contrast tables in this book.
- `tools/build_site.py` writes `site/index.html`, the one-page version of this book.

To change a colour or a path, edit the script and run it. Do not edit the generated files by hand.

## Principles

1. **Watch, then act once.** Heron reads the whole merge request, then posts one comment. It does not post a stream of partial comments, and the brand does not decorate with motion.
2. **Point at the line.** Every finding names a file and a line. A finding without a location is a note, and the report says so.
3. **Calm is a feature.** A blocked merge request is ordinary news. Colour, words, and shape report the state and do not raise the alarm.
4. **Stable words for machines, soft styling for people.** The verdict words PASS, CHANGES REQUESTED, BLOCKED, and SUPERSEDED never change. Styling can sit next to them but never replaces them.
5. **Nothing leaves the page.** The site, the comment, and the assets load no external fonts, scripts, images, or trackers.

## Name and story

A heron stands still in shallow water and watches for a long time. When it moves, it moves once, and it is exact. Heron the tool works the same way. It waits for a merge request head, reads it in full, and makes one precise report.

Write the name as "Heron" in prose and `heron` in code. Other names:

| Thing | Name |
|---|---|
| Product name in prose | Heron |
| Package | `heron-review` |
| Command-line binary | `heron` |
| Repository | `NickSuomi/heron` |
| Label prefix | `heron::` |

Do not write "HERON", "HeronBot", or "the Heron".

## Logo

### Construction

The mark is a heron standing on one leg in the shallows, drawn with one line weight. It sits on a 128 by 128 unit grid.

| Part | Construction |
|---|---|
| Stroke | 5 units, round caps, round joins. Scale the stroke with the mark. |
| Head | A crest to the rear, a round crown, and an eye dot of radius 1.6 at (74, 23). |
| Beak | A filled dagger from (82, 22) to the tip at (112, 30). It is the only filled shape. |
| Neck and body | One line: the throat, an S-curve neck, the chest, the belly, the tail at (20, 91), and the back. The back stops short of the neck. That gap keeps the drawing open and light. |
| Legs | The standing leg drops straight from (50, 80) to (50, 118) and crosses the water line. The other leg folds under the body. |
| Water | Two strokes at y 110, 3 units wide, broken where the leg enters the water. |

The wordmark `heron` is drawn with the same 5-unit monoline stroke as the mark, not set in a font. It needs no font to render, and it matches the mark's line exactly. In the horizontal lockup, the wordmark is scaled to 0.95 and its baseline sits at y 108, on the same water line as the heron.

| File | Use |
|---|---|
| `assets/heron-mark.svg` | Colour mark on light backgrounds |
| `assets/heron-mark-on-dark.svg` | Colour mark on dark backgrounds |
| `assets/heron-mark-mono-ink.svg` | One colour, ink, for print and light backgrounds |
| `assets/heron-mark-mono-white.svg` | One colour, white, for dark or photo backgrounds |
| `assets/heron-lockup.svg` | Mark and wordmark on light backgrounds |
| `assets/heron-lockup-on-dark.svg` | Mark and wordmark on dark backgrounds |
| `assets/heron-lockup-mono-ink.svg` | One-colour lockup, ink |
| `assets/heron-lockup-mono-white.svg` | One-colour lockup, white |
| `assets/favicon.svg` | Browser tab and app icon |
| `assets/heron-mark-512.png` | Raster mark, 512 by 512, transparent |
| `assets/social-preview.svg`, `assets/social-preview.png` | Repository social preview, 1280 by 640 |

### Clear space

Keep 16 units of empty space around the 128-unit box on every side. That is one eighth of the mark's height. At 64 px, keep 8 px clear. Text, other logos, and the edge of the container stay outside that space.

### Minimum size

| Asset | Smallest size |
|---|---|
| Mark | 24 px tall |
| Lockup | 120 px wide |
| Favicon | 16 px |

Below 24 px, use `favicon.svg`. It drops the eye, the folded leg, and the water line, and it thickens the stroke to 9 units on a slate tile.

### Misuse

- Do not fill the body or add a second standing leg. The drawing is one open line on one leg.
- Do not rotate, flip, stretch, or skew the mark. The heron faces right, toward the text.
- Do not colour the line anything other than `slate`, `mist`, `ink`, or white.
- Do not set the wordmark in a font. Use the drawn paths.
- Do not add shadows, outlines, gradients, or a speech bubble.
- Do not animate the heron flapping or pecking. If anything moves, it is one short fade.
- Do not place the colour mark on a background where the line falls below 3:1. Use a one-colour version there.

## Colour

The four seed colours stay as approved: Mist `#EEF2F1`, Slate heron `#4A5A6A`, Reed green `#6E8B3D`, and Beak amber `#E0A526`. Reed and amber are too light for text on Mist, so the palette adds darker text variants of each, a rust for BLOCKED, and a dark theme.

### Palette

| Token | Hex | Role |
|---|---|---|
| `mist` | `#EEF2F1` | Light page background |
| `slate` | `#4A5A6A` | Heron line, secondary text, SUPERSEDED |
| `reed` | `#6E8B3D` | Water line. Graphics only, never text. |
| `amber` | `#E0A526` | Beak, CHANGES REQUESTED fill. Never text on light. |
| `ink` | `#1F2A33` | Body text on light |
| `paper` | `#FFFFFF` | Cards and comment surfaces on light |
| `shallows` | `#E2E9E7` | Code blocks on light |
| `line` | `#C9D3D1` | Borders on light |
| `reed-deep` | `#4F6A26` | Links and PASS text on light |
| `amber-deep` | `#8A5A00` | CHANGES REQUESTED text on light |
| `rust` | `#A8432A` | BLOCKED on light |
| `night` | `#151C22` | Dark page background |
| `night-raised` | `#1E2730` | Cards on dark |
| `night-deep` | `#0F1418` | Code blocks on dark |
| `night-line` | `#33414C` | Borders on dark |
| `fog` | `#E6ECEA` | Body text on dark |
| `slate-light` | `#A7B4BF` | Secondary text and SUPERSEDED on dark |
| `reed-light` | `#9DBB67` | Links and PASS on dark |
| `amber-light` | `#E8B54A` | CHANGES REQUESTED on dark |
| `rust-light` | `#E0826B` | BLOCKED on dark |

### Theme tokens

Components use theme tokens, never palette tokens. `tokens.css` switches the theme with `prefers-color-scheme`.

| Theme token | Light | Dark |
|---|---|---|
| `--heron-bg` | `mist` | `night` |
| `--heron-surface` | `paper` | `night-raised` |
| `--heron-code-bg` | `shallows` | `night-deep` |
| `--heron-text` | `ink` | `fog` |
| `--heron-text-muted` | `slate` | `slate-light` |
| `--heron-link` | `reed-deep` | `reed-light` |
| `--heron-border` | `line` | `night-line` |
| `--heron-pass` | `reed-deep` | `reed-light` |
| `--heron-changes` | `amber-deep` | `amber-light` |
| `--heron-blocked` | `rust` | `rust-light` |
| `--heron-superseded` | `slate` | `slate-light` |
| `--heron-{verdict}-bg` and `--heron-{verdict}-on` | Badge fill and badge text | Badge fill and badge text |

### Contrast

`tools/build_tokens.py` computes every ratio below with the WCAG 2.x relative-luminance formula. AA needs 4.5:1 for body text. AAA needs 7:1. Every recommended text pair passes AA.

| Theme | Text token | Background token | Text | Background | Ratio | WCAG |
|---|---|---|---|---|---|---|
| light | `text` | `bg` | `#1F2A33` | `#EEF2F1` | 12.95 | AAA |
| light | `text` | `surface` | `#1F2A33` | `#FFFFFF` | 14.61 | AAA |
| light | `text` | `code-bg` | `#1F2A33` | `#E2E9E7` | 11.86 | AAA |
| light | `text-muted` | `bg` | `#4A5A6A` | `#EEF2F1` | 6.28 | AA |
| light | `text-muted` | `surface` | `#4A5A6A` | `#FFFFFF` | 7.09 | AAA |
| light | `text-muted` | `code-bg` | `#4A5A6A` | `#E2E9E7` | 5.75 | AA |
| light | `link` | `bg` | `#4F6A26` | `#EEF2F1` | 5.44 | AA |
| light | `link` | `surface` | `#4F6A26` | `#FFFFFF` | 6.14 | AA |
| light | `pass` | `bg` | `#4F6A26` | `#EEF2F1` | 5.44 | AA |
| light | `pass` | `surface` | `#4F6A26` | `#FFFFFF` | 6.14 | AA |
| light | `changes` | `bg` | `#8A5A00` | `#EEF2F1` | 5.25 | AA |
| light | `changes` | `surface` | `#8A5A00` | `#FFFFFF` | 5.93 | AA |
| light | `blocked` | `bg` | `#A8432A` | `#EEF2F1` | 5.31 | AA |
| light | `blocked` | `surface` | `#A8432A` | `#FFFFFF` | 6.00 | AA |
| light | `superseded` | `bg` | `#4A5A6A` | `#EEF2F1` | 6.28 | AA |
| light | `superseded` | `surface` | `#4A5A6A` | `#FFFFFF` | 7.09 | AAA |
| light | `pass-on` | `pass-bg` | `#FFFFFF` | `#4F6A26` | 6.14 | AA |
| light | `changes-on` | `changes-bg` | `#1F2A33` | `#E0A526` | 6.67 | AA |
| light | `blocked-on` | `blocked-bg` | `#FFFFFF` | `#A8432A` | 6.00 | AA |
| light | `superseded-on` | `superseded-bg` | `#FFFFFF` | `#4A5A6A` | 7.09 | AAA |
| dark | `text` | `bg` | `#E6ECEA` | `#151C22` | 14.37 | AAA |
| dark | `text` | `surface` | `#E6ECEA` | `#1E2730` | 12.64 | AAA |
| dark | `text` | `code-bg` | `#E6ECEA` | `#0F1418` | 15.48 | AAA |
| dark | `text-muted` | `bg` | `#A7B4BF` | `#151C22` | 8.13 | AAA |
| dark | `text-muted` | `surface` | `#A7B4BF` | `#1E2730` | 7.15 | AAA |
| dark | `text-muted` | `code-bg` | `#A7B4BF` | `#0F1418` | 8.75 | AAA |
| dark | `link` | `bg` | `#9DBB67` | `#151C22` | 7.97 | AAA |
| dark | `link` | `surface` | `#9DBB67` | `#1E2730` | 7.02 | AAA |
| dark | `pass` | `bg` | `#9DBB67` | `#151C22` | 7.97 | AAA |
| dark | `pass` | `surface` | `#9DBB67` | `#1E2730` | 7.02 | AAA |
| dark | `changes` | `bg` | `#E8B54A` | `#151C22` | 9.12 | AAA |
| dark | `changes` | `surface` | `#E8B54A` | `#1E2730` | 8.03 | AAA |
| dark | `blocked` | `bg` | `#E0826B` | `#151C22` | 6.20 | AA |
| dark | `blocked` | `surface` | `#E0826B` | `#1E2730` | 5.46 | AA |
| dark | `superseded` | `bg` | `#A7B4BF` | `#151C22` | 8.13 | AAA |
| dark | `superseded` | `surface` | `#A7B4BF` | `#1E2730` | 7.15 | AAA |
| dark | `pass-on` | `pass-bg` | `#151C22` | `#9DBB67` | 7.97 | AAA |
| dark | `changes-on` | `changes-bg` | `#151C22` | `#E8B54A` | 9.12 | AAA |
| dark | `blocked-on` | `blocked-bg` | `#151C22` | `#E0826B` | 6.20 | AA |
| dark | `superseded-on` | `superseded-bg` | `#151C22` | `#A7B4BF` | 8.13 | AAA |

Graphics need 3:1 against their background (WCAG 1.4.11). The amber beak on Mist is 1.94:1. It is decorative there: the slate line alone makes the heron recognisable, and the one-colour versions carry no amber.

| Theme | Graphic token | Background token | Graphic | Background | Ratio | Use |
|---|---|---|---|---|---|---|
| light | `mark-line` | `bg` | `#4A5A6A` | `#EEF2F1` | 6.28 | pass 3:1 |
| light | `mark-line` | `surface` | `#4A5A6A` | `#FFFFFF` | 7.09 | pass 3:1 |
| light | `mark-water` | `bg` | `#6E8B3D` | `#EEF2F1` | 3.43 | pass 3:1 |
| light | `mark-beak` | `bg` | `#E0A526` | `#EEF2F1` | 1.94 | decorative only |
| dark | `mark-line` | `bg` | `#EEF2F1` | `#151C22` | 15.24 | pass 3:1 |
| dark | `mark-line` | `surface` | `#EEF2F1` | `#1E2730` | 13.40 | pass 3:1 |
| dark | `mark-water` | `bg` | `#9DBB67` | `#151C22` | 7.97 | pass 3:1 |
| dark | `mark-beak` | `bg` | `#E0A526` | `#151C22` | 7.85 | pass 3:1 |

## Typography

| Role | Family | Fallback stack | Licence |
|---|---|---|---|
| Text and headings | Nunito Sans | Inter, then the system sans | SIL Open Font License 1.1, [OFL.txt](https://github.com/googlefonts/NunitoSans/blob/main/OFL.txt) |
| Alternate text face | Inter | the system sans | SIL Open Font License 1.1, [LICENSE.txt](https://github.com/rsms/inter/blob/master/LICENSE.txt) |
| Code, paths, CLI | IBM Plex Mono | `ui-monospace`, Menlo, Consolas | SIL Open Font License 1.1, [LICENSE.txt](https://github.com/IBM/plex/blob/master/LICENSE.txt) |

IBM Plex carries the Reserved Font Name "Plex". If you subset or modify the font files, the result cannot use the name Plex. Referencing the installed family by name in CSS is fine.

The site loads no web fonts. It names the families first, so a reader who has them installed sees them, and everyone else gets the system face. To self-host the fonts later, copy the `woff2` files into the site and add `@font-face` rules with `font-display: swap`. Keep the licence file next to them.

| Token | Size | Use |
|---|---|---|
| `--heron-size-2xl` | 2.5rem | Page title |
| `--heron-size-xl` | 1.75rem | Section heading |
| `--heron-size-lg` | 1.25rem | Verdict line, lead paragraph |
| `--heron-size-base` | 1rem | Body |
| `--heron-size-sm` | 0.875rem | Tables, code |
| `--heron-size-xs` | 0.8125rem | Labels, captions |

Body line height is 1.6. Headings are weight 700 at line height 1.2. Keep body lines under 72 characters wide. Headings use sentence case. Verdict words are the one exception and always appear in capitals.

## Iconography

Icons follow the mark: one stroke weight, round caps and joins, no fills except for one small solid detail. Draw them on a 24 px grid with a 1.5 px stroke, and colour them with `currentColor`.

Each verdict has a shape, so the state never depends on colour alone:

| Verdict | Shape | Unicode | Colour token |
|---|---|---|---|
| PASS | filled circle | `U+25CF` ● | `--heron-pass` |
| CHANGES REQUESTED | half-filled circle | `U+25D0` ◐ | `--heron-changes` |
| BLOCKED | filled square | `U+25A0` ■ | `--heron-blocked` |
| SUPERSEDED | hollow circle | `U+25CB` ○ | `--heron-superseded` |

These four characters are geometric shapes, not emoji, and they render as text in GitLab. Do not use emoji anywhere in Heron output.

## Voice and tone

Heron writes like a patient senior reviewer who has read the whole change. It is calm, kind, and exact. It uses plain English and short sentences. It cites the file and the line. It explains the consequence, then suggests the fix. It never hypes, scolds, or guesses at intent.

| Do | Don't |
|---|---|
| `src/upload/client.ts:88` retries on HTTP 429 with no limit. If the server never sends `Retry-After`, the job never ends. | Critical bug!!! Infinite loop in the upload client. |
| This merge request changes the public `parseConfig` signature. Two callers in `cli/` still pass the old shape. | You broke the API. |
| No findings in the UI gate. | Awesome work, looks amazing! |
| The spec gate could not read `docs/spec.md`, so spec coverage is unknown. | Something went wrong. |
| A newer head arrived at `9ab41c0`. This report covers `3f9c2e1` and is SUPERSEDED. | Outdated review, ignore. |
| Consider moving the retry limit into `UploadConfig`. | You should obviously move this. |

Rules:

- Say what happens to a person or a system, not how the code feels. "Uploads hang" beats "this is fragile".
- One finding per point. Put the location first.
- Use "must change" only when the merge request cannot merge safely without the change. Use "consider" for everything else.
- Report what Heron could not check. A skipped gate is stated, never hidden.
- No exclamation marks, no emoji, no "simply", no "just".

## GitLab report comment

Heron posts exactly one comment per head. The comment has four parts, in this order:

1. The verdict line: shape, product name, and the verdict word.
2. A short summary: what Heron reviewed and what matters.
3. Findings, each with a file and line.
4. Two collapsed sections: `REVIEW CHECKS` and `AGENT PROVENANCE`.

The first line of the comment is a hidden HTML marker. Tools parse the marker and the verdict word. People read everything else. The field names in the marker, the finding labels, and the model names below are illustrative. The product's own report schema wins where it differs.

Full example, in GitLab-flavoured Markdown:

````markdown
<!-- heron-report verdict="CHANGES REQUESTED" head="3f9c2e1d" mr="42" -->
### ◐ Heron: CHANGES REQUESTED

Reviewed !42 at `3f9c2e1d`, risk lane **standard**, 4 gates, 1 min 27 s.

The new upload retry loop can run forever when the server answers HTTP 429 without a `Retry-After` header. Two findings must change before merge. One is a suggestion.

#### Findings

1. **Must change.** `src/upload/client.ts:88`
   The loop retries on 429 with no attempt limit. If the server never sends `Retry-After`, the CI job runs until it times out. `UploadConfig.maxRetries` already exists. Use it here.

2. **Must change.** `src/upload/client.ts:112`
   The catch block drops the original error and throws `new Error("upload failed")`. Logs lose the status code. Pass the original error as `cause`.

3. **Consider.** `docs/upload.md:14`
   The docs still describe three retries. After the fix above, link to the `maxRetries` setting instead of repeating the number.

<details>
<summary>REVIEW CHECKS (4 gates, 2 with findings)</summary>

| Gate | Result | Findings | Time |
|---|---|---|---|
| Standards | ◐ findings | 1 suggestion | 22 s |
| Spec | ◐ findings | 2 | 41 s |
| UI | ○ skipped: no UI files changed | 0 | 0 s |
| Design | ● pass | 0 | 18 s |
| Supervisor | ◐ CHANGES REQUESTED | 3 | 6 s |
| Judge | not configured | | |

Plan: risk lane `standard`, chosen from 6 changed files and 212 changed lines.

</details>

<details>
<summary>AGENT PROVENANCE</summary>

| Role | Access | Model | Input head |
|---|---|---|---|
| Gates | Claude subscription | `claude-sonnet-4-5` | `3f9c2e1d` |
| Supervisor | ChatGPT subscription (Codex) | `gpt-5-codex` | `3f9c2e1d` |

Heron `0.1.0`, config `heron.yml` at `3f9c2e1d`. Heron does not edit code, approve, or merge. This comment was written by an automated reviewer.

</details>
````

Layout rules for the comment:

- The heading is level 3 so it sits under GitLab's own note chrome without shouting.
- The verdict line holds one shape and the exact verdict word. Never bold the whole summary.
- Every finding starts with its label and a location in code font. Locations use `path:line` or `path:start-end`.
- A PASS report with no findings replaces the findings list with the sentence "No findings." Do not add praise.
- A SUPERSEDED report keeps its original findings, adds the shape ○ to its heading, and names the newer head in the first sentence.
- Keep both `<details>` blocks collapsed. Leave a blank line after `<summary>` so GitLab renders the Markdown inside.

## CLI output

The terminal output is plain ASCII. One step per line. The label column is 11 characters wide. The verdict word appears in full on the last line so scripts can match it.

```text
$ heron review --mr 42
heron 0.1.0  reviewing !42 at 3f9c2e1d
plan        risk lane standard, gates: standards, spec, ui, design
gate        standards ......... 1 suggestion           22s
gate        spec .............. 2 findings             41s
gate        ui ................ skipped (no UI files)   0s
gate        design ............ pass                   18s
supervisor  verdict ........... CHANGES REQUESTED       6s
judge       not configured
report      posted note on !42
labels      added heron::changes-requested, removed heron::reviewing

verdict     CHANGES REQUESTED  (3 findings, 1m 27s)
```

Colour is optional and never carries meaning alone. The words carry it.

| Element | ANSI colour | Truecolor token |
|---|---|---|
| PASS, `pass` | green | `reed-light` `#9DBB67` |
| CHANGES REQUESTED, findings | yellow | `amber-light` `#E8B54A` |
| BLOCKED, errors | red | `rust-light` `#E0826B` |
| SUPERSEDED, skipped, timings, dot leaders | dim | `slate-light` `#A7B4BF` |
| Labels in the left column | bold | none |

Use the 16 named ANSI colours by default, so the reader's terminal theme decides the exact shade. Use the truecolor values only when the user asks for them. Print no colour when `NO_COLOR` is set or when output is not a terminal.

## Workflow labels

GitLab scoped labels (`heron::`) keep exactly one Heron state on a merge request at a time. These names are suggestions. The product's configured label names win.

| Label | Colour | Meaning |
|---|---|---|
| `heron::reviewing` | `#4A5A6A` slate | A review of the current head is running. |
| `heron::pass` | `#4F6A26` reed-deep | The latest report is PASS. |
| `heron::changes-requested` | `#E0A526` amber | The latest report is CHANGES REQUESTED. |
| `heron::blocked` | `#A8432A` rust | The latest report is BLOCKED. |

GitLab picks the label text colour on its own. The table below shows both candidates. Check the rendered label once on your instance.

| Label | Background | White text | Ink text | Use text |
|---|---|---|---|---|
| `heron::reviewing` | `#4A5A6A` | 7.09 | 2.06 | white |
| `heron::pass` | `#4F6A26` | 6.14 | 2.38 | white |
| `heron::changes-requested` | `#E0A526` | 2.19 | 6.67 | ink |
| `heron::blocked` | `#A8432A` | 6.00 | 2.44 | white |

## README header

Use the lockup, centred, with a dark-mode source. GitHub renders `<picture>` in Markdown and swaps the image with the reader's theme.

```html
<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/brand/assets/heron-lockup-on-dark.svg">
    <img alt="Heron" src="docs/brand/assets/heron-lockup.svg" width="344">
  </picture>
</p>
<p align="center">Calm, exact code review for GitLab merge requests.</p>
```

Put at most three badges under the tagline, for example licence, CI, and latest release. Badge images come from the forge or a pinned badge service. Keep them on one line.

## Social preview

`assets/social-preview.png` is 1280 by 640 px, under 70 KB. It shows the mark, the wordmark, the tagline, and the repository address on Mist. Keep text inside a 64 px margin, because some sites crop the edges. To use it, upload the PNG in the repository's settings under **Social preview**.

The SVG draws the tagline and the address as outlines taken from Nunito Sans and IBM Plex Mono, so it looks the same on a machine with neither font installed. `tools/build_assets.py` makes the outlines from the font files you pass with `--fonts`. The font files are not stored in this repository.

## Rebuilding the assets

1. Run `python3 docs/brand/tools/build_tokens.py` to write the token files and print the contrast tables.
2. Download `NunitoSans[YTLC,opsz,wdth,wght].ttf` and `IBMPlexMono-Regular.ttf` from [google/fonts](https://github.com/google/fonts) into one directory, install `fonttools`, and run `python3 docs/brand/tools/build_assets.py --fonts <that directory>` to write the SVGs.
3. Rasterise the PNGs with any SVG renderer, for example `rsvg-convert -w 512 -h 512 docs/brand/assets/heron-mark.svg -o docs/brand/assets/heron-mark-512.png`.
4. Open the PNGs and check that the heron still reads as a heron at 32 px.
