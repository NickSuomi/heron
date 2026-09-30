import { readFileSync } from "node:fs"
import { extname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { Effect, Result, Schema } from "effect"
import { Discussions, type Sha } from "../domain.ts"
import { type SourceCheckout, TREE_REFS } from "../ports.ts"
import { runSourceTool, sourceTools, toolContext, type ToolContext } from "./sourceTools.ts"

export const MCP_SERVER_NAME = "heron"

const SHA = /^[0-9a-f]{40}$/

/** `--checkout <json>`: the git directory, the three commits and their trees, exactly as the forge produced them. */
export const parseMcpSourceArgs = (argv: ReadonlyArray<string>): SourceCheckout => {
  const i = argv.indexOf("--checkout")
  const raw = i < 0 ? undefined : argv[i + 1]
  if (raw === undefined) throw new Error("mcp-source: missing --checkout")
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error("mcp-source: --checkout is not JSON")
  }
  const c = parsed as { gitDir?: unknown; commits?: Record<string, unknown>; trees?: Record<string, unknown> }
  if (typeof c.gitDir !== "string") throw new Error("mcp-source: --checkout has no gitDir")
  for (const ref of TREE_REFS) {
    const commit = c.commits?.[ref]
    if (typeof commit !== "string" || !SHA.test(commit)) throw new Error(`mcp-source: commit ${ref} must be a 40-character hex SHA`)
    if (typeof c.trees?.[ref] !== "string") throw new Error(`mcp-source: --checkout has no ${ref} tree`)
  }
  return {
    gitDir: c.gitDir,
    commits: Object.fromEntries(TREE_REFS.map((r) => [r, c.commits![r] as Sha])) as SourceCheckout["commits"],
    trees: Object.fromEntries(TREE_REFS.map((r) => [r, c.trees![r] as string])) as SourceCheckout["trees"]
  }
}

/**
 * `--discussions <file>`: the threads the parent read from the forge, as JSON in the session's private directory. A file,
 * not an argument: it can be larger than one argument may be, and a process list would show an argument to other users.
 */
export const parseMcpDiscussions = (argv: ReadonlyArray<string>): Discussions => {
  const i = argv.indexOf("--discussions")
  const path = i < 0 ? undefined : argv[i + 1]
  if (path === undefined) throw new Error("mcp-source: missing --discussions")
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"))
  } catch {
    throw new Error("mcp-source: --discussions is not a readable JSON file")
  }
  const decoded = Schema.decodeUnknownResult(Discussions)(parsed)
  if (Result.isFailure(decoded)) throw new Error("mcp-source: --discussions does not hold discussions")
  return decoded.success
}

export const mcpSourceServer = (ctx: ToolContext): McpServer => {
  const server = new McpServer({ name: MCP_SERVER_NAME, version: "1.0.0" })
  for (const tool of sourceTools) {
    server.registerTool(
      tool.name,
      { description: tool.description, inputSchema: tool.input, annotations: { readOnlyHint: true, openWorldHint: false } },
      async (args: unknown) => {
        const out = await Effect.runPromise(runSourceTool(tool, ctx, args))
        return { content: [{ type: "text" as const, text: out.text }], ...(out.ok ? {} : { isError: true }) }
      }
    )
  }
  return server
}

/**
 * `heron mcp-source --checkout <json>`: a stdio MCP server exposing the read-only source tools.
 * `argv` is the arguments after `mcp-source`. Resolves when the client closes stdin, after killing its language servers.
 */
export const runMcpSource = (argv: ReadonlyArray<string>): Promise<void> =>
  Effect.runPromise(Effect.scoped(Effect.gen(function*() {
    const ctx = yield* toolContext(parseMcpSourceArgs(argv), parseMcpDiscussions(argv))
    yield* Effect.promise(async () => {
      const server = mcpSourceServer(ctx)
      const transport = new StdioServerTransport()
      const closed = new Promise<void>((resolve) => {
        transport.onclose = resolve
        process.stdin.once("end", resolve)
      })
      await server.connect(transport)
      await closed
      await server.close()
    })
  })))

export interface Launcher {
  readonly command: string
  readonly args: ReadonlyArray<string>
}

/** The Heron CLI entry next to this module: `src/cli.ts` when run from source, `dist/cli.js` when built. */
export const heronCliEntry = (): string => {
  const self = fileURLToPath(import.meta.url)
  return fileURLToPath(new URL(`../cli${extname(self)}`, import.meta.url))
}

export const defaultMcpLauncher = (): Launcher => ({ command: process.execPath, args: [heronCliEntry(), "mcp-source"] })

/** Where a CLI harness writes the session's discussions for `heron mcp-source`, inside the session's private directory. */
export const discussionsFile = (dir: string) => join(dir, "discussions.json")

export const mcpSourceCommand = (launcher: Launcher, source: SourceCheckout, discussions: string): Launcher => ({
  command: launcher.command,
  args: [...launcher.args, "--checkout", JSON.stringify(source), "--discussions", discussions]
})
