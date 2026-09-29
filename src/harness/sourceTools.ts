import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { posix } from "node:path"
import { Effect } from "effect"
import { z } from "zod"
import { type SourceCheckout, TREE_REFS, type TreeRef } from "../ports.ts"
import { displayPath, type LspClient, LspPool } from "./tools/lsp.ts"
import { fail, linesOf, page, runTool, SourceError } from "./tools/process.ts"

export { SourceError } from "./tools/process.ts"

const require = createRequire(import.meta.url)
/** ripgrep from @vscode/ripgrep 1.18.0 (ripgrep 15.0.0); the platform binary ships as an optional npm package. */
const RG: string = (() => {
  try {
    // The platform package is a dependency of @vscode/ripgrep, so it resolves only from that package's directory.
    const own = createRequire(require.resolve("@vscode/ripgrep"))
    return own.resolve(`@vscode/ripgrep-${process.platform}-${process.arch}/bin/rg`)
  } catch {
    return "rg"
  }
})()
/** ast-grep from @ast-grep/cli 0.45.3, resolved to its native binary so its install script never has to run. */
const AST_GREP: string = (() => {
  try {
    const { resolveBinaryPath } = require("@ast-grep/cli/postinstall.js") as { resolveBinaryPath: () => string | null }
    return resolveBinaryPath() ?? "ast-grep"
  } catch {
    return "ast-grep"
  }
})()

/** What every tool reads: the checkout, and the language servers started for it during one session. */
export interface ToolContext {
  readonly checkout: SourceCheckout
  readonly lsp: LspPool
}

/** A tool context whose language servers die when the scope closes. */
export const toolContext = (checkout: SourceCheckout) =>
  Effect.acquireRelease(
    Effect.sync((): ToolContext => ({ checkout, lsp: new LspPool(checkout.trees) })),
    (ctx) => Effect.sync(() => ctx.lsp.close())
  )

/** Repo-relative, forward slashes, no traversal, no pathspec magic. */
export const repoPath = (raw: string): string => {
  const path = raw.replace(/^(\.\/)+/, "")
  if (path.startsWith("/") || path.startsWith(":") || path.includes("\\") || path.includes("\0")) {
    throw fail(`path must be repository-relative: ${raw}`)
  }
  if (path.split("/").includes("..")) throw fail(`path must not contain "..": ${raw}`)
  return path
}

const GIT_FLAGS = ["--no-pager", "-c", "core.fsmonitor=false", "-c", "core.hooksPath=/dev/null", "-c", "core.quotePath=false"]
const git = (ctx: ToolContext, args: ReadonlyArray<string>) => runTool("git", ["--git-dir", ctx.checkout.gitDir, ...GIT_FLAGS, ...args])

const commitOf = (ctx: ToolContext, ref: TreeRef) => ctx.checkout.commits[ref]

/** Strips git's `<commit>:` prefix and a tool's `./` prefix so results carry repository paths only. */
const stripPrefix = (prefix: string, line: string) => (line.startsWith(prefix) ? line.slice(prefix.length) : line)

const refInput = z.enum(TREE_REFS).default("source").describe(
  "Which commit to read: source (the merge request head, default), target (the target branch tip), base (their merge base)"
)
const offsetInput = z.number().int().min(0).default(0).describe("Skip this many results; pass the previous result's `next` to continue")
const limitInput = (n: number) =>
  z.number().int().min(1).default(n).describe(`Results per page, default ${n}, no maximum. Every result gives the total and the next offset`)

const lineInput = z.number().int().min(1).describe("1-based line number")
const positionInput = {
  ref: refInput,
  path: z.string().min(1).describe("Repository-relative path of a .ts, .tsx, .js or .jsx file"),
  line: lineInput,
  column: z.number().int().min(1).optional().describe("1-based column of the identifier"),
  symbol: z.string().min(1).optional().describe("The identifier on that line; used instead of column")
}

const grepInput = {
  pattern: z.string().min(1).describe("Text to search for"),
  mode: z.enum(["literal", "regex"]).default("literal").describe("literal: fixed string; regex: POSIX extended regular expression"),
  ignoreCase: z.boolean().default(false),
  paths: z.array(z.string()).default([]).describe("Repository-relative globs limiting the search, e.g. src/**/*.ts"),
  context: z.number().int().min(0).default(0).describe("Lines of context around each match"),
  ref: refInput,
  offset: offsetInput,
  limit: limitInput(1000)
}

