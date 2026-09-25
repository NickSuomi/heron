import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { afterAll, describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { claudeCli } from "../src/harness/claudeCli.ts"
import { type Captured, fakeCli, makeRepo } from "./fixtures/harness/repo.ts"
import { answerSchema, jobEnv, requestFor } from "./fixtures/harness/request.ts"

const repo = makeRepo()
afterAll(repo.cleanup)

const mcp = { command: "/opt/node", args: ["/opt/heron/dist/cli.js", "mcp-source"] }
const SHELL_VARS = ["PWD", "OLDPWD", "SHLVL", "_"]

const run = (fixture: string, options: { code?: number; source?: boolean } = {}) => {
  const fake = fakeCli(repo.root, fixture, options.code ?? 0)
  const adapter = claudeCli({ command: fake.bin, env: jobEnv, mcp })
  const request = requestFor("alpha", options.source === false ? null : repo.source)
  return { effect: adapter(request), captured: () => JSON.parse(readFileSync(fake.capture, "utf8")) as Captured }
}

const flag = (argv: ReadonlyArray<string>, name: string) => argv[argv.indexOf(name) + 1]

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

  it.effect("passes locked-down flags, the heron server only, and an allowlisted env", () =>
    Effect.gen(function*() {
      const { captured, effect } = run("claude-success.jsonl")
      yield* effect
      const { argv, env, files, stdin } = captured()
      expect(argv.slice(0, 5)).toEqual(["-p", "--output-format", "stream-json", "--verbose", "--json-schema"])
      expect(JSON.parse(flag(argv, "--json-schema")!)).toEqual(answerSchema)
      expect([flag(argv, "--model"), flag(argv, "--effort"), flag(argv, "--tools"), flag(argv, "--allowedTools")]).toEqual(["model-x", "low", "", "mcp__heron"])
      expect([flag(argv, "--permission-mode"), flag(argv, "--permission-prompts"), flag(argv, "--setting-sources"), flag(argv, "--max-turns")]).toEqual(["dontAsk", "none", "", "6"])
      expect(argv).toContain("--strict-mcp-config")
      expect(argv).toContain("--no-session-persistence")
      expect(files[flag(argv, "--system-prompt-file")!]).toBe("You review code.")
      expect(JSON.parse(files[flag(argv, "--mcp-config")!]!)).toEqual({
        mcpServers: {
          heron: {
            type: "stdio",
            command: "/opt/node",
            args: ["/opt/heron/dist/cli.js", "mcp-source", "--git-dir", repo.source.gitDir, "--commit", repo.source.commit],
            env: {}
          }
        }
      })
      expect(stdin).toBe("What number does a.ts export?")
      expect(Object.keys(env).filter((k) => !SHELL_VARS.includes(k)).sort()).toEqual(["CLAUDE_CODE_OAUTH_TOKEN", "CLAUDE_CONFIG_DIR", "HOME", "HTTPS_PROXY", "PATH"])
      // A fresh home per session: no operator CLAUDE.md, auto-memory, skills, hooks or stored login.
      const home = join(dirname(flag(argv, "--system-prompt-file")!), "home")
      expect([env["HOME"], env["CLAUDE_CONFIG_DIR"]]).toEqual([home, home])
      expect(JSON.stringify(env)).not.toContain("must-not-leak")
    }))

  it.effect("gives the judge no MCP server at all", () =>
    Effect.gen(function*() {
      const { captured, effect } = run("claude-success.jsonl", { source: false })
      yield* effect
      const { argv } = captured()
      expect([argv.includes("--strict-mcp-config"), argv.includes("--mcp-config"), argv.includes("--allowedTools")]).toEqual([true, false, false])
    }))

  it.effect("reports a missing login as auth", () =>
    Effect.gen(function*() {
      const error = yield* Effect.flip(run("claude-noauth.jsonl", { code: 1 }).effect)
      expect([error.kind, error.detail]).toEqual(["auth", "Claude Code reported authentication_failed"])
    }))

  it.effect("rejects a session that used a tool other than the heron server", () =>
    Effect.gen(function*() {
      const error = yield* Effect.flip(run("claude-violation.synthetic.jsonl").effect)
      expect([error.kind, error.detail]).toEqual(["tool-violation", "model called Bash"])
    }))
})
