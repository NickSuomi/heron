# Heron OS

The public site for [Heron](../README.md), deployed to [GitHub Pages](https://nicksuomi.github.io/heron/) by `.github/workflows/pages.yml`. Heron OS is a desktop in the style of an Aero-era operating system: visitors learn Heron by opening files in mock apps. On narrow screens the same site is a pocket phone with a Today screen and soft keys. Every asset on screen is drawn for this site. The design book stays at [`/brand/`](public/brand/index.html).

This is its own package, with its own `package.json` and `pnpm-lock.yaml`, separate from the root Heron package. It is a [Foldkit](https://foldkit.dev) program (Effect 4, the Elm architecture), built by [Vite](https://vite.dev) into static files under the `/heron/` base path.

## Develop

The build runs Heron itself (see [The merge request !42](#the-merge-request-42)), so install the root package first:

```sh
pnpm install
cd site
pnpm install
pnpm dev
```

Open `http://localhost:5173/heron/`. Add `?css-glass` to force the CSS glass.

## Build

```sh
pnpm build
```

Output goes to `site/dist/`. The build reads the root `README.md`, `heron.config.example.json`, `docs/` and `src/` into the Heron folder on the desktop (the `heron-files` plugin in `vite.config.ts`), so the files a visitor opens are the repository's own. README.txt on the desktop is the root `README.md` as plain text, made by `build/readme-text.ts`: no HTML, headings underlined instead of marked with hashes, code indented, and links spelled out. The `heron-build` plugin (`build/heron-build.ts`) runs the root package's own code in Node and puts its output in `virtual:heron-build`; see below.

## Test

```sh
pnpm test
```

Vitest runs `src/**/*.test.ts` and `build/*.test.ts` with the Vite config, so the tests see the same `virtual:heron-build` module as the site. The Pages workflow runs them before the build.

## How the program works

`src/entry.ts` boots the Foldkit runtime. Everything the screen shows comes from one Model (`src/model.ts`):

- `session`: the boot loader, the welcome screen, then the desktop. Boot takes about 1.5 s; a click, Enter or Esc skips it.
- `desk` (`src/domain/window.ts`): the open windows in z-order, bottom first, and the focused window. A window holds its app state, its bounds, `Normal` or `Maximised`, and whether it is minimised.
- `gesture`: a title-bar move or an edge resize in progress.
- `review` (`src/domain/review.ts`): the one shared review of the fictional merge request acme/storefront !42, `Idle`, `Running` or `Done`. See [The review engine](#the-review-engine).
- `forge` (`src/domain/forge.ts`): the mock GitLab's session state: who signed in to gitlab.heron.local, when heron-bot created and last edited its note, and the label changes its activity lists. See [The mock GitLab](#the-mock-gitlab).
- The Start menu, the window switcher, the selected desktop icon, the clock, sound, and the glass mode.

`src/update.ts` handles every Message in `src/message.ts`. The views live in `src/shell/`. The phone layout (`src/shell/phone.ts`) renders the same Model: the top visible window fills the screen, and the Today screen shows when none is open.

## Apps and file types

`src/apps/registry.ts` lists every app as an `AppDefinition`: id, name, icon, default size, whether it runs once, the file types it opens, and `launch`, which builds its state from the file or folder it was opened on and a `LaunchSession` (whether the visitor signed in to the mock GitLab). Opening a file picks the first app whose `opens` list names the file's type (`src/domain/vfs.ts` derives the type from the extension). Shortcuts on the desktop name their app directly.

Notepad (`src/apps/notepad.ts`) is the pattern for the other apps. It has its own Model, Messages, `update` and view, the shell embeds it with `h.submodel`, and it asks the shell to close its window through an OutMessage. To build an app:

1. Write `src/apps/<app>.ts` with the Notepad shape.
2. Add its Model to the `AppState` union in `src/apps/appState.ts`.
3. Point its registry entry's `launch` at its `init`.
4. Add a `Got<App>Message` Message, route it in `src/update.ts`, and render it in `appView` in `src/shell/window.ts`.

The Diagram Viewer, Explorer, the Welcome Center, Help and Support, and the Recycle Bin dialogs (`src/apps/dialog.ts`) take the same shape, and their OutMessage is the shared `Request` union in `src/apps/request.ts`: open a path, start an app, ask for approval, start the tour, close the window, or remember "Show this at startup". `updateApp` in `src/update.ts` routes each app's Messages and answers its Request. Each of these views takes a `form` view input, `Desktop` or `Phone`, and draws its Windows Mobile layout on the phone.

- **The tour** (`src/tour.ts`) is a list of steps, each naming an app and an optional file. Entering a step opens or focuses that app, then runs the step's hook from `src/tourHooks.ts`, which drives the app with the same Messages a visitor's input sends. The first step types `heron review --mr 42 --dry-run` into the Command Prompt and presses Enter. The second opens the diff in Heron Studio and shows the Error List, running a dry run first when none has run. The third signs in to the mock GitLab as `visitor`, opens !42, and starts a posted run when no note exists yet; if a dry run is still going, the posted run starts when it ends. A balloon above the clock (`src/shell/tourBalloon.ts`) moves between steps and says how far the review is. The approval prompt a finished review opens sits on top of the tour; closing it leaves the tour where it was.
- **User Account Control** (`src/shell/secureDesktop.ts`) is the `uac` field of the Model. A finished review or a `RequestedApproval` dims the desktop, makes it inert, and focuses Cancel. Either button ends with "Heron never approves."

An app that needs shared state, such as the review, takes it as `viewInputs` in its view and as a context argument in its `update`, the way Command Prompt and Heron Studio do. An app's CSS sits next to it (`src/apps/<app>.css`) and is imported by the app module.

Text fields are uncontrolled: none sets a controlled `value` (`h.Value`). Foldkit writes a controlled value back on every render, and the clock renders often enough that a keystroke typed between two renders would be lost. A field shows its first text through an `h.Attribute("value", ...)` or a mount, and code that changes the text writes it into the element directly.

- **Command Prompt** (`src/apps/cmd.ts`): `help`, `cls`, `dir`, `cd`, `type`, `exit` over the Heron OS file system, with the home folder `C:\Users\Visitor` standing for its root, and a history for the up and down arrows. `heron --help`, `heron config check` and the other `heron` commands it knows print the real CLI's output. `heron review --mr 42 --dry-run` streams the shared review and prints the report; without `--dry-run` it posts. Enter and Esc read and clear the command line inside the key event, so lines typed at any speed arrive whole.
- **Internet Explorer** (`src/apps/browser.ts`, glyphs in `src/apps/browserIcons.ts`): a browser in the manner of version 7 on an Aero desktop, with glass Back and Forward buttons, the address bar, Refresh and Stop, a search box, tabs with Quick Tabs and a tab list, the Favorites Center, the command bar (Home, Feeds, Print, Page, Tools, Help) and a status bar with the zone. Each tab keeps its own history. It reaches `gitlab.heron.local` and `search.heron.local`; any other address shows its "cannot display the webpage" page. The Favorites entry "Heron on GitHub" and every link to github.com open in a new tab of the visitor's own browser. It opens on the sign-in page, or on !42 once the visitor has signed in during the session. On the phone it is a pocket browser: an address line with Go, the page in one column, and Back, Favorites, Refresh and Home above the soft keys.
- **Heron Studio** (`src/apps/studio.ts`, tokenizer in `src/apps/highlight.ts`): opens `.ts`, `.vue`, `.json` and `.diff` files, with the merge request's files and Heron's source in Solution Explorer. Typing works; Save shows "Heron never edits code". Once the review is Done, findings show as red (blocker) and blue (advisory) squiggles with tooltips and in the Error List, whose rows jump to the line. On the phone it is a full-screen viewer with the findings under the code.

## The merge request !42

`src/data/mr42.ts` is the one source for the fictional merge request acme/storefront !42: its change, its review and Heron's report note. Every app that shows the merge request imports it. The data says it is fictional (`isFictional: true`).

```ts
import { mr42, findingsIn, type MergeRequest42, type Finding, type Session, type ChangedFile } from "./data/mr42"
```

- `mr42.files`: the three changed files (`src/locales/en.json`, `src/projects/ProjectList.vue`, `src/projects/archive.ts`), each with `before`, `after` and the GitLab-style `diff`. `mr42.diff` is the whole change as `git diff` prints it; the desktop's `merge-request-42.diff` is this text. The diffs are computed from the contents (`src/data/unifiedDiff.ts`), so they cannot drift from the files.
- `mr42.sessions`: the standard lane's plan, `gate.design`, `gate.correctness`, `gate.security`, then `supervisor`, with the profile's harness, model and effort from `heron.config.example.json`, and start times that follow the `claude` harness's concurrency of 2.
- `mr42.findings`: what the report lists, blockers first: one blocker and four advisories, each at `path:line` with an `excerpt` the editor underlines. `findingsIn(path)` filters them.
- `mr42.verdict`, `mr42.configDigest`, `mr42.noteId`, and `mr42.note`: the report note, exactly as `heron review --mr 42 --dry-run` prints it.

The hand-written part is `src/data/mr42-data.ts`: the file contents, each session's raw findings and the supervisor's keep-or-drop decisions. At build time `build/heron-build.ts` imports the root package's `src/config.ts`, `src/policy.ts` and `src/report.ts` in Node (with the root's own effect 4.0.0-rc.115; nothing from it is bundled), loads `heron.config.example.json` with the forge pointed at `gitlab.heron.local` and `acme/storefront`, and runs Heron's `classify`, `planFor`, `applySynthesis`, `verdictOf` and `renderReport` over the data. The build fails if the lane, the session plan or the verdict disagrees with the data, or if `heron config check` prints another digest. It also runs the real CLI for the `heron` commands Command Prompt knows and keeps their output. `virtual:heron-build` exports `reportNote`, `findingIds`, `configDigest`, `labelNames`, `profiles` and `cliOutput`.

## The mock GitLab

`src/apps/gitlab.ts` draws gitlab.heron.local in the look of a 2009 web application with today's GitLab layout: a project sidebar, merge request tabs and a label sidebar. Every mark and glyph is drawn for Heron OS; `src/apps/gitlabRoutes.ts` maps addresses to pages. The pages are the sign-in page (any username and password work, nothing leaves the page, and it says so), the dashboard, the project acme/storefront, its merge requests, !42 with Overview, Commits and Changes, and each changed file at the reviewed head. The project and its merge requests are fictional and a banner says so. Project pages need a signed-in visitor, as an internal GitLab project does.

!42's Overview shows the description, the activity and the labels. The labels are the review's live `labelsOf`. Heron's note appears once a posted run emits `PostedNote`, by heron-bot, with GitLab's relative time; a later posted run edits it, and the note says "Edited just now by heron-bot". Each `ChangedLabels` event adds a line to the activity. A dry run changes nothing there; while one runs, and after it, a banner says so. `src/apps/gitlabMarkdown.ts` renders the note the way GitLab renders markdown: headings, lists, links to `file:line` (they open the file at that line), tables and the collapsible REVIEW CHECKS and AGENT PROVENANCE details. The marker comment stays hidden.

## The review engine

`src/domain/review.ts` simulates one run of `heron review` over `mr42`. The Model's `review` is:

- `Idle` before the first run.
- `Running`: the delivery (`DryRun` or `Post`), the run number, the events emitted so far, and the mock merge request's live `labels` and `isReportNotePosted`.
- `Done`: the same, plus the verdict and when the run started and ended.

`start(review, delivery)` begins a run; it does nothing while one is running. While a run is Running, a subscription in `src/subscription.ts` ticks every 100 ms and `advance(review, now)` emits every event that is due. The events are `LoadedConfig`, `TookSnapshot`, `Classified`, `StartedSession` and `FinishedSession` for each session, then, for a posted run only, `ChangedLabels` (the in-progress label first, the verdict's label at the end) and `PostedNote` (`created`, or `updated` on a later run), and finally `Finished`. `timeline` gives each event's time: the session times of the data, played 25 times faster, so a run takes about 9 seconds. A dry run leaves the labels and the note alone.

Apps read the one shared state: `labelsOf`, `isReportNotePosted`, `eventsOf`, `sessionStatus`, `progressOf`, `describeEvent` (one line per event, as Command Prompt and the Output window print it) and `cliResult` (what the CLI prints when the run ends). The real CLI prints only that result; Command Prompt says so before it streams the events.

## Keyboard

- **Alt+`** switches windows. Hold Alt and press the key again to move on, add Shift to go back, and release Alt to switch. Browsers keep Alt+Tab for themselves.
- **Ctrl+Esc** opens and closes the Start menu.
- **Esc** closes the switcher or the Start menu, or clears the icon selection. On the boot screen it skips the boot.
- **Enter** opens the selected desktop icon, or skips the boot. The arrow keys move the icon selection.

A visible "Skip to the plain docs" link, the first stop for Tab, leads to the README on GitHub.

## Glass

Title bars, the taskbar and the Start menu are glass. In browsers with the HTML-in-canvas API and WebGL 2, Canvas UI's [Glass](https://canvasui.dev) (`src/shell/glass.ts`) draws a pinned lens over each surface: the lens refracts and frosts a copy of the wallpaper aligned to the surface, and a tint layer sits above it. In that mode the glass shows the wallpaper, not the windows behind. Everywhere else the glass is CSS: a tint over `backdrop-filter: blur()`, with the diagonal sheen drawn in CSS.

## Origin trial

The native glass needs Chrome's HTML-in-canvas origin trial for `https://nicksuomi.github.io`. Register or renew it on the [HTML-in-canvas origin trial page](https://developer.chrome.com/origintrials/#/registration/3609758246639763457). The token sits in the `<meta http-equiv="origin-trial">` tag in the head of `index.html`. The current token expires on 2026-10-20 or with the Chrome 154 rollout, whichever comes first. To renew it, press **RENEW** on that page and replace the meta tag's `content` value. Without a valid token, visitors get the CSS glass.

## Content

Every Heron fact on screen comes from the root [README.md](../README.md), the docs, and the source. The merge request acme/storefront !42, its diff and its review (`src/data/mr42.ts`) are a fictional example and say so; the report note and the CLI output are Heron's own, produced at build time.

## Design book

The design book is [docs/brand/README.md](../docs/brand/README.md). Help and Support renders it from the Heron folder at build time, and `node docs/brand/tools/build_book.ts` (run from the repository root) writes the same text to `public/brand/index.html` and regenerates the book's contrast table. Both use the Markdown reader in `src/apps/markdown.ts`.

## Fonts

The interface uses Segoe UI when the visitor has it installed, and Selawik otherwise. Selawik 1.01 is self-hosted from its [release](https://github.com/microsoft/Selawik/releases/tag/1.01) under the SIL Open Font License 1.1; the licence text is `public/fonts/Selawik-OFL.txt`.

## Acknowledgements

The glass is [Canvas UI's](https://canvasui.dev) `Glass` component ([source](https://github.com/DavidHDev/canvas-ui)), vendored unchanged at `src/vendor/canvas-ui/Glass/GlassVanilla.ts` with its helper `src/vendor/canvas-ui/rect-cache.ts`, the upstream commit in `src/vendor/canvas-ui/SOURCE.md`, and its license at `src/vendor/canvas-ui/LICENSE.md`, which the site also serves as `public/licenses/canvas-ui-LICENSE.txt`. Canvas UI is licensed under MIT with a Commons Clause: use, including commercial use, is permitted, but selling, sublicensing, or redistributing the components themselves, alone, bundled, or ported, is not. This site uses the component as part of the Heron site and does not redistribute it as a separate product.