const listInput = {
  prefix: z.string().default("").describe("Repository-relative directory to list, e.g. src/"),
  glob: z.string().optional().describe("Glob the full path must match, e.g. **/*.test.ts"),
  ref: refInput,
  offset: offsetInput,
  limit: limitInput(5000)
}

const readInput = {
  path: z.string().min(1).describe("Repository-relative file path"),
  ref: refInput,
  startLine: z.number().int().min(1).optional().describe("First line to return; default 1"),
  endLine: z.number().int().min(1).optional().describe("Last line to return; default the end of the file")
}

const NAME = /^[A-Za-z0-9_+-]+$/
const rgInput = {
  pattern: z.string().min(1).describe("Regular expression (Rust regex syntax), or a literal with fixed: true"),
  fixed: z.boolean().default(false).describe("Treat the pattern as a literal string"),
  case: z.enum(["sensitive", "insensitive", "smart"]).default("sensitive").describe("smart: insensitive unless the pattern has an upper-case letter"),
  word: z.boolean().default(false).describe("Match whole words only"),
  multiline: z.boolean().default(false).describe("Let the pattern match across lines"),
  glob: z.array(z.string().min(1)).default([]).describe("Include globs, or exclude with a leading !, e.g. [\"src/**\", \"!**/*.test.ts\"]"),
  type: z.array(z.string().regex(NAME)).default([]).describe("ripgrep file types to include, e.g. ts, js, vue, css, json, md"),
  typeNot: z.array(z.string().regex(NAME)).default([]).describe("ripgrep file types to exclude"),
  context: z.number().int().min(0).default(0).describe("Lines of context before and after each match"),
  before: z.number().int().min(0).optional().describe("Lines of context before each match"),
  after: z.number().int().min(0).optional().describe("Lines of context after each match"),
  filesOnly: z.boolean().default(false).describe("Return only the paths of files that match"),
  ref: refInput,
  offset: offsetInput,
  limit: limitInput(1000)
}

const astInput = {
  pattern: z.string().min(1).describe("ast-grep pattern, e.g. `console.log($A)` or `useState($$$)`; $X matches one node, $$$ any number"),
  lang: z.string().regex(NAME).optional().describe("Pattern language, e.g. ts, tsx, js, html, css; default: inferred from each file"),
  globs: z.array(z.string().min(1)).default([]).describe("Include globs, or exclude with a leading !"),
  selector: z.string().regex(NAME).optional().describe("AST kind inside the pattern to report instead of the whole pattern"),
  strictness: z.enum(["cst", "smart", "ast", "relaxed", "signature", "template"]).optional(),
  ref: refInput,
  offset: offsetInput,
  limit: limitInput(500)
}

const COMMIT = /^[0-9a-f]{7,40}$/
const logInput = {
  ref: refInput,
  since: z.enum(TREE_REFS).optional().describe("List only commits reachable from ref and not from this one, e.g. ref source since base"),
  path: z.string().optional().describe("Only commits that touch this repository-relative path"),
  offset: offsetInput,
  limit: limitInput(200)
}
const showInput = {
  commit: z.string().min(1).describe("A commit id (7 to 40 hex characters) or source, target, base"),
  path: z.string().optional().describe("Limit the patch to this repository-relative path"),
  offset: offsetInput,
  limit: limitInput(2000)
}
const blameInput = {
  path: z.string().min(1).describe("Repository-relative file path"),
  ref: refInput,
  startLine: z.number().int().min(1).optional(),
  endLine: z.number().int().min(1).optional(),
  offset: offsetInput,
  limit: limitInput(2000)
}
const diffInput = {
  from: z.enum(TREE_REFS).default("base"),
  to: z.enum(TREE_REFS).default("source"),
  path: z.string().optional().describe("Limit the diff to this repository-relative path"),
  stat: z.boolean().default(false).describe("Return a per-file summary instead of the patch"),
  offset: offsetInput,
  limit: limitInput(2000)
}

type Args<S extends z.ZodRawShape> = z.infer<z.ZodObject<S>>

