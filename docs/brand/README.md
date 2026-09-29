# Heron OS design book

Heron is a self-hosted code-review bot for GitLab merge requests. It reviews one merge request at its current head, writes one report note, and sets a verdict label. It never pushes, approves, or merges.

Heron OS is its public site: a desktop in the style of an Aero-era operating system, where visitors learn Heron by opening files in mock apps. On a narrow screen the same site is a pocket phone. This book sets how Heron OS looks, sounds, and speaks. Inside Heron OS it is the Help and Support app; on the web it is the `/brand/` page. Both are built from this file.

## Principles

1. **Close to the era, drawn by us.** Heron OS looks as near as it can to Vista-era software: glass frames, glossy buttons, soft gradients, and 9-point interface type. Every icon, glyph, wallpaper, and sound is drawn or synthesized for this site. No file, logo, wordmark, icon, or sound from any operating system vendor is used.
2. **Every fact is Heron's.** Text on screen states only what the Heron README, the docs, and the source state. The merge request acme/storefront !42 is a fictional example and says so wherever it appears.
3. **Craft over breadth.** An app does a few things and does them the way the era did: hover states, pressed states, focus rectangles, and status bars that say something.
4. **Few jokes, each ending on a fact.** Heron OS has three jokes. Each one ends on a true sentence about what Heron does.
5. **Nothing leaves the page.** The site loads no external fonts, scripts, images, or trackers. The mock GitLab accepts any sign-in and sends nothing.

## Name

Write the product as "Heron" in prose and `heron` in code. Write the site as "Heron OS". Do not write "HERON", "HeronBot", or "the Heron".

| Thing | Name |
|---|---|
| Product in prose | Heron |
| The site | Heron OS |
| Command | `heron` (from source: `pnpm heron`) |
| Repository | `NickSuomi/heron` |
| Fictional example | acme/storefront, merge request !42, at gitlab.heron.local |

## Palette

Heron OS has two families of colour: the glass of the frame, and the opaque surfaces inside it. The glass is a tint over whatever lies behind the window. The surfaces are near-white with blue-grey edges and one selection blue.

### Glass

| Token | Value | Use |
|---|---|---|
| `glass-active` | `rgba(104, 150, 178, 0.42)` | The frame of the focused window |
| `glass-inactive` | `rgba(150, 178, 196, 0.28)` | Every other window frame |
| `glass-maximised` | `rgba(28, 44, 56, 0.86)` | A maximised frame, nearly opaque, as the era drew it |
| `glass-edge` | `rgba(0, 0, 0, 0.72)` | The 1 px outer line of every frame |
| `glass-rim` | `rgba(255, 255, 255, 0.5)` | The 1 px inner highlight of every frame |

### Surfaces and ink

| Token | Value | Use |
|---|---|---|
| `surface` | `#FFFFFF` | Client areas, lists, pages |
| `surface-pane` | `#F2F7FB` | Navigation panes, the Help contents |
| `surface-footer` | `#F0F0F0` | Dialog footers under a `#DFDFDF` line |
| `ink` | `#000000` | Body text |
| `ink-instruction` | `#003399` | The main instruction of a dialog, tour titles |
| `ink-heading` | `#1E395B` | Pane titles, status bars |
| `ink-section` | `#1E5AA0` | Section headings in the Welcome Center and Help |
| `ink-secondary` | `#6D6D6D` | Column values, hints |
| `link` | `#0066CC` | Links; `#3399FF` on hover |
| `select-border` | `#84ACDD` | The border of a selected item |
| `select-fill` | `#F2F8FD` to `#D9ECFD` | The fill of a selected item, top to bottom |
| `hover-border` | `#B8D6FB` | The border of a hovered item |
| `command-bar` | `#6798B3` to `#25607F` | Explorer's command bar, glossy, with a hard stop at 50% |

### Office ribbon

