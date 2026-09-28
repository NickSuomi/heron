import { defineConfig } from "vite"

// GitHub Pages serves this site at /heron/. Relative asset URLs keep the build base-path independent.
export default defineConfig({ base: "./", build: { target: "es2022", assetsInlineLimit: 0 } })