/** Replaces host paths with placeholders so no tool text reveals the machine layout. */
const scrub = (ctx: ToolContext, text: string) =>
  Object.values(ctx.checkout.trees).reduce((t, tree) => t.split(tree).join("<tree>"), text.split(ctx.checkout.gitDir).join("<repo>"))
const treeError = (ctx: ToolContext, stderr: string) => scrub(ctx, stderr.trim().split("\n").at(-1) ?? "")

const lineResult = (lines: ReadonlyArray<string>, offset: number, limit: number) => {
  const p = page(lines, offset, limit)
  return { total: p.total, offset: p.offset, next: p.next, lines: p.items }
}

const grep = (ctx: ToolContext, a: Args<typeof grepInput>) =>
  Effect.gen(function*() {
    const commit = commitOf(ctx, a.ref)
    const specs = a.paths.map((p) => `:(glob)${repoPath(p)}`)
    const out = yield* git(ctx, [
      "grep", "-n", "-I", "--no-color", "--full-name",
      a.mode === "literal" ? "-F" : "-E",
      ...(a.ignoreCase ? ["-i"] : []),
      ...(a.context > 0 ? ["-C", String(a.context)] : []),
      "-e", a.pattern, commit, "--", ...specs
    ])
    if (out.code !== 0 && out.code !== 1) return yield* fail(a.mode === "regex" ? "invalid pattern or path" : "grep failed")
    return lineResult(linesOf(out.stdout).map((l) => stripPrefix(`${commit}:`, l)), a.offset, a.limit)
  })

const listFiles = (ctx: ToolContext, a: Args<typeof listInput>) =>
  Effect.gen(function*() {
    const prefix = repoPath(a.prefix)
    const glob = a.glob === undefined ? null : repoPath(a.glob)
    const out = yield* git(ctx, ["ls-tree", "-r", "--name-only", "--full-tree", commitOf(ctx, a.ref), ...(prefix === "" ? [] : ["--", prefix])])
    if (out.code !== 0) return yield* fail("cannot list files at this commit")
    const all = linesOf(out.stdout)
    const matched = glob === null ? all : all.filter((p) => posix.matchesGlob(p, glob))
    const p = page(matched, a.offset, a.limit)
    return { total: p.total, offset: p.offset, next: p.next, paths: p.items }
  })

const readFile = (ctx: ToolContext, a: Args<typeof readInput>) =>
  Effect.gen(function*() {
    const path = repoPath(a.path)
    const object = `${commitOf(ctx, a.ref)}:${path}`
    const kind = yield* git(ctx, ["cat-file", "-t", object])
    if (kind.code !== 0) return yield* fail(`no such path at ${a.ref}: ${path}`)
    if (kind.stdout.trim() !== "blob") return yield* fail(`not a file: ${path} (use list_files for directories)`)
    const out = yield* git(ctx, ["cat-file", "blob", object])
    if (out.code !== 0) return yield* fail(`cannot read ${path}`)
    if (out.stdout.includes("\0")) return yield* fail(`binary file: ${path}`)
    const all = linesOf(out.stdout)
    const start = a.startLine ?? 1
    const end = Math.min(all.length, a.endLine ?? all.length)
    const text = all.slice(start - 1, end).map((l, i) => `${start + i}\t${l}`).join("\n")
    return { path, ref: a.ref, startLine: start, endLine: Math.max(end, start - 1), totalLines: all.length, text }
  })

const rg = (ctx: ToolContext, a: Args<typeof rgInput>) =>
  Effect.gen(function*() {
    const args = [
      "--no-config", "--hidden", "--no-ignore", "--line-number", "--with-filename", "--no-heading", "--color=never", "--sort=path",
      a.case === "insensitive" ? "--ignore-case" : a.case === "smart" ? "--smart-case" : "--case-sensitive",
      ...(a.fixed ? ["--fixed-strings"] : []),
      ...(a.word ? ["--word-regexp"] : []),
      ...(a.multiline ? ["--multiline"] : []),
      ...(a.filesOnly ? ["--files-with-matches"] : []),
      ...a.glob.map((g) => `--glob=${g}`),
      ...a.type.map((t) => `--type=${t}`),
      ...a.typeNot.map((t) => `--type-not=${t}`),
      ...(a.context > 0 ? [`--context=${a.context}`] : []),
      ...(a.before === undefined ? [] : [`--before-context=${a.before}`]),
      ...(a.after === undefined ? [] : [`--after-context=${a.after}`]),
      "--regexp", a.pattern, "--", "."
    ]
    const out = yield* runTool(RG, args, ctx.checkout.trees[a.ref])
    const lines = linesOf(out.stdout).map((l) => stripPrefix("./", l))
    if (out.code === 2 && lines.length === 0) return yield* fail(`rg: ${treeError(ctx, out.stderr)}`)
    if (out.code !== 0 && out.code !== 1 && out.code !== 2) return yield* fail("rg failed")
    return lineResult(lines, a.offset, a.limit)
  })