The Diagram Viewer uses the blue scheme of the 2007 ribbon: tab row `#E3EEFB` to `#CFE1F7`, group face `#F4F8FE` to `#D1E2F6` under a `#99BBE8` border, group labels `#244C86` on `#B7D0EE`, text `#15428B`. Hover is amber, `#FFFBE6` to `#FFE89C`; pressed is orange, `#FDE2B1` to `#FCD174`.

### Verdict labels

GitLab draws the labels, and their colours are the project's choice. These values carry white text; the contrast table under Accessibility lists their ratios.

| Label (example config) | Colour |
|---|---|
| `review::in progress` | `#4C5391` |
| `review::passed` | `#2F6B55` |
| `review::changes requested` | `#7A5520` |
| `review::blocked` | `#9A3B3B` |

## Aero glass recipe

A glass frame is five layers, back to front.

1. **The blur.** `backdrop-filter: blur(9px) saturate(1.45) brightness(1.02)` frosts what is behind the window and lifts its colour.
2. **The tint.** `glass-active` or `glass-inactive` fills the frame.
3. **The gloss.** A vertical white gradient: 42% at the top edge, 12% at 28 px, 4% at 60%, and 10% at the bottom.
4. **The sheen.** Two diagonal streaks at 118 degrees: white at 28% between 10% and 15% of the width, fading to nothing at 19%. The streaks make the glass read as a surface, not a colour.
5. **The edges.** A 1 px `glass-edge` outline, a 1 px `glass-rim` inner line, and a shadow of `0 8px 30px` at 55% black. Inactive windows drop to `0 4px 18px` at 42%.

Caption text sits on a white halo so it reads on any wallpaper: text shadows of 5, 9, and 14 px in white at 100%, 90%, and 70%.

In browsers with the HTML-in-canvas API and WebGL 2, Canvas UI's Glass component draws a pinned lens under the tint: it refracts and frosts a copy of the wallpaper aligned to the surface. That lens shows the wallpaper, not the windows behind. Every other browser gets the CSS recipe above, and it must look right on its own. Add `?css-glass` to the address to force it. Canvas UI is copyright (c) 2026 David Haz, under MIT with the Commons Clause; the site ships [its licence](https://nicksuomi.github.io/heron/licenses/canvas-ui-LICENSE.txt).

Explorer and Help and Support extend the glass into the window, as the era did: their travel buttons, address bar, and search box sit on the frame, not on a white bar.

## Typography

| Role | Face | Licence |
|---|---|---|
| Interface | Segoe UI, when the visitor has it installed | Not shipped. `local("Segoe UI")` only |
| Interface fallback | Selawik 1.01, regular, semibold, bold | SIL Open Font License 1.1, `site/public/fonts/Selawik-OFL.txt` |
| Terminal, code, previews | Lucida Console, then Consolas, then DejaVu Sans Mono | The visitor's own fonts. Nothing shipped |
| Diagram shapes | Arial, then the interface face | The visitor's own fonts |

Heron Sans is a subset of Selawik, an open-source face designed to match Segoe UI's metrics, so a line set in either takes the same width. The subset is renamed because the SIL Open Font License reserves the name Selawik for the unmodified font. Heron OS names both faces under one family, "Heron UI", and the browser picks the first that loads. Heron Sans is self-hosted with the Selawik licence beside it.

| Size | Weight | Use |
|---|---|---|
| 12 px | 400 | Body, menus, lists, captions (9 point) |
| 11 px | 400 | The ribbon, Shape Data, status bars |
| 13 px | 400 | Section headings, tour titles |
| 16 px | 400 | A dialog's main instruction, in `ink-instruction` |
| 18 to 20 px | 400 | Window page titles: the Welcome Center, Help topics |

Headings use sentence case and a regular weight; the era used colour, not weight, for hierarchy. Semibold marks a dialog's first content line and nothing else. The verdict words PASS, CHANGES REQUESTED, BLOCKED, and SUPERSEDED keep their capitals everywhere, because scripts match them.

