import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative, resolve } from "node:path"
import { defineConfig, type Plugin } from "vite"

// The Heron folder on the desktop is the real repository, read at build time.
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
      return `export const heronFiles = ${JSON.stringify(files)}`
    },
  }
}

export default defineConfig({
  base: "/heron/",
  plugins: [heronFiles()],
  build: { target: "es2022", assetsInlineLimit: 0, chunkSizeWarningLimit: 900 },
})
