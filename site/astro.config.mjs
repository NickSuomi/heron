import { defineConfig } from "astro/config";

// GitHub Pages serves this project at /heron/.
export default defineConfig({
  site: "https://nicksuomi.github.io",
  base: "/heron",
  outDir: "./dist",
  build: {
    assets: "assets",
  },
});
