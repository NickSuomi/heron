import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { afterAll, describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { claudeCli, foldClaudeEvents } from "../src/harness/claudeCli.ts"
import { type Captured, fakeCli, makeRepo } from "./fixtures/harness/repo.ts"
import { answerSchema, jobEnv, noDiscussions, requestFor } from "./fixtures/harness/request.ts"

const repo = makeRepo()
afterAll(repo.cleanup)

const mcp = { command: "/opt/node", args: ["/opt/heron/dist/cli.js", "mcp-source"] }
const SHELL_VARS = ["PWD", "OLDPWD", "SHLVL", "_"]

const run = (fixture: string, options: { code?: number; maxTurns?: number | null } = {}) => {
  const fake = fakeCli(repo.root, fixture, options.code ?? 0)
  const adapter = claudeCli({ command: fake.bin, env: jobEnv, mcp })
  const request = requestFor("alpha", repo.source, null, options.maxTurns === undefined ? 6 : options.maxTurns)
  return { effect: adapter(request), captured: () => JSON.parse(readFileSync(fake.capture, "utf8")) as Captured }
}

const flag = (argv: ReadonlyArray<string>, name: string) => argv[argv.indexOf(name) + 1]

describe("foldClaudeEvents on usage-limit events", () => {
  const events = (...limits: ReadonlyArray<Record<string, unknown>>) => [
    { type: "system", subtype: "init", model: "claude-sonnet-5", session_id: "s1", mcp_servers: [{ name: "heron", status: "connected" }] },
    ...limits.map((rate_limit_info) => ({ type: "rate_limit_event", rate_limit_info })),
    { type: "result", subtype: "success", is_error: false, session_id: "s1", structured_output: { findings: [] }, usage: {} }
  ]

  it("keeps the last warning Claude Code gave, and says nothing about a limit that is only allowed", () => {
    const warned = foldClaudeEvents(
      events(
        { status: "allowed", rate_limit_type: null, utilization: null, resets_at: null },
        { status: "allowed_warning", rate_limit_type: "five_hour", utilization: 0.91, resets_at: 1790719200 }
      ),
      (t) => t
    )
    const quiet = foldClaudeEvents(events({ status: "allowed", rate_limit_type: null, utilization: null, resets_at: null }), (t) => t)
    expect(["limitWarning" in warned ? warned.limitWarning : "none", "limitWarning" in quiet]).toEqual([
      "five_hour limit allowed_warning, resets 2026-09-29T22:00:00.000Z",
      false
    ])
  })
})

describe("claude-cli harness", () => {
  it.effect("maps a recorded Claude Code 2.1.281 session to a result", () =>
    Effect.gen(function*() {
      const { effect } = run("claude-success.jsonl")
      expect(yield* effect).toEqual({
        output: { answer: 42 },
        reportedModel: "claude-sonnet-5",
        vendorSessionId: "00000000-0000-4000-8000-000000000001",
        usage: { inputTokens: 3857, cachedInputTokens: 1837, outputTokens: 157, reasoningTokens: 21, costUsd: 0.0100094 },
        toolCalls: 1
      })
    }))

  it.effect("confines the native read tools to the three trees and passes locked-down flags and an allowlisted env", () =>
    Effect.gen(function*() {
      const { captured, effect } = run("claude-success.jsonl")
      yield* effect
      const { argv, env, files, stdin } = captured()
      const dir = dirname(flag(argv, "--system-prompt-file")!)
      const { base, source, target } = repo.source.trees
      const rule = (path: string) => `Read(/${path}/**)`
      expect(argv).toEqual([
        "-p", "--output-format", "stream-json", "--verbose",
        "--json-schema", JSON.stringify(answerSchema),
        "--model", "model-x", "--effort", "low",
        "--system-prompt-file", join(dir, "system-prompt.md"),
        "--tools", "Read,Grep,Glob",
        "--restricted",
        "--add-dir", source, target, base,
        "--strict-mcp-config",
        "--mcp-config", join(dir, "mcp.json"),
        "--allowedTools", "mcp__heron", rule(source), rule(target), rule(base),
        "--disallowedTools", "Bash", "Edit", "Write", "NotebookEdit", "WebFetch", "WebSearch", "Task", "Agent",
        "Read(//proc/**)", "Read(//sys/**)", rule(join(dir, "home")),
        "--permission-mode", "dontAsk",
        "--permission-prompts", "none",
        "--setting-sources", "",
        "--no-session-persistence",
        "--max-turns", "6"
      ])
      expect(rule(source)).toBe(`Read(//${source.slice(1)}/**)`)
      expect(files[join(dir, "system-prompt.md")]).toBe([
        "You review code.",
        "",
        "## Native file tools",
        "Read, Grep and Glob work on three read-only trees. Use these absolute paths with them:",
        `- source: \`${source}\``,
        `- target: \`${target}\``,
        `- base: \`${base}\``,
        "The Heron tools (`mcp__heron__*`) read the same commits; pass `ref` to them instead of a path."
      ].join("\n"))
      expect(JSON.parse(files[join(dir, "mcp.json")]!)).toEqual({
        mcpServers: {
          heron: {
            type: "stdio",
            command: "/opt/node",
            args: ["/opt/heron/dist/cli.js", "mcp-source", "--checkout", JSON.stringify(repo.source), "--discussions", join(dir, "discussions.json")],
            env: {}
          }
        }
      })
      // The tool server reads the discussions from the session's own directory; the model's Read rules never reach it.
      expect(JSON.parse(files[join(dir, "discussions.json")]!)).toEqual(noDiscussions)
      expect(stdin).toBe("What number does a.ts export?")
      expect(Object.keys(env).filter((k) => !SHELL_VARS.includes(k)).sort()).toEqual([
        "CLAUDE_CODE_OAUTH_TOKEN", "CLAUDE_CONFIG_DIR", "HOME", "HTTPS_PROXY", "MAX_MCP_OUTPUT_TOKENS", "MCP_TOOL_TIMEOUT", "PATH"
      ])
      // A fresh home per session: no operator CLAUDE.md, auto-memory, skills, hooks or stored login.
      const home = join(dir, "home")
      expect([env["HOME"], env["CLAUDE_CONFIG_DIR"], env["MAX_MCP_OUTPUT_TOKENS"], env["MCP_TOOL_TIMEOUT"]]).toEqual([home, home, "1000000", "86400000"])
      expect(JSON.stringify(env)).not.toContain("must-not-leak")
    }))

  it.effect("passes no turn limit unless the operator set one", () =>
    Effect.gen(function*() {
      const { captured, effect } = run("claude-success.jsonl", { maxTurns: null })
      yield* effect
      expect(captured().argv.includes("--max-turns")).toBe(false)
    }))

  it.effect("counts native Read, Grep and Glob calls as tool calls, not violations", () =>
    Effect.gen(function*() {
      const result = yield* run("claude-native.synthetic.jsonl").effect
      expect([result.output, result.toolCalls]).toEqual([{ answer: 42 }, 3])
    }))

  it.effect("reports a missing login as auth", () =>
    Effect.gen(function*() {
      const error = yield* Effect.flip(run("claude-noauth.jsonl", { code: 1 }).effect)
      expect([error.kind, error.detail]).toEqual(["auth", "Claude Code reported authentication_failed: Not logged in · Please run /login"])
    }))

  it.effect("keeps the vendor's reason when Claude Code rejects the request", () =>
    Effect.gen(function*() {
      const error = yield* Effect.flip(run("claude-oldcli.synthetic.jsonl", { code: 1 }).effect)
      expect([error.kind, error.detail]).toEqual([
        "vendor",
        "Claude Code reported invalid_request: API Error: 400 Claude Code 2.1.274 does not support this model; version 2.1.280 or newer is required. Run 'claude update', or update the Claude desktop app, then try again."
      ])
    }))

  it.effect("keeps a session whose only denied calls were native reads outside the trees", () =>
    Effect.gen(function*() {
      const result = yield* run("claude-denied-read.synthetic.jsonl").effect
      expect(result.reportedModel).toBe("claude-sonnet-5")
    }))

  it.effect("still fails a session when a tool outside the read-only set was denied", () =>
    Effect.gen(function*() {
      const error = yield* Effect.flip(run("claude-denied-bash.synthetic.jsonl").effect)
      expect([error.kind, error.detail]).toEqual(["tool-violation", "denied tool calls: Bash"])
    }))

  it.effect("rejects a session that used a tool other than the heron server", () =>
    Effect.gen(function*() {
      const error = yield* Effect.flip(run("claude-violation.synthetic.jsonl").effect)
      expect([error.kind, error.detail]).toEqual(["tool-violation", "model called Bash"])
    }))
})