interface AstMatch {
  readonly path: string
  readonly line: number
  readonly column: number
  readonly text: string
}

const astGrep = (ctx: ToolContext, a: Args<typeof astInput>) =>
  Effect.gen(function*() {
    // --config=/dev/null: never read the reviewed repo's sgconfig.yml, whose customLanguages can load a native library.
    const noIgnore = ["hidden", "dot", "exclude", "global", "parent", "vcs"].map((k) => `--no-ignore=${k}`)
    const args = [
      "run", `--pattern=${a.pattern}`, "--json=stream", "--config=/dev/null", ...noIgnore,
      ...(a.lang === undefined ? [] : [`--lang=${a.lang}`]),
      ...(a.selector === undefined ? [] : [`--selector=${a.selector}`]),
      ...(a.strictness === undefined ? [] : [`--strictness=${a.strictness}`]),
      ...a.globs.map((g) => `--globs=${g}`),
      "."
    ]
    const out = yield* runTool(AST_GREP, args, ctx.checkout.trees[a.ref])
    if (out.code !== 0 && out.code !== 1) return yield* fail(`ast-grep: ${treeError(ctx, out.stderr) || "failed"}`)
    const matches: Array<AstMatch> = linesOf(out.stdout).flatMap((line) => {
      try {
        const m = JSON.parse(line) as { file: string; range: { start: { line: number; column: number } }; text: string }
        return [{ path: stripPrefix("./", m.file), line: m.range.start.line + 1, column: m.range.start.column + 1, text: m.text }]
      } catch {
        return []
      }
    })
    matches.sort((x, y) => (x.path < y.path ? -1 : x.path > y.path ? 1 : x.line - y.line || x.column - y.column))
    const p = page(matches, a.offset, a.limit)
    return { total: p.total, offset: p.offset, next: p.next, matches: p.items }
  })

const commitArg = (ctx: ToolContext, raw: string) => {
  if ((TREE_REFS as ReadonlyArray<string>).includes(raw)) return ctx.checkout.commits[raw as TreeRef]
  if (!COMMIT.test(raw)) throw fail(`commit must be 7 to 40 hex characters or source, target, base: ${raw}`)
  return raw
}
const pathArgs = (path: string | undefined) => (path === undefined || path === "" ? [] : ["--", repoPath(path)])

const gitLines = (ctx: ToolContext, args: ReadonlyArray<string>, what: string, offset: number, limit: number) =>
  Effect.gen(function*() {
    const out = yield* git(ctx, args)
    if (out.code !== 0) return yield* fail(`${what}: ${treeError(ctx, out.stderr) || `git exited ${out.code}`}`)
    return lineResult(linesOf(out.stdout), offset, limit)
  })

const gitLog = (ctx: ToolContext, a: Args<typeof logInput>) => {
  const range = a.since === undefined ? commitOf(ctx, a.ref) : `${commitOf(ctx, a.since)}..${commitOf(ctx, a.ref)}`
  return gitLines(ctx, ["log", "--format=%H %ad %an: %s", "--date=short", "--end-of-options", range, ...pathArgs(a.path)], "log", a.offset, a.limit)
}

const gitShow = (ctx: ToolContext, a: Args<typeof showInput>) =>
  Effect.suspend(() =>
    gitLines(
      ctx,
      ["show", "--format=fuller", "--stat", "--patch", "--no-ext-diff", "--no-textconv", "--no-color", "--end-of-options", commitArg(ctx, a.commit), ...pathArgs(a.path)],
      "show",
      a.offset,
      a.limit
    )
  )

