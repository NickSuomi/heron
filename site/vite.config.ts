import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative, resolve } from "node:path"
import { defineConfig, type Plugin } from "vite"

import { heronBuild } from "./build/heron-build.ts"
import { readmeText } from "./build/readme-text.ts"

// The Heron folder on the desktop is the real repository, read at build time. README.txt on the desktop is its
// README.md as plain text (build/readme-text.ts).
const repoRoot = resolve(import.meta.dirname, "..")
const sources = ["README.md", "heron.config.example.json", "docs", "src"]
const textFile = /\.(md|ts|json|css|txt)$/

const walk = (path: string): ReadonlyArray<string> =>
  statSync(path).isDirectory()
    ? readdirSync(path).sort().flatMap((name) => walk(join(path, name)))
    : textFile.test(path) ? [path] : []

const heronFiles = (): Plugin => {
  const id = "virtual:heron-files"
  return {
    name: "heron-files",
    resolveId: (source) => (source === id ? `\0${id}` : undefined),
    load(loadId) {
      if (loadId !== `\0${id}`) return undefined
      const files = sources.flatMap((source) => walk(join(repoRoot, source))).map((path) => {
        this.addWatchFile(path)
        return { path: relative(repoRoot, path).split("\\").join("/"), content: readFileSync(path, "utf8") }
      })
      const readme = files.find((file) => file.path === "README.md")?.content ?? ""
      return `export const heronFiles = ${JSON.stringify(files)}\nexport const readmeText = ${JSON.stringify(readmeText(readme))}`
    },
  }
}

export default defineConfig({
  base: "/heron/",
  plugins: [heronFiles(), heronBuild()],
  build: { target: "es2022", assetsInlineLimit: 0, chunkSizeWarningLimit: 900 },
})
