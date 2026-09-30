import { join } from "node:path"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"
import { afterAll, describe, expect, it } from "vitest"
import { heronCliEntry, parseMcpSourceArgs } from "../src/harness/mcpSource.ts"
import { makeRepo } from "./fixtures/harness/repo.ts"

const repo = makeRepo()
afterAll(repo.cleanup)

describe("heron mcp-source", () => {
  it("serves every read-only tool over stdio and reads the target tree", async () => {
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [join(import.meta.dirname, "fixtures/harness/mcp-entry.ts"), "--checkout", JSON.stringify(repo.source)],
      env: { PATH: process.env["PATH"] ?? "" },
      stderr: "ignore"
    })
    const client = new Client({ name: "test", version: "0.0.0" })
    await client.connect(transport)
    try {
      const tools = await client.listTools()
      expect(tools.tools.map((t) => `${t.name}:${t.annotations?.readOnlyHint}`)).toEqual([
        "grep:true", "list_files:true", "read_file:true", "rg:true", "ast_grep:true", "secret_scan:true", "git_log:true", "git_show:true", "git_blame:true",
        "git_diff:true", "definition:true", "references:true", "hover:true", "document_symbols:true", "workspace_symbols:true", "diagnostics:true"
      ])
      const grep = await client.callTool({ name: "grep", arguments: { pattern: "sub", paths: ["src/math.ts"] } })
      expect(grep).toEqual({
        content: [{ type: "text", text: JSON.stringify({ total: 1, offset: 0, next: null, lines: ["src/math.ts:2:export const sub = (a: number, b: number) => a - b"] }) }]
      })
      const rg = await client.callTool({ name: "rg", arguments: { pattern: "onlyOnTarget", ref: "target" } })
      expect(rg).toEqual({
        content: [{ type: "text", text: JSON.stringify({ total: 1, offset: 0, next: null, lines: ["src/target-only.ts:1:export const onlyOnTarget = 1"] }) }]
      })
      const denied = await client.callTool({ name: "read_file", arguments: { path: "../secret" } })
      expect(denied).toEqual({ content: [{ type: "text", text: "path must not contain \"..\": ../secret" }], isError: true })
    } finally {
      await client.close()
    }
  })

  it("parses its checkout and rejects a short commit", () => {
    const checkout = {
      gitDir: "/r.git",
      commits: { source: "a".repeat(40), target: "b".repeat(40), base: "c".repeat(40) },
      trees: { source: "/t/s", target: "/t/t", base: "/t/b" }
    }
    expect(parseMcpSourceArgs(["--checkout", JSON.stringify(checkout)])).toEqual(checkout)
    expect(() => parseMcpSourceArgs(["--checkout", JSON.stringify({ ...checkout, commits: { ...checkout.commits, base: "abc" } })])).toThrow(
      "commit base must be a 40-character hex SHA"
    )
    expect(() => parseMcpSourceArgs([])).toThrow("missing --checkout")
  })

  it("resolves the CLI entry beside the harness directory", () => {
    expect(heronCliEntry()).toBe(join(import.meta.dirname, "../src/cli.ts"))
  })
})