const gitBlame = (ctx: ToolContext, a: Args<typeof blameInput>) =>
  Effect.suspend(() => {
    const range = a.startLine === undefined && a.endLine === undefined ? [] : ["-L", `${a.startLine ?? 1},${a.endLine ?? ""}`]
    return gitLines(ctx, ["blame", "-l", "--date=short", ...range, commitOf(ctx, a.ref), "--", repoPath(a.path)], "blame", a.offset, a.limit)
  })

const gitDiff = (ctx: ToolContext, a: Args<typeof diffInput>) =>
  gitLines(
    ctx,
    ["diff", "--no-ext-diff", "--no-textconv", "--no-color", "--find-renames", ...(a.stat ? ["--stat=200"] : []), commitOf(ctx, a.from), commitOf(ctx, a.to), ...pathArgs(a.path)],
    "diff",
    a.offset,
    a.limit
  )

// Language-server tools.

const lsp = <A>(f: () => Promise<A>) =>
  Effect.tryPromise({ try: f, catch: (e) => (e instanceof SourceError ? e : fail(`language server: ${e instanceof Error ? e.message : String(e)}`)) })

const SYMBOL_KINDS = [
  "", "file", "module", "namespace", "package", "class", "method", "property", "field", "constructor", "enum", "interface", "function",
  "variable", "constant", "string", "number", "boolean", "array", "object", "key", "null", "enum member", "struct", "event", "operator",
  "type parameter"
]
const kindName = (k: unknown) => (typeof k === "number" ? SYMBOL_KINDS[k] ?? String(k) : "symbol")

type LspRange = { readonly start: { readonly line: number; readonly character: number } }
type LspLocation = { readonly uri: string; readonly range: LspRange }

/** Reads each file once per call to show the source line a location points at. */
const lineReader = () => {
  const files = new Map<string, ReadonlyArray<string>>()
  return (uri: string, line: number): string => {
    let lines = files.get(uri)
    if (lines === undefined) {
      try {
        lines = readFileSync(new URL(uri), "utf8").split("\n")
      } catch {
        lines = []
      }
      files.set(uri, lines)
    }
    return (lines[line] ?? "").trim()
  }
}

const locations = (client: LspClient) => {
  const read = lineReader()
  return (l: LspLocation) => ({
    path: displayPath(client.root, l.uri),
    line: l.range.start.line + 1,
    column: l.range.start.character + 1,
    text: read(l.uri, l.range.start.line)
  })
}

const asLocations = (u: unknown): Array<LspLocation> =>
  (Array.isArray(u) ? u : u === null || u === undefined ? [] : [u]).flatMap((l: Record<string, unknown>) =>
    typeof l["uri"] === "string"
      ? [l as unknown as LspLocation]
      : typeof l["targetUri"] === "string"
      ? [{ uri: l["targetUri"] as string, range: (l["targetSelectionRange"] ?? l["targetRange"]) as LspRange }]
      : []
  )

const positionOf = async (client: LspClient, a: Args<typeof positionInput>) => {
  const path = repoPath(a.path)
  const uri = await client.open(path)
  const text = readFileSync(`${client.root}/${path}`, "utf8").split("\n")[a.line - 1]
  if (text === undefined) throw fail(`${path} has no line ${a.line}`)
  let character: number
  if (a.symbol !== undefined) {
    const escaped = a.symbol.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    const found = new RegExp(`(?<![\\w$])${escaped}(?![\\w$])`).exec(text)
    if (found === null) throw fail(`\`${a.symbol}\` is not on line ${a.line} of ${path}`)
    character = found.index
  } else if (a.column !== undefined) character = a.column - 1
  else throw fail("give a column or a symbol")
  return { textDocument: { uri }, position: { line: a.line - 1, character } }
}

const definition = (ctx: ToolContext, a: Args<typeof positionInput>) =>
  lsp(async () => {
    const client = ctx.lsp.get(a.ref)
    const result = await client.request("textDocument/definition", await positionOf(client, a))
    return { locations: asLocations(result).map(locations(client)) }
  })

const referencesInput = { ...positionInput, includeDeclaration: z.boolean().default(true), offset: offsetInput, limit: limitInput(1000) }
const references = (ctx: ToolContext, a: Args<typeof referencesInput>) =>
  lsp(async () => {
    const client = ctx.lsp.get(a.ref)
    const params = { ...(await positionOf(client, a)), context: { includeDeclaration: a.includeDeclaration } }
    const all = asLocations(await client.request("textDocument/references", params)).map(locations(client))
    const p = page(all, a.offset, a.limit)
    return { total: p.total, offset: p.offset, next: p.next, locations: p.items }
  })