## Iconography

Every icon is an SVG drawn for Heron OS in `site/src/assets/icons/` (48 px, desktop and file icons) and `site/src/assets/glyphs/` (16 and 32 px, toolbars, the ribbon, dialogs).

- **Light from the top left.** Fills run light to dark downward. A white gloss sits on the upper half of round and glossy shapes.
- **One soft shadow.** A 1.2 unit Gaussian blur offset 1.2 units down at 45% black for 48 px icons, 0.8 at 40% for 32 px glyphs. 16 px glyphs have no shadow.
- **Outlines a shade darker than the fill,** 0.7 to 1 unit wide, never pure black.
- **Folders are amber** (`#FFE7A6` to `#D9A443`), documents are white with blue-grey rules, actions are green (play, approve) or blue (stop, info).
- **Redrawn, never traced.** Do not copy, trace, or recolour any vendor's icon, logo, flag, orb, or wordmark. The Start orb carries the heron, not a flag. The Diagram Viewer's application button carries a flow glyph, not an office suite's mark. The User Account Control shield is our own two-colour drawing.
- **The shield means "asks first".** It sits on a button that would change a merge request, such as "Approve merge request", exactly as the era marked buttons that needed permission. Heron OS uses it only for approval.

## Window chrome

| Part | Measure |
|---|---|
| Frame border | 8 px of glass on the sides and bottom |
| Caption | 30 px tall; 24 px when maximised |
| Corner radius | 8 px on top, 6 px at the bottom; 0 when maximised |
| Title | 12 px, 9 px from the left edge after a 16 px icon |
| Caption buttons | 19 px tall, hung from the top edge; minimise and maximise 26 px wide, close 43 px |
| Client edge | 1 px at 55% black, ringed by a 1 px white line at 45% |
| Minimum window | 260 by 160 px |
| Taskbar | 30 px, with a 42 px round Start orb that overhangs it |
| Start menu | 408 by 530 px |
| Menu bar | 20 px; menu items 22 px |
| Push button | 23 px tall, at least 75 px wide, 3 px radius |
| Explorer | 34 px glass strip, 31 px command bar, 62 px details pane, 22 px status bar |
| Office ribbon | 26 px tab row over a 94 px body; big buttons 70 px tall with 32 px icons |
| Task dialog | Main area with a 32 px glyph; a 41 px footer on `surface-footer` |

Windows cascade 26 px down and right from the centre of the desk and wrap after six. A window can be dragged until 80 px of its caption is left on screen.

## Sound

Heron OS has one sound: a start-up chime synthesized in the browser with WebAudio. It is four sine bells, G4, D5, G5, and B5, starting 0, 160, 340, and 560 ms apart. Each bell carries two soft overtones at twice and about three times its pitch and fades over 2.4 seconds. No sound file ships with the site.

- The chime stays silent until the visitor first clicks or presses a key, because browsers require it and because a page should not speak first.
- The speaker in the tray mutes and unmutes it.
- Nothing else makes a sound: not a dialog, not the UAC joke, not an error.

## Voice and tone

Heron writes like a patient senior reviewer who has read the whole change: calm, plain, and exact. Heron OS borrows the era's dialog grammar (a main instruction, then content, then buttons) and fills it with Heron's facts.

| Do | Don't |
|---|---|
| Heron never approves a merge request. It posts one report note and sets one verdict label. | Oops! Heron can't do that. |
| The review could not finish: session `b1.gate.design` failed. | Something went wrong. |
| Merge request !42 is a fictional example. | Try it on your repo now! |
| heron.config.json does not define this lane. | Invalid lane!! |

- Say what happens to a person or a system. Name the path, the command, or the label.
- A main instruction is one sentence without a full stop, in `ink-instruction`.
- Buttons say what they do: Close, Continue, Cancel, Next, Finish.
- No exclamation marks, no emoji, no "simply", no "just" as a softener, no long dashes.
- Only numbers the docs state. No invented metrics, testimonials, or adoption claims.

