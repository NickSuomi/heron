# Heron OS

The public site for [Heron](../README.md), deployed to [GitHub Pages](https://nicksuomi.github.io/heron/) by `.github/workflows/pages.yml`. Heron OS is a desktop in the style of an Aero-era operating system: visitors learn Heron by opening files in mock apps. On narrow screens the same site is a pocket phone with a Today screen and soft keys. Every asset on screen is drawn for this site. The design book stays at [`/brand/`](public/brand/index.html).

This is its own package, with its own `package.json` and `pnpm-lock.yaml`, separate from the root Heron package. It is a [Foldkit](https://foldkit.dev) program (Effect 4, the Elm architecture), built by [Vite](https://vite.dev) into static files under the `/heron/` base path.

## Develop

```sh
cd site
pnpm install
pnpm dev
```

Open `http://localhost:5173/heron/`. Add `?css-glass` to force the CSS glass.

## Build

```sh
pnpm build
```

Output goes to `site/dist/`. The build reads the root `README.md`, `heron.config.example.json`, `docs/` and `src/` into the Heron folder on the desktop (the `heron-files` plugin in `vite.config.ts`), so the files a visitor opens are the repository's own.

## How the program works

`src/entry.ts` boots the Foldkit runtime. Everything the screen shows comes from one Model (`src/model.ts`):

- `session`: the boot loader, the welcome screen, then the desktop. Boot takes about 1.5 s; a click, Enter or Esc skips it.
- `desk` (`src/domain/window.ts`): the open windows in z-order, bottom first, and the focused window. A window holds its app state, its bounds, `Normal` or `Maximised`, and whether it is minimised.
- `gesture`: a title-bar move or an edge resize in progress.
- `review` (`src/domain/review.ts`): the one shared review of the fictional merge request acme/storefront !42, `Idle`, `Running` or `Done` with its verdict, whether the report note was posted, and the labels. Apps in unit 2 read and change it.
- The Start menu, the window switcher, the selected desktop icon, the clock, sound, and the glass mode.

`src/update.ts` handles every Message in `src/message.ts`. The views live in `src/shell/`. The phone layout (`src/shell/phone.ts`) renders the same Model: the top visible window fills the screen, and the Today screen shows when none is open.

## Apps and file types

`src/apps/registry.ts` lists every app as an `AppDefinition`: id, name, icon, default size, whether it runs once, the file types it opens, and `launch`, which builds its state from the file or folder it was opened on. Opening a file picks the first app whose `opens` list names the file's type (`src/domain/vfs.ts` derives the type from the extension). Shortcuts on the desktop name their app directly.

Notepad (`src/apps/notepad.ts`) is the pattern for the other apps. It has its own Model, Messages, `update` and view, the shell embeds it with `h.submodel`, and it asks the shell to close its window through an OutMessage. To build an app:

1. Write `src/apps/<app>.ts` with the Notepad shape.
2. Add its Model to the `AppState` union in `src/apps/appState.ts`.
3. Point its registry entry's `launch` at its `init`.
4. Add a `Got<App>Message` Message, route it in `src/update.ts`, and render it in `appView` in `src/shell/window.ts`.

The Diagram Viewer, Explorer, the Welcome Center, Help and Support, and the Recycle Bin dialogs (`src/apps/dialog.ts`) take the same shape, and their OutMessage is the shared `Request` union in `src/apps/request.ts`: open a path, start an app, ask for approval, start the tour, close the window, or remember "Show this at startup". `updateApp` in `src/update.ts` routes each app's Messages and answers its Request. Each of these views takes a `form` view input, `Desktop` or `Phone`, and draws its Windows Mobile layout on the phone. The apps that are still stubs show their name and "Coming in unit 2".

- **The tour** (`src/tour.ts`) is a list of steps, each naming an app and an optional file. Entering a step opens or focuses that app, then runs the step's hook from `src/tourHooks.ts`. A balloon above the clock (`src/shell/tourBalloon.ts`) moves between steps.
- **User Account Control** (`src/shell/secureDesktop.ts`) is the `uac` field of the Model. A finished review or a `RequestedApproval` dims the desktop, makes it inert, and focuses Cancel. Either button ends with "Heron never approves."

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

Every Heron fact on screen comes from the root [README.md](../README.md), the docs, and the source. The merge request acme/storefront !42, its diff (`src/domain/mergeRequest42.diff`) and its review are a fictional example and say so.

## Design book

The design book is [docs/brand/README.md](../docs/brand/README.md). Help and Support renders it from the Heron folder at build time, and `node docs/brand/tools/build_book.ts` (run from the repository root) writes the same text to `public/brand/index.html` and regenerates the book's contrast table. Both use the Markdown reader in `src/apps/markdown.ts`.

## Fonts

The interface uses Segoe UI when the visitor has it installed, and Selawik otherwise. Selawik 1.01 is self-hosted from its [release](https://github.com/microsoft/Selawik/releases/tag/1.01) under the SIL Open Font License 1.1; the licence text is `public/fonts/Selawik-OFL.txt`.

## Acknowledgements

The glass is [Canvas UI's](https://canvasui.dev) `Glass` component ([source](https://github.com/DavidHDev/canvas-ui)), vendored unchanged at `src/vendor/canvas-ui/Glass/GlassVanilla.ts` with its helper `src/vendor/canvas-ui/rect-cache.ts`, the upstream commit in `src/vendor/canvas-ui/SOURCE.md`, and its license at `src/vendor/canvas-ui/LICENSE.md`. Canvas UI is licensed under MIT with a Commons Clause: use, including commercial use, is permitted, but selling, sublicensing, or redistributing the components themselves, alone, bundled, or ported, is not. This site uses the component as part of the Heron site and does not redistribute it as a separate product.
