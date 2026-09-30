import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { pathToFileURL } from "node:url"
import { afterAll, describe, expect, it } from "@effect/vitest"
import { Effect, Exit, Scope } from "effect"
import { runSourceTool, sourceTools, toolContext, type ToolContext } from "../src/harness/sourceTools.ts"
import { isReadable } from "../src/harness/tools/lsp.ts"
import { makeRepo } from "./fixtures/harness/repo.ts"

// Files on the review host outside the reviewed tree, each declaring one `vault…` name whose type holds an
// `acme-outside-…` text. The tree's tsconfig reaches for every one of them; none may reach a tool result.
const outsideFiles = (outside: string): Readonly<Record<string, string>> => ({
  "included/secret.ts": "declare const vaultIncludeSecret: \"acme-outside-include\"\n",
  "base.json": JSON.stringify({ files: ["./extended.ts"] }),
  "extended.ts": "declare const vaultExtendsSecret: \"acme-outside-extends\"\n",
  "types/acme-vault/index.d.ts": "declare const vaultTypeRootSecret: \"acme-outside-typeroot\"\n",
  "paths/keys.ts": "export const vaultPathsSecret = \"acme-outside-paths\" as const\n",
  "linked.ts": "export const vaultLinkSecret = \"acme-outside-link\" as const\n",
  "vendor/dir.ts": "export const vaultDirSecret = \"acme-outside-dir\" as const\n",
  "ref/tsconfig.json": JSON.stringify({ compilerOptions: { composite: true }, files: ["ref.ts"] }),
  "ref/ref.ts": "export const vaultReferenceSecret = \"acme-outside-reference\" as const\n",
  "tsconfig.json": JSON.stringify({ files: ["./above.ts"] }),
  "above.ts": "declare const vaultAboveSecret: \"acme-outside-above\"\n"
})

const index = "leaky/src/index.ts"
const importLine = (line: number) => indexLines[line - 1]!
const indexLines = [
  "import { vaultPathsSecret } from \"@vault/keys\"",
  "import { vaultLinkSecret } from \"./linked.ts\"",
  "import { vaultDirSecret } from \"./vendor/dir.ts\"",
  "import { local } from \"./local.ts\"",
  "",
  "export const probe: Array<number> = [vaultIncludeSecret, vaultExtendsSecret, vaultTypeRootSecret, vaultPathsSecret, local]",
  "export const more: Array<number> = [vaultLinkSecret, vaultDirSecret]",
  ""
]
const leakyFiles = (outside: string): Readonly<Record<string, string>> => ({
  "leaky/tsconfig.json": JSON.stringify({
    extends: `${outside}/base.json`,
    compilerOptions: {
      strict: true,
      module: "esnext",
      moduleResolution: "bundler",
      target: "es2022",
      noEmit: true,
      allowImportingTsExtensions: true,
      typeRoots: [`${outside}/types`],
      paths: { "@vault/*": [`${outside}/paths/*`] }
    },
    include: ["src", `${outside}/included/**/*`],
    references: [{ path: `${outside}/ref` }]
  }),
  "leaky/src/local.ts": "export const local = 1\n",
  [index]: indexLines.join("\n")
})

// The tree lives in the repository's temporary directory; the outside files sit next to it, where tsserver can read
// them unless Heron stops it. The tree also gets a file and a directory symlinked out of it.
const outsideOf = (root: string) => join(root, "outside")
const repo = makeRepo((root) => leakyFiles(outsideOf(root)))
const outside = outsideOf(repo.root)
for (const [path, content] of Object.entries(outsideFiles(outside))) {
  mkdirSync(dirname(join(outside, path)), { recursive: true })
  writeFileSync(join(outside, path), content)
}
// The tree root's parent holds a tsconfig.json too, which tsserver finds by walking up from an opened file.
writeFileSync(join(repo.root, "tsconfig.json"), JSON.stringify({ files: ["./outside/above.ts"] }))
symlinkSync(join(outside, "linked.ts"), join(repo.source.trees.source, "leaky/src/linked.ts"))
symlinkSync(join(outside, "vendor"), join(repo.source.trees.source, "leaky/src/vendor"))

const scope = Effect.runSync(Scope.make())
const ctx: ToolContext = Effect.runSync(Scope.provide(toolContext(repo.source), scope))
afterAll(() => {
  Effect.runSync(Scope.close(scope, Exit.void))
  repo.cleanup()
})

