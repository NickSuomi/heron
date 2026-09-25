import { spawn } from "node:child_process"
import { posix } from "node:path"
import { Data, Effect } from "effect"
import { z } from "zod"
import type { SourceCheckout } from "../ports.ts"

/** A tool failure the model may read; never carries the host git directory. */
export class SourceError extends Data.TaggedError("SourceError")<{ readonly message: string }> {}

const fail = (message: string) => new SourceError({ message })

/** Repo-relative, forward slashes, no traversal, no pathspec magic. */
export const repoPath = (raw: string): string => {
  const path = raw.replace(/^(\.\/)+/, "")
  if (path.startsWith("/") || path.startsWith(":") || path.includes("\\") || path.includes("\0")) {
    throw fail(`path must be repository-relative: ${raw}`)
  }
  if (path.split("/").includes("..")) throw fail(`path must not contain "..": ${raw}`)
  return path
}

interface GitOutput {
  readonly lines: ReadonlyArray<string>
  /** True when the process produced more than `maxLines` lines and was stopped early. */
  readonly cut: boolean
  readonly code: number | null
  readonly stderr: string
}

const GIT_OUTPUT_BYTES = 8 * 1024 * 1024

/** Runs git against the bare repository; stops reading after `maxLines + 1` lines. */
const git = (source: SourceCheckout, args: ReadonlyArray<string>, maxLines = Number.POSITIVE_INFINITY) =>
  Effect.callback<GitOutput, SourceError>((resume, signal) => {
    const child = spawn("git", ["--git-dir", source.gitDir, "--no-pager", ...args], {
      stdio: ["ignore", "pipe", "pipe"],
      env: { PATH: process.env["PATH"] ?? "/usr/bin:/bin", GIT_CONFIG_NOSYSTEM: "1", HOME: "/nonexistent", LC_ALL: "C" }
    })
    const lines: Array<string> = []
    let partial = ""
    let bytes = 0
    let cut = false
    let stderr = ""
    const stop = () => child.kill("SIGKILL")
    signal.addEventListener("abort", stop)
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
      if (cut) return
      bytes += chunk.length
      const parts = (partial + chunk).split("\n")
      partial = parts.pop()!
      for (const line of parts) {
        if (lines.length > maxLines) break
        lines.push(line)
      }
      if (lines.length > maxLines || bytes > GIT_OUTPUT_BYTES) {
        cut = true
        stop()
      }
    })
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
      if (stderr.length < 4096) stderr += chunk
    })
    child.on("error", () => resume(Effect.fail(fail("git is not available"))))
    child.on("close", (code) => {
      signal.removeEventListener("abort", stop)
      if (!cut && partial !== "") lines.push(partial)
      resume(Effect.succeed({ lines: lines.slice(0, maxLines), cut: cut || lines.length > maxLines, code, stderr }))
    })
  })

/** The file part of git's `<commit>:<path>:<line>:` prefix is stripped so results carry repo paths only. */
const stripCommit = (source: SourceCheckout, line: string) =>
  line.startsWith(`${source.commit}:`) ? line.slice(source.commit.length + 1) : line

export interface GrepResult {
  /** `path:line:text` for a match, `path-line-text` for context, `--` between groups (git grep format). */
  readonly lines: ReadonlyArray<string>
  readonly truncated: boolean
}

export interface ListResult {
  readonly paths: ReadonlyArray<string>
  readonly truncated: boolean
}

export interface ReadResult {
  readonly path: string
  readonly startLine: number
  readonly endLine: number
  readonly totalLines: number
  /** Each line prefixed with its 1-based number and a tab. */
  readonly text: string
  readonly truncated: boolean
}

const grepInput = {
  pattern: z.string().min(1).describe("Text to search for"),
  mode: z.enum(["literal", "regex"]).default("literal").describe("literal: fixed string; regex: POSIX extended regular expression"),
  ignoreCase: z.boolean().default(false),
  paths: z.array(z.string()).default([]).describe("Repository-relative globs limiting the search, e.g. src/**/*.ts"),
  context: z.number().int().min(0).max(10).default(0).describe("Lines of context around each match"),
  maxLines: z.number().int().min(1).max(500).default(200).describe("Output line cap; truncated is true when more exist")
}

const listInput = {
  prefix: z.string().default("").describe("Repository-relative directory to list, e.g. src/"),
  glob: z.string().optional().describe("Glob the full path must match, e.g. **/*.test.ts"),
  maxPaths: z.number().int().min(1).max(5000).default(1000)
}

const readInput = {
  path: z.string().min(1).describe("Repository-relative file path"),
  startLine: z.number().int().min(1).default(1),
  maxLines: z.number().int().min(1).max(2000).default(400)
}

const READ_CHARS = 60_000

