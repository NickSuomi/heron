import { readFileSync } from "node:fs"
import { afterAll, describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { codexCli } from "../src/harness/codexCli.ts"
import { type Captured, fakeCli, makeRepo } from "./fixtures/harness/repo.ts"
import { answerSchema, jobEnv, requestFor } from "./fixtures/harness/request.ts"

const repo = makeRepo()
afterAll(repo.cleanup)

const mcp = { command: "/opt/node", args: ["/opt/heron/dist/cli.js", "mcp-source"] }
const SHELL_VARS = ["PWD", "OLDPWD", "SHLVL", "_"]

const run = (fixture: string, options: { code?: number; source?: boolean } = {}) => {
  const fake = fakeCli(repo.root, fixture, options.code ?? 0)
  const adapter = codexCli({ command: fake.bin, env: jobEnv, mcp })
  return {
    effect: adapter(requestFor("beta", options.source === false ? null : repo.source)),
    captured: () => JSON.parse(readFileSync(fake.capture, "utf8")) as Captured
  }
}

/** Every `-c key=value` override as a map. */
const overrides = (argv: ReadonlyArray<string>) =>
  Object.fromEntries(argv.flatMap((a, i) => (argv[i - 1] === "-c" ? [a.split(/=(.*)/s).slice(0, 2)] : [])))

describe("codex-cli harness", () => {
  it.effect("maps a Codex JSONL stream (synthetic, documented event shapes) to a result", () =>
    Effect.gen(function*() {
      expect(yield* run("codex-success.synthetic.jsonl").effect).toEqual({
        output: { answer: 42 },
        reportedModel: null,
        vendorSessionId: "0199a213-81c0-7800-8aa1-bbab2a035a53",
        usage: { inputTokens: 2400, cachedInputTokens: 1200, outputTokens: 90, reasoningTokens: 40, costUsd: null },
        toolCalls: 1
      })
    }))

  it.effect("passes exec flags, disables shell tools, registers only heron, and allowlists env", () =>
    Effect.gen(function*() {
      const { captured, effect } = run("codex-success.synthetic.jsonl")
      yield* effect
      const { argv, env, files, stdin } = captured()
      expect(argv.slice(0, 2)).toEqual(["exec", "--json"])
      expect(JSON.parse(files[argv[argv.indexOf("--output-schema") + 1]!]!)).toEqual(answerSchema)
      expect([argv[argv.indexOf("-m") + 1], argv[argv.indexOf("--sandbox") + 1]]).toEqual(["model-x", "read-only"])
      expect(argv).toEqual(expect.arrayContaining(["--skip-git-repo-check", "--ephemeral"]))
      expect(argv.at(-1)).toBe("-")
      expect(overrides(argv)).toEqual({
        model_reasoning_effort: "\"low\"",
        "features.shell_tool": "false",
        "features.unified_exec": "false",
        web_search: "\"disabled\"",
        approval_policy: "\"never\"",
        "tools.view_image": "false",
        project_doc_max_bytes: "0",
        "mcp_servers.heron.command": "\"/opt/node\"",
        "mcp_servers.heron.args": JSON.stringify(["/opt/heron/dist/cli.js", "mcp-source", "--git-dir", repo.source.gitDir, "--commit", repo.source.commit]),
        "mcp_servers.heron.required": "true",
        "mcp_servers.heron.enabled_tools": "[\"grep\",\"list_files\",\"read_file\"]"
      })
      expect(stdin).toBe("You review code.\n\nWhat number does a.ts export?")
      expect(Object.keys(env).filter((k) => !SHELL_VARS.includes(k)).sort()).toEqual(["CODEX_HOME", "HOME", "HTTPS_PROXY", "PATH"])
      expect(JSON.stringify(env)).not.toContain("must-not-leak")
    }))

  it.effect("gives the judge no MCP server", () =>
    Effect.gen(function*() {
      const { captured, effect } = run("codex-success.synthetic.jsonl", { source: false })
      yield* effect
      expect(Object.keys(overrides(captured().argv)).filter((k) => k.startsWith("mcp_servers"))).toEqual([])
    }))

  it.effect("reports a recorded 401 from codex-cli 0.101.0 as auth", () =>
    Effect.gen(function*() {
      const error = yield* Effect.flip(run("codex-noauth.jsonl", { code: 1 }).effect)
      expect([error.kind, error.detail.startsWith("unexpected status 401 Unauthorized")]).toEqual(["auth", true])
    }))

  it.effect("rejects a session that ran a shell command", () =>
    Effect.gen(function*() {
      const error = yield* Effect.flip(run("codex-shell.synthetic.jsonl").effect)
      expect([error.kind, error.detail]).toEqual(["tool-violation", "model ran a command_execution item"])
    }))
})