const hoverText = (contents: unknown): string => {
  if (typeof contents === "string") return contents
  if (Array.isArray(contents)) return contents.map(hoverText).join("\n\n")
  if (typeof contents === "object" && contents !== null && "value" in contents) return String((contents as { value: unknown }).value)
  return ""
}
const hover = (ctx: ToolContext, a: Args<typeof positionInput>) =>
  lsp(async () => {
    const client = ctx.lsp.get(a.ref)
    const result = (await client.request("textDocument/hover", await positionOf(client, a))) as { contents?: unknown } | null
    return { hover: result === null ? "" : hoverText(result.contents).trim() }
  })

interface DocSymbol {
  readonly name: string
  readonly kind: string
  readonly line: number
  readonly depth: number
}
const flatten = (symbols: ReadonlyArray<Record<string, unknown>>, depth: number): Array<DocSymbol> =>
  symbols.flatMap((s) => {
    const range = (s["selectionRange"] ?? s["range"] ?? (s["location"] as Record<string, unknown> | undefined)?.["range"]) as LspRange | undefined
    const own = { name: String(s["name"]), kind: kindName(s["kind"]), line: (range?.start.line ?? 0) + 1, depth }
    return [own, ...flatten(Array.isArray(s["children"]) ? s["children"] : [], depth + 1)]
  })

const documentSymbolsInput = { ref: refInput, path: positionInput.path }
const documentSymbols = (ctx: ToolContext, a: Args<typeof documentSymbolsInput>) =>
  lsp(async () => {
    const client = ctx.lsp.get(a.ref)
    const uri = await client.open(repoPath(a.path))
    const result = await client.request("textDocument/documentSymbol", { textDocument: { uri } })
    return { symbols: flatten(Array.isArray(result) ? result : [], 0) }
  })

/** A workspace query needs one open file so tsserver loads a project; the first TypeScript file under src/ or the root. */
const ensureProject = async (ctx: ToolContext, ref: TreeRef, client: LspClient) => {
  if (client.openCount > 0) return
  const listed = await Effect.runPromise(git(ctx, ["ls-tree", "-r", "--name-only", "--full-tree", commitOf(ctx, ref)]))
  const files = linesOf(listed.stdout).filter((p) => /\.(ts|tsx|mts|cts)$/.test(p) && !p.endsWith(".d.ts") && !p.includes("node_modules/"))
  const first = files.find((p) => p.startsWith("src/")) ?? files[0]
  if (first === undefined) throw fail(`no TypeScript file at ${ref}`)
  await client.open(first)
}

const workspaceSymbolsInput = {
  query: z.string().min(1).describe("Symbol name or prefix"),
  ref: refInput,
  offset: offsetInput,
  limit: limitInput(500)
}
const workspaceSymbols = (ctx: ToolContext, a: Args<typeof workspaceSymbolsInput>) =>
  lsp(async () => {
    const client = ctx.lsp.get(a.ref)
    await ensureProject(ctx, a.ref, client)
    const result = await client.request("workspace/symbol", { query: a.query })
    const at = locations(client)
    const all = (Array.isArray(result) ? result : []).map((s: Record<string, unknown>) => ({
      name: String(s["name"]),
      kind: kindName(s["kind"]),
      container: typeof s["containerName"] === "string" ? s["containerName"] : null,
      ...at(s["location"] as LspLocation)
    }))
    const p = page(all, a.offset, a.limit)
    return { total: p.total, offset: p.offset, next: p.next, symbols: p.items }
  })

const SEVERITY = ["", "error", "warning", "information", "hint"]
const diagnostics = (ctx: ToolContext, a: Args<typeof documentSymbolsInput>) =>
  lsp(async () => {
    const client = ctx.lsp.get(a.ref)
    const uri = await client.open(repoPath(a.path))
    const found = await client.diagnosticsOf(uri)
    return {
      diagnostics: found.map((d) => {
        const x = d as { range: LspRange; severity?: number; code?: unknown; message: string }
        return {
          line: x.range.start.line + 1,
          column: x.range.start.character + 1,
          severity: SEVERITY[x.severity ?? 1] ?? "error",
          code: x.code ?? null,
          message: x.message
        }
      })
    }
  })