const grep = (source: SourceCheckout, a: z.infer<z.ZodObject<typeof grepInput>>) =>
  Effect.gen(function*() {
    const specs = a.paths.map((p) => `:(glob)${repoPath(p)}`)
    const flags = [
      "grep", "-n", "-I", "--no-color", "--full-name",
      a.mode === "literal" ? "-F" : "-E",
      ...(a.ignoreCase ? ["-i"] : []),
      ...(a.context > 0 ? ["-C", String(a.context)] : []),
      "-e", a.pattern, source.commit, "--", ...specs
    ]
    const out = yield* git(source, flags, a.maxLines)
    if (out.code !== null && out.code > 1 && !out.cut) return yield* fail(a.mode === "regex" ? "invalid pattern or path" : "grep failed")
    return { lines: out.lines.map((l) => stripCommit(source, l)), truncated: out.cut } satisfies GrepResult
  })

const listFiles = (source: SourceCheckout, a: z.infer<z.ZodObject<typeof listInput>>) =>
  Effect.gen(function*() {
    const prefix = repoPath(a.prefix)
    const glob = a.glob === undefined ? null : repoPath(a.glob)
    const out = yield* git(source, ["ls-tree", "-r", "--name-only", "--full-tree", source.commit, ...(prefix === "" ? [] : ["--", prefix])])
    if (out.code !== 0) return yield* fail("cannot list files at this commit")
    const matched = glob === null ? out.lines : out.lines.filter((p) => posix.matchesGlob(p, glob))
    return { paths: matched.slice(0, a.maxPaths), truncated: matched.length > a.maxPaths } satisfies ListResult
  })

const readFile = (source: SourceCheckout, a: z.infer<z.ZodObject<typeof readInput>>) =>
  Effect.gen(function*() {
    const path = repoPath(a.path)
    const kind = yield* git(source, ["cat-file", "-t", `${source.commit}:${path}`])
    if (kind.code !== 0) return yield* fail(`no such path at this commit: ${path}`)
    if (kind.lines[0] !== "blob") return yield* fail(`not a file: ${path} (use list_files for directories)`)
    const out = yield* git(source, ["cat-file", "blob", `${source.commit}:${path}`])
    if (out.code !== 0) return yield* fail(`cannot read ${path}`)
    if (out.cut) return yield* fail(`file too large to read: ${path}`)
    const all = out.lines
    if (all.some((l) => l.includes("\0"))) return yield* fail(`binary file: ${path}`)
    const first = a.startLine - 1
    const window: Array<string> = []
    let chars = 0
    for (let i = first; i < Math.min(all.length, first + a.maxLines); i++) {
      const line = `${i + 1}\t${all[i]}`
      if (chars + line.length > READ_CHARS && window.length > 0) break
      window.push(line)
      chars += line.length + 1
    }
    const endLine = first + window.length
    return {
      path,
      startLine: a.startLine,
      endLine,
      totalLines: all.length,
      text: window.join("\n"),
      truncated: endLine < all.length
    } satisfies ReadResult
  })

/** One tool definition, rendered as MCP tools and as AI SDK tools. `run` parses its own input. */
export interface SourceTool {
  readonly name: "grep" | "list_files" | "read_file"
  readonly description: string
  readonly input: z.ZodRawShape
  readonly run: (source: SourceCheckout, args: unknown) => Effect.Effect<unknown, SourceError>
}

const define = <S extends z.ZodRawShape, A>(
  name: SourceTool["name"],
  description: string,
  input: S,
  run: (source: SourceCheckout, args: z.infer<z.ZodObject<S>>) => Effect.Effect<A, SourceError>
): SourceTool => ({
  name,
  description,
  input,
  run: (source, args) =>
    Effect.suspend(() => {
      const parsed = z.object(input).safeParse(args)
      if (!parsed.success) return Effect.fail(fail(`invalid arguments: ${z.prettifyError(parsed.error)}`))
      return run(source, parsed.data)
    }).pipe(Effect.catchDefect((d) => d instanceof SourceError ? Effect.fail(d) : Effect.fail(fail("internal tool error"))))
})

export const sourceTools: ReadonlyArray<SourceTool> = [
  define(
    "grep",
    "Search file contents at the reviewed commit (git grep). Returns matching lines as path:line:text and a truncated flag.",
    grepInput,
    grep
  ),
  define(
    "list_files",
    "List files at the reviewed commit, optionally under a directory prefix and filtered by a glob. Returns paths and a truncated flag.",
    listInput,
    listFiles
  ),
  define(
    "read_file",
    "Read a file at the reviewed commit. Returns numbered lines from startLine, the total line count, and a truncated flag.",
    readInput,
    readFile
  )
]

export const sourceToolNames = sourceTools.map((t) => t.name)

/** Runs a tool and renders the model-facing text; failures become an error text, never a host path. */
export const runSourceTool = (tool: SourceTool, source: SourceCheckout, args: unknown) =>
  tool.run(source, args).pipe(
    Effect.map((result) => ({ ok: true as const, text: JSON.stringify(result) })),
    Effect.catch((e) => Effect.succeed({ ok: false as const, text: e.message.split(source.gitDir).join("<repo>") }))
  )
