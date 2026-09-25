import { extname } from "node:path"
import { fileURLToPath } from "node:url"
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { Effect } from "effect"
import type { Sha } from "../domain.ts"
import type { SourceCheckout } from "../ports.ts"
import { runSourceTool, sourceTools } from "./sourceTools.ts"

export const MCP_SERVER_NAME = "heron"

const SHA = /^[0-9a-f]{40}$/

export const parseMcpSourceArgs = (argv: ReadonlyArray<string>): SourceCheckout => {
  const value = (flag: string) => {
    const i = argv.indexOf(flag)
    const v = i < 0 ? undefined : argv[i + 1]
    if (v === undefined || v.startsWith("--")) throw new Error(`mcp-source: missing ${flag}`)
    return v
  }
  const commit = value("--commit")
  if (!SHA.test(commit)) throw new Error("mcp-source: --commit must be a 40-character hex SHA")
  return { gitDir: value("--git-dir"), commit: commit as Sha }
}

export const mcpSourceServer = (source: SourceCheckout): McpServer => {
  const server = new McpServer({ name: MCP_SERVER_NAME, version: "1.0.0" })
  for (const tool of sourceTools) {
    server.registerTool(
      tool.name,
      { description: tool.description, inputSchema: tool.input, annotations: { readOnlyHint: true, openWorldHint: false } },
      async (args: unknown) => {
        const out = await Effect.runPromise(runSourceTool(tool, source, args))
        return { content: [{ type: "text" as const, text: out.text }], ...(out.ok ? {} : { isError: true }) }
      }
    )
  }
  return server
}

/**
 * `heron mcp-source --git-dir <dir> --commit <sha>`: a stdio MCP server exposing the read-only source tools.
 * `argv` is the arguments after `mcp-source`. Resolves when the client closes stdin.
 */
export const runMcpSource = async (argv: ReadonlyArray<string>): Promise<void> => {
  const server = mcpSourceServer(parseMcpSourceArgs(argv))
  const transport = new StdioServerTransport()
  const closed = new Promise<void>((resolve) => {
    transport.onclose = resolve
    process.stdin.once("end", resolve)
  })
  await server.connect(transport)
  await closed
  await server.close()
}

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

export const mcpSourceCommand = (launcher: Launcher, source: SourceCheckout): Launcher => ({
  command: launcher.command,
  args: [...launcher.args, "--git-dir", source.gitDir, "--commit", source.commit]
})