const results: Array<unknown> = []
const json = (name: string, args: unknown) =>
  runSourceTool(sourceTools.find((t) => t.name === name)!, ctx, args).pipe(
    Effect.map((out) => {
      expect(out.ok ? "ok" : out.text).toBe("ok")
      const parsed = JSON.parse(out.text) as unknown
      results.push(parsed)
      return parsed
    })
  )

describe("language server with a tsconfig that points outside the tree", () => {
  it.effect("still answers for the tree's own code", () =>
    Effect.gen(function*() {
      expect(yield* json("definition", { path: index, line: 6, symbol: "local" })).toEqual({
        locations: [{ path: "leaky/src/local.ts", line: 1, column: 14, text: "export const local = 1" }]
      })
    }), { timeout: 60_000 })

  it.effect("finds no declaration outside for a name, whichever tsconfig key or symbolic link names its file", () =>
    Effect.gen(function*() {
      for (const symbol of ["vaultIncludeSecret", "vaultExtendsSecret", "vaultTypeRootSecret"]) {
        expect(yield* json("definition", { path: index, line: 6, symbol })).toEqual({ locations: [] })
        expect(yield* json("hover", { path: index, line: 6, symbol })).toEqual({ hover: "```typescript\nany\n```" })
      }
      // An import whose module tsserver cannot read leads only to the import itself.
      const imports: ReadonlyArray<readonly [string, number]> = [["vaultPathsSecret", 1], ["vaultLinkSecret", 2], ["vaultDirSecret", 3]]
      for (const [symbol, line] of imports) {
        expect(yield* json("definition", { path: index, line: line === 1 ? 6 : 7, symbol })).toEqual({
          locations: [{ path: index, line, column: 10, text: importLine(line) }]
        })
        expect(yield* json("hover", { path: index, line: line === 1 ? 6 : 7, symbol })).toEqual({
          hover: `\`\`\`typescript\nimport ${symbol}\n\`\`\``
        })
      }
    }), { timeout: 60_000 })

  it.effect("lists no outside symbol and reports each outside name as missing", () =>
    Effect.gen(function*() {
      expect(yield* json("workspace_symbols", { query: "vault" })).toEqual({
        total: 3,
        offset: 0,
        next: null,
        symbols: [1, 2, 3].map((line) => ({
          name: /\{ (\w+) \}/.exec(importLine(line))![1],
          kind: "variable",
          container: null,
          path: index,
          line,
          column: 10,
          text: importLine(line)
        }))
      })
      expect(yield* json("diagnostics", { path: index })).toEqual({
        diagnostics: [
          { line: 1, column: 34, severity: "error", code: 2307, message: "Cannot find module '@vault/keys' or its corresponding type declarations." },
          { line: 2, column: 33, severity: "error", code: 2307, message: "Cannot find module './linked.ts' or its corresponding type declarations." },
          { line: 3, column: 32, severity: "error", code: 2307, message: "Cannot find module './vendor/dir.ts' or its corresponding type declarations." },
          { line: 6, column: 38, severity: "error", code: 2552, message: "Cannot find name 'vaultIncludeSecret'. Did you mean 'vaultLinkSecret'?" },
          { line: 6, column: 58, severity: "error", code: 2304, message: "Cannot find name 'vaultExtendsSecret'." },
          { line: 6, column: 78, severity: "error", code: 2304, message: "Cannot find name 'vaultTypeRootSecret'." }
        ]
      })
      expect(JSON.stringify(results)).not.toContain("acme-outside")
    }), { timeout: 60_000 })
})

describe("isReadable", () => {
  it("reads a location's text only when its real path is in the tree or Heron's own packages", () => {
    const base = mkdtempSync(join(tmpdir(), "heron-readable-"))
    try {
      const tree = join(base, "tree")
      const outside = join(base, "outside")
      mkdirSync(tree)
      mkdirSync(outside)
      writeFileSync(join(tree, "inside.ts"), "export const a = 1\n")
      writeFileSync(join(outside, "secret.ts"), "export const secret = 1\n")
      symlinkSync(join(outside, "secret.ts"), join(tree, "link.ts"))
      const uri = (path: string) => pathToFileURL(path).href
      expect([
        isReadable(tree, uri(join(tree, "inside.ts"))),
        isReadable(tree, uri(join(tree, "link.ts"))),
        isReadable(tree, uri(join(outside, "secret.ts"))),
        isReadable(tree, uri(join(tree, "missing.ts")))
      ]).toEqual([true, false, false, false])
    } finally {
      rmSync(base, { recursive: true, force: true })
    }
  })
})
