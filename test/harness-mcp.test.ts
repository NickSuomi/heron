import { join } from "node:path"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"
import { afterAll, describe, expect, it } from "vitest"
import { heronCliEntry, parseMcpSourceArgs } from "../src/harness/mcpSource.ts"
import { makeRepo } from "./fixtures/harness/repo.ts"

const repo = makeRepo()
afterAll(repo.cleanup)

describe("heron mcp-source", () => {
  it("serves the three read-only tools over stdio", async () => {
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [join(import.meta.dirname, "fixtures/harness/mcp-entry.ts"), "--git-dir", repo.source.gitDir, "--commit", repo.source.commit],
      env: { PATH: process.env["PATH"] ?? "" },
      stderr: "ignore"
    })
    const client = new Client({ name: "test", version: "0.0.0" })
    await client.connect(transport)
    try {
      const tools = await client.listTools()
      expect(tools.tools.map((t) => [t.name, t.annotations?.readOnlyHint])).toEqual([["grep", true], ["list_files", true], ["read_file", true]])
      const grep = await client.callTool({ name: "grep", arguments: { pattern: "sub", paths: ["src/*.ts"] } })
      expect(grep).toEqual({
        content: [{ type: "text", text: JSON.stringify({ lines: ["src/math.ts:2:export const sub = (a: number, b: number) => a - b"], truncated: false }) }]
      })
      const denied = await client.callTool({ name: "read_file", arguments: { path: "../secret" } })
      expect(denied).toEqual({ content: [{ type: "text", text: "path must not contain \"..\": ../secret" }], isError: true })
    } finally {
      await client.close()
    }
  })

  it("parses its flags and rejects a short commit", () => {
    expect(parseMcpSourceArgs(["--git-dir", "/r.git", "--commit", "a".repeat(40)])).toEqual({ gitDir: "/r.git", commit: "a".repeat(40) })
    expect(() => parseMcpSourceArgs(["--git-dir", "/r.git", "--commit", "abc"])).toThrow("--commit must be a 40-character hex SHA")
    expect(() => parseMcpSourceArgs(["--commit", "a".repeat(40)])).toThrow("missing --git-dir")
  })

  it("resolves the CLI entry beside the harness directory", () => {
    expect(heronCliEntry()).toBe(join(import.meta.dirname, "../src/cli.ts"))
  })
})