### The jokes

There are three, and only three.

1. **User Account Control.** When a review finishes, or someone presses "Approve merge request", the desktop dims and a secure-desktop dialog asks: "Heron wants to approve this merge request", with Cancel focused. Whatever is pressed, Heron cancels itself: "Heron never approves."
2. **Stopped working.** force-push.bat in the Recycle Bin opens "Heron has stopped working", with a progress bar checking for a solution. Two seconds later: "just kidding. It never pushes."
3. **The Recycle Bin.** It holds approve.exe, force-push.bat, and merge-without-review.lnk, each with an original location of "Never in Heron". Emptying it is refused: these three stay, because they are the things Heron never does.

Each joke ends on a true sentence from the docs. A new joke needs an old one to leave.

## Accessibility

- **Keyboard.** Alt+` switches windows and Ctrl+Esc opens Start, because browsers keep Alt+Tab and the Windows key. Esc closes the switcher, the Start menu, or the UAC dialog. Enter opens the selected icon or file. Tab reaches every button, tile, list item, and diagram shape.
- **Skip link.** "Skip to the plain docs" is the first stop for Tab and leads to the README on GitHub.
- **Focus.** Controls show a 1 px dotted focus rectangle, as the era did. The UAC dialog opens with Cancel focused and makes the desktop behind it inert.
- **Roles.** Windows are dialogs named by their title. Lists are listboxes, ribbon tabs are tabs, diagram shapes are buttons named by their label and kind, and live regions announce Play's steps, Shape Data, and the tour.
- **Motion.** With `prefers-reduced-motion: reduce`, the glowing default button, the progress marquee, the tour balloon, and the diagram's pulsing shapes and drawn connectors stop moving. Play still steps through the drawing, and every state stays visible.
- **The phone.** Below 700 px wide, Heron OS is a pocket phone: one app at a time, full screen, with list rows at least 40 px tall and two soft keys. The model is the same, so a review started on one form shows on the other.

### Contrast

`docs/brand/tools/build_book.ts` computes every ratio below with the WCAG 2.x relative-luminance formula and rewrites this table. AA needs 4.5:1 for text. Disabled text is exempt and is listed so that nobody mistakes it for body text.

<!-- contrast-table:start (generated by docs/brand/tools/build_book.ts) -->

| Use | Text | Background | Ratio | WCAG |
|---|---|---|---|---|
| Body text on a client area | `#000000` | `#FFFFFF` | 21.00 | AAA |
| Main instruction | `#003399` | `#FFFFFF` | 10.86 | AAA |
| Pane titles and status bars | `#1E395B` | `#FFFFFF` | 11.72 | AAA |
| Section headings | `#1E5AA0` | `#FFFFFF` | 6.94 | AA |
| Links | `#0066CC` | `#FFFFFF` | 5.57 | AA |
| Column values and hints | `#6D6D6D` | `#FFFFFF` | 5.17 | AA |
| Details pane labels | `#4C607A` | `#FFFFFF` | 6.44 | AA |
| Welcome Center fact labels | `#4D6079` | `#E2EEF9` | 5.46 | AA |
| Status bar text | `#1E395B` | `#DDE6F0` | 9.29 | AAA |
| Info bar text | `#000000` | `#FFFFE1` | 20.64 | AAA |
| Explorer command bar, upper half | `#FFFFFF` | `#3D7593` | 5.04 | AA |
| Explorer command bar, lower half | `#FFFFFF` | `#1F5775` | 7.84 | AAA |
| Help toolbar | `#FFFFFF` | `#346FAE` | 5.21 | AA |
| Ribbon text | `#15428B` | `#C9DCF5` | 6.89 | AA |
| Ribbon group labels | `#244C86` | `#B7D0EE` | 5.41 | AA |
| Diagram shape label | `#14233A` | `#BCD4F0` | 10.38 | AAA |
| Diagram shape sublabel | `#3F5270` | `#BCD4F0` | 5.21 | AA |
| Phone selected row | `#FFFFFF` | `#1F4EA8` | 7.74 | AAA |
| Phone soft key | `#FFFFFF` | `#2B5CB8` | 6.31 | AA |
| Label review::in progress | `#FFFFFF` | `#4C5391` | 7.11 | AAA |
| Label review::passed | `#FFFFFF` | `#2F6B55` | 6.26 | AA |
| Label review::changes requested | `#FFFFFF` | `#7A5520` | 6.67 | AA |
| Label review::blocked | `#FFFFFF` | `#9A3B3B` | 6.86 | AA |
| Disabled button text | `#838383` | `#F4F4F4` | 3.45 | exempt |

