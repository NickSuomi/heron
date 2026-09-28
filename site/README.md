# Heron site

The public site for [Heron](../README.md), deployed to [GitHub Pages](https://nicksuomi.github.io/heron/) by `.github/workflows/pages.yml`. It is a static [Vite](https://vite.dev) build with no framework: one page, `index.html`, plus the design book at [`/brand/`](public/brand/index.html).

This is its own package, with its own `package.json` and `pnpm-lock.yaml`, separate from the root Heron package.

## Develop

```sh
cd site
pnpm install
pnpm dev
```

## Build

```sh
pnpm build
```

Output goes to `site/dist/`. Asset URLs are relative, so the build works under the `/heron/` base path on GitHub Pages and at the root of a local server.

## How the page works

The page is one scrolling face. Canvas UI's Bend folds the face over its top and bottom edges, and the heron stands on the top rim. `src/main.ts` computes the rim position from Bend's fold geometry, marks each caught line as it reaches the edge, and lights its finding. `src/diff.ts` holds the example merge request. `?css` forces the CSS fold and `?flat` lays the page out as a plain document for full-length captures.

Bend needs the HTML-in-canvas API and WebGL 2. Without either, the page uses a CSS fold built from scroll-driven animations (`animation-timeline: view()`), and with `prefers-reduced-motion: reduce` the page is still, with every finding shown.

## Origin trial

Bend's native path needs Chrome's HTML-in-canvas origin trial for `https://nicksuomi.github.io`. Register or renew it on the [HTML-in-canvas origin trial page](https://developer.chrome.com/origintrials/#/registration/3609758246639763457). The token sits in the `<meta http-equiv="origin-trial">` tag in the head of `index.html`.

The current token expires on 2026-10-20 or with the Chrome 154 rollout, whichever comes first. To renew it, press **RENEW** on that page and replace the meta tag's `content` value with the new token. Without a valid token, visitors get the CSS fold.

## Content

Every claim on the page matches the root [README.md](../README.md) and the docs it links. The merge request, its diff, and its review are an example; the page says so and does not show invented token counts, durations, or costs.

## Design book

The design book at `/brand/` is generated from [`docs/brand/`](../docs/brand/) in the root package. Run `pnpm install` here first, then the steps in [docs/brand/README.md](../docs/brand/README.md#rebuilding). They write `public/brand/index.html` and copy the assets and fonts into `public/brand/`.

## Fonts

Inter and JetBrains Mono are self-hosted from the `@fontsource-variable` packages under the SIL Open Font License 1.1. The licence texts are in `public/fonts/`.

## Acknowledgements

The fold is [Canvas UI's](https://canvasui.dev) `Bend` component ([source](https://github.com/DavidHDev/canvas-ui)), vendored unchanged at `src/canvas-ui/Bend/BendVanilla.ts` with its helper `src/canvas-ui/rect-cache.ts`, the upstream commit in `src/canvas-ui/SOURCE.md`, and its license at `src/canvas-ui/LICENSE.md`. Canvas UI is licensed under MIT with a Commons Clause: use, including commercial use, is permitted, but selling, sublicensing, or redistributing the components themselves, alone, bundled, or ported, is not. This site uses the component as part of the Heron site and does not redistribute it as a separate product.