/** One tool definition, rendered as MCP tools and as AI SDK tools. `run` parses its own input. */
export interface SourceTool {
  readonly name: string
  readonly description: string
  readonly input: z.ZodRawShape
  readonly run: (ctx: ToolContext, args: unknown) => Effect.Effect<unknown, SourceError>
}

const define = <S extends z.ZodRawShape, A>(
  name: string,
  description: string,
  input: S,
  run: (ctx: ToolContext, args: Args<S>) => Effect.Effect<A, SourceError>
): SourceTool => ({
  name,
  description,
  input,
  run: (ctx, args) =>
    Effect.suspend(() => {
      const parsed = z.object(input).safeParse(args)
      if (!parsed.success) return Effect.fail(fail(`invalid arguments: ${z.prettifyError(parsed.error)}`))
      return run(ctx, parsed.data)
    }).pipe(Effect.catchDefect((d) => d instanceof SourceError ? Effect.fail(d) : Effect.fail(fail("internal tool error"))))
})

const PAGED = "Results are paged: the answer gives `total` and `next`; call again with offset set to `next` for the rest."
const LSP_NOTE =
  "Runs Heron's own TypeScript 5.9 language server on the chosen tree. The reviewed repository's dependencies are not installed, so types that come from packages in node_modules resolve to `any` or are missing; types defined in the repository are exact."

export const sourceTools: ReadonlyArray<SourceTool> = [
  define("grep", `Search file contents at one commit with git grep. Returns path:line:text lines. ${PAGED}`, grepInput, grep),
  define("list_files", `List files at one commit, optionally under a directory prefix and filtered by a glob. ${PAGED}`, listInput, listFiles),
  define(
    "read_file",
    "Read a whole file at one commit, or the lines from startLine to endLine. Returns numbered lines and the total line count.",
    readInput,
    readFile
  ),
  define(
    "rg",
    `Search one commit's working tree with ripgrep: regex or literal, case modes, word and multiline matching, include and exclude globs, file types and context. Searches hidden and git-ignored files too. Returns path:line:text lines. ${PAGED}`,
    rgInput,
    rg
  ),
  define(
    "ast_grep",
    `Structural code search with ast-grep: match syntax, not text, e.g. every call \`fetch($URL, $$$)\`. Returns path, line, column and the matched code. ${PAGED}`,
    astInput,
    astGrep
  ),
  define("git_log", `Commit history (id, date, author, subject) of one commit, optionally since another and for one path. ${PAGED}`, logInput, gitLog),
  define("git_show", `One commit's message, file summary and patch, optionally for one path. ${PAGED}`, showInput, gitShow),
  define("git_blame", `Who last changed each line of a file at one commit, optionally for a line range. ${PAGED}`, blameInput, gitBlame),
  define(
    "git_diff",
    `The diff between two of base, source and target, optionally for one path or as a per-file summary. base to source is the merge request's change. ${PAGED}`,
    diffInput,
    gitDiff
  ),
  define("definition", `Go to the definition of the identifier at a position. ${LSP_NOTE}`, positionInput, definition),
  define("references", `Every reference to the identifier at a position, across the project. ${PAGED} ${LSP_NOTE}`, referencesInput, references),
  define("hover", `The type and documentation of the identifier at a position. ${LSP_NOTE}`, positionInput, hover),
  define("document_symbols", `Every symbol declared in one file, with its kind, line and nesting depth. ${LSP_NOTE}`, documentSymbolsInput, documentSymbols),
  define("workspace_symbols", `Find symbols by name across the project. ${PAGED} ${LSP_NOTE}`, workspaceSymbolsInput, workspaceSymbols),
  define("diagnostics", `TypeScript errors and warnings in one file. ${LSP_NOTE}`, documentSymbolsInput, diagnostics)
]

export const sourceToolNames = sourceTools.map((t) => t.name)

/** Runs a tool and renders the model-facing text; failures become an error text, never a host path. */
export const runSourceTool = (tool: SourceTool, ctx: ToolContext, args: unknown) =>
  tool.run(ctx, args).pipe(
    Effect.map((result) => ({ ok: true as const, text: JSON.stringify(result) })),
    Effect.catch((e) => Effect.succeed({ ok: false as const, text: scrub(ctx, e.message) }))
  )
