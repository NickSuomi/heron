import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative, resolve } from "node:path"
import type { Plugin } from "vite"
import { defineConfig } from "vitest/config"

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

// Two virtual modules. `virtual:heron-files` lists the paths, small enough for the first load. The text of
// the files is 260 kB and is only read when a file opens, so `virtual:heron-file-contents` is its own chunk,
// fetched by `loadFileContents` in src/domain/vfs.ts while the boot screen shows.
const heronFiles = (): Plugin => {
  const listId = "virtual:heron-files"
  const contentsId = "virtual:heron-file-contents"
  const read = (addWatchFile: (path: string) => void) =>
    sources.flatMap((source) => walk(join(repoRoot, source))).map((path) => {
      addWatchFile(path)
      return { path: relative(repoRoot, path).split("\\").join("/"), content: readFileSync(path, "utf8") }
    })
  return {
    name: "heron-files",
    resolveId: (source) => (source === listId || source === contentsId ? `\0${source}` : undefined),
    load(loadId) {
      if (loadId === `\0${listId}`) {
        return `export const heronPaths = ${JSON.stringify(read((path) => this.addWatchFile(path)).map((file) => file.path))}`
      }
      if (loadId !== `\0${contentsId}`) return undefined
      const files = read((path) => this.addWatchFile(path))
      const readme = files.find((file) => file.path === "README.md")?.content ?? ""
      return `export const heronFiles = ${JSON.stringify(files)}\nexport const readmeText = ${JSON.stringify(readmeText(readme))}`
    },
  }
}

export default defineConfig({
  base: "/heron/",
  plugins: [heronFiles(), heronBuild()],
  test: { setupFiles: ["./src/testSetup.ts"] },
  build: { target: "es2022", assetsInlineLimit: 0, chunkSizeWarningLimit: 900 },
})