<!-- contrast-table:end -->

## The heron mark

The heron stands on an edge, neck in an S, head lowered, bill pointed down. It is a silhouette with no eye and no face. `tools/build_assets.py` draws it once and writes every mark from that drawing.

| File | Use |
|---|---|
| `assets/heron-mark-mono-white.svg` | The Start orb and light-on-dark places |
| `assets/heron-mark-mono-ink.svg` | The phone's Today screen and dark-on-light places |
| `assets/heron-mark.svg`, `assets/heron-mark-on-dark.svg` | Duotone marks for documents |
| `assets/heron-lockup.svg`, `assets/heron-lockup-on-dark.svg` | Mark and wordmark, for the repository README |
| `assets/favicon.svg` | The browser tab |
| `assets/social-preview.svg`, `assets/social-preview.png` | The link preview, 1280 by 640: Heron OS, with a dry run of !42 in the Command Prompt |

- Do not add an eye, a pupil, or a face.
- Do not rotate or stretch it. It faces left, or right when it sits beside the wordmark.
- Do not animate it flapping, walking, or idling.
- Below 24 px, use the favicon.

## The report note

The report note is GitLab's to draw; the mock GitLab in Heron OS shows it the same way. Its format comes from `src/report.ts`:

1. A hidden marker: `<!-- heron:v1 mr=… head=… config=… verdict=… -->`.
2. The heading `## Heron review: VERDICT`.
3. The reviewed head and lane, then the summary.
4. `### Findings`: blockers first, then advisories, each with its gate and a link to `path:line` at the reviewed head.
5. `### Not checked`, when a session reported limits.
6. Two collapsed sections: `REVIEW CHECKS` and `AGENT PROVENANCE`.

Model-written text is posted as escaped plain text, never as Markdown.

## Files

- `README.md`: this book.
- `tools/build_book.ts`: writes `site/public/brand/index.html` from this file and regenerates the contrast table.
- `assets/`: the heron mark, lockups, favicon, and social preview.
- `tools/build_assets.py`: draws every SVG in `assets/` and writes the same files to `site/public/brand/assets/`, which the site serves. It reads its colours from `tools/build_tokens.py`.
- `tokens.json`, `tokens.css`, `tools/build_tokens.py`: the tables of this book as design tokens: the glass, the surfaces and ink, the ribbon, the verdict labels, the glass recipe, and the type. `build_tokens.py` writes the other two.

## Rebuilding

1. Edit this file.
2. Run `node docs/brand/tools/build_book.ts` from the repository root. It rewrites the contrast table here and writes `site/public/brand/index.html`.
3. Run `pnpm build` in `site/`. Help and Support reads this file when the site is built.
4. To change a colour, edit `tools/build_tokens.py` and run `python3 docs/brand/tools/build_tokens.py`.
5. To change the mark or the social preview, run `python3 docs/brand/tools/build_assets.py`, and render the PNGs with headless Chromium: the mark at 512 by 512 and the social preview at 1280 by 640. The social preview embeds Selawik and the Aurora wallpaper, so it needs nothing installed.
