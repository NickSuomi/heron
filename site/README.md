# Heron site

The public site for [Heron](../README.md), built with [Astro](https://astro.build) in static output mode and deployed to [GitHub Pages](https://nicksuomi.github.io/heron/) by `.github/workflows/pages.yml`.

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

Output goes to `site/dist/`.

## Content

Every claim on the page matches the root [README.md](../README.md) and the docs it links. The design book that documents the brand lives at [`/brand/`](public/brand/index.html), generated from [`docs/brand/`](../docs/brand/) in the root package.

## Acknowledgements

The hero's ripple effect is [Canvas UI's](https://canvasui.dev) `Ripple` component ([source](https://github.com/DavidHDev/canvas-ui)), vendored at `src/canvas-ui/ripple/RippleVanilla.ts` with its upstream license at `src/canvas-ui/LICENSE.md`. Canvas UI is licensed under MIT with a Commons Clause: use, including commercial use, is permitted, but selling, sublicensing, or redistributing the components themselves, alone, bundled, or ported, is not. This site uses the component as part of the Heron site and does not redistribute it as a separate product.
