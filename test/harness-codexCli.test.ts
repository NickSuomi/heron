import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { afterAll, describe, expect, it } from "@effect/vitest"
import { Duration, Effect } from "effect"
import type { Env } from "../src/config.ts"
import { codexCli, foldCodexEvents } from "../src/harness/codexCli.ts"
import { makeHarness } from "../src/harness/index.ts"
import { HarnessError } from "../src/ports.ts"
import { type Captured, fakeCli, makeRepo } from "./fixtures/harness/repo.ts"
import { answerSchema, jobEnv, noDiscussions, requestFor } from "./fixtures/harness/request.ts"

const repo = makeRepo()
afterAll(repo.cleanup)

const mcp = { command: "/opt/node", args: ["/opt/heron/dist/cli.js", "mcp-source"] }
const SHELL_VARS = ["PWD", "OLDPWD", "SHLVL", "_"]

const run = (fixture: string, options: { code?: number; mcpList?: string; home?: string; env?: Env } = {}) => {
  const fake = fakeCli(repo.root, fixture, options.code ?? 0, options.mcpList ?? null)
  const adapter = codexCli({ command: fake.bin, env: { ...(options.env ?? jobEnv), ...(options.home === undefined ? {} : { CODEX_HOME: options.home }) }, mcp })
  return {
    effect: adapter(requestFor("beta", repo.source)),
    captured: () => JSON.parse(readFileSync(fake.capture, "utf8")) as Captured
  }
}

/** Every `-c key=value` override as a map. */
const overrides = (argv: ReadonlyArray<string>) =>
  Object.fromEntries(argv.flatMap((a, i) => (argv[i - 1] === "-c" ? [a.split(/=(.*)/s).slice(0, 2)] : [])))

describe("codex-cli harness", () => {
  it("keeps usage from completed turns when a later turn fails and leaves unknown counts null", () => {
    const failed = foldCodexEvents([
      { type: "thread.started", thread_id: "failed-thread" },
      { type: "turn.completed", usage: { input_tokens: 100, output_tokens: 20 } },
      { type: "turn.failed", error: { message: "quota reached" } }
    ], (s) => s)
    expect(failed).toBeInstanceOf(HarnessError)
    expect(failed instanceof HarnessError && failed.accounting).toEqual({
      reportedModel: null, vendorSessionId: "failed-thread", toolCalls: 0,
      usage: { inputTokens: 100, cachedInputTokens: null, outputTokens: 20, reasoningTokens: null, costUsd: null }
    })
  })

  it.effect("maps a Codex JSONL stream (synthetic, documented event shapes) to a result", () =>
    Effect.gen(function*() {
      expect(yield* run("codex-success.synthetic.jsonl").effect).toEqual({
        output: { answer: 42 },
        reportedModel: null,
        vendorSessionId: "0199a213-81c0-7800-8aa1-bbab2a035a53",
        usage: { inputTokens: 2400, cachedInputTokens: 1200, outputTokens: 90, reasoningTokens: 40, costUsd: null },
        toolCalls: 1,
        codexSubscription: null
      })
    }))

  it.effect("passes exec flags, disables shell tools, registers only heron, and allowlists env", () =>
    Effect.gen(function*() {
      const { captured, effect } = run("codex-success.synthetic.jsonl")
      yield* effect
      const { argv, env, files, stdin } = captured()
      expect(argv.slice(0, 2)).toEqual(["exec", "--json"])
      expect(JSON.parse(files[argv[argv.indexOf("--output-schema") + 1]!]!)).toEqual(answerSchema)
      const discussions = join(dirname(argv[argv.indexOf("--output-schema") + 1]!), "discussions.json")
      expect(JSON.parse(files[discussions]!)).toEqual(noDiscussions)
      expect([argv[argv.indexOf("-m") + 1], argv[argv.indexOf("--sandbox") + 1]]).toEqual(["model-x", "read-only"])
      expect(argv).toContain("--skip-git-repo-check")
      expect(argv).not.toContain("--ephemeral")
      expect(argv.at(-1)).toBe("-")
      expect(overrides(argv)).toEqual({
        model_reasoning_effort: "\"low\"",
        "features.shell_tool": "false",
        "features.unified_exec": "false",
        web_search: "\"disabled\"",
        approval_policy: "\"never\"",
        "tools.view_image": "false",
        project_doc_max_bytes: "0",
        tool_output_token_limit: "1000000",
        "mcp_servers.heron.command": "\"/opt/node\"",
        "mcp_servers.heron.args": JSON.stringify(["/opt/heron/dist/cli.js", "mcp-source", "--checkout", JSON.stringify(repo.source), "--discussions", discussions]),
        "mcp_servers.heron.required": "true",
        "mcp_servers.heron.tool_timeout_sec": "86400",
        "mcp_servers.heron.enabled_tools": JSON.stringify([
          "grep", "list_files", "read_file", "rg", "ast_grep", "secret_scan", "dependency_scan", "rule_scan", "git_log", "git_show", "git_blame", "git_diff",
          "definition", "references", "hover", "document_symbols", "workspace_symbols", "diagnostics", "read_discussions"
        ])
      })
      expect(stdin).toBe("You review code.\n\nWhat number does a.ts export?")
      expect(Object.keys(env).filter((k) => !SHELL_VARS.includes(k)).sort()).toEqual(["CODEX_HOME", "HOME", "HTTPS_PROXY", "PATH"])
      expect(JSON.stringify(env)).not.toContain("must-not-leak")
    }))

  for (const failed of [false, true]) {
    it.effect(`reads the first and last rollout limits and deletes only that rollout after a ${failed ? "failed" : "successful"} session`, () =>
      Effect.gen(function*() {
        const home = mkdtempSync(join(repo.root, "codex-"))
        const dir = join(home, "sessions", "2026", "10", "17")
        mkdirSync(dir, { recursive: true })
        const thread = `0199a213-81c0-7800-8aa1-bbab2a035a5${failed ? "4" : "3"}`
        const rollout = join(dir, `rollout-2026-10-17T06-29-33-${thread}.jsonl`)
        writeFileSync(rollout, readFileSync(join(import.meta.dirname, "fixtures/harness/codex-rollout.synthetic.jsonl")))
        const other = join(dir, "rollout-2026-10-17T06-29-33-another-thread.jsonl")
        writeFileSync(other, "keep")
        const state = join(home, "state.sqlite")
        writeFileSync(state, "keep")
        const effect = run(failed ? "codex-shell.synthetic.jsonl" : "codex-success.synthetic.jsonl", { home }).effect
        const reading = failed ? (yield* Effect.flip(effect)).accounting?.codexSubscription : (yield* effect).codexSubscription
        expect(reading).toEqual({
          before: { at: Date.parse("2026-10-17T06:29:33.977Z"), windows: [
            { window: "weekly", percent: 87, resetsAt: "2026-10-22T06:14:51.000Z" },
            { window: "five-hour", percent: 12, resetsAt: "2026-10-17T11:14:51.000Z" }
          ] },
          after: { at: Date.parse("2026-10-17T06:30:33.977Z"), windows: [
            { window: "five-hour", percent: 13, resetsAt: "2026-10-17T11:14:51.000Z" },
            { window: "weekly", percent: 88, resetsAt: "2026-10-22T06:14:51.000Z" }
          ] }
        })
        expect(existsSync(rollout)).toBe(false)
        expect(readFileSync(other, "utf8")).toBe("keep")
        expect(readFileSync(state, "utf8")).toBe("keep")
      }))
  }

  it.effect("succeeds without a reading when the rollout is missing", () =>
    Effect.gen(function*() {
      const home = mkdtempSync(join(repo.root, "codex-missing-"))
      const result = yield* run("codex-success.synthetic.jsonl", { home }).effect
      expect(result.output).toEqual({ answer: 42 })
      expect(result.codexSubscription).toBe(null)
    }))

  it.live("collects and deletes the rollout when a Codex session times out", () =>
    Effect.gen(function*() {
      const home = mkdtempSync(join(repo.root, "codex-timeout-"))
      const dir = join(home, "sessions", "2026", "10", "17")
      mkdirSync(dir, { recursive: true })
      const thread = "0199a213-81c0-7800-8aa1-bbab2a035a53"
      const rollout = join(dir, `rollout-2026-10-17T06-29-33-${thread}.jsonl`)
      writeFileSync(rollout, readFileSync(join(import.meta.dirname, "fixtures/harness/codex-rollout.synthetic.jsonl")))
      const fake = fakeCli(repo.root, "codex-success.synthetic.jsonl", "hang")
      writeFileSync(fake.bin, readFileSync(fake.bin, "utf8").replace("\nexec ", `\nif [ "$1" = "exec" ]; then printf '%s\\n' '${JSON.stringify({ type: "thread.started", thread_id: thread })}'; fi\nexec `))
      const request = requestFor("beta", repo.source, Duration.seconds(1))
      const harness = makeHarness({ [request.slot.profile.harness]: { kind: "codex-cli", concurrency: 1, command: fake.bin } }, { env: { ...jobEnv, CODEX_HOME: home }, mcpLauncher: mcp })
      const error = yield* Effect.flip(harness.run(request))
      expect(error.kind).toBe("timeout")
      expect(existsSync(rollout)).toBe(false)
      expect(error.accounting?.codexSubscription?.before.windows[0]?.percent).toBe(87)
      expect(error.accounting?.codexSubscription?.after.windows[1]?.percent).toBe(88)
    }))

  it.effect("uses the default Codex home and deletes a rollout without supported limits", () =>
    Effect.gen(function*() {
      const home = mkdtempSync(join(repo.root, "default-home-"))
      const dir = join(home, ".codex", "sessions", "2026", "10", "17")
      mkdirSync(dir, { recursive: true })
      const rollout = join(dir, "rollout-2026-10-17T06-29-33-0199a213-81c0-7800-8aa1-bbab2a035a53.jsonl")
      writeFileSync(rollout, [
        "not json", JSON.stringify({ type: "event_msg", payload: { type: "token_count" } }),
        ...[0, 60].map((window_minutes) => JSON.stringify({ timestamp: "2026-10-17T06:29:33.977Z", type: "event_msg", payload: {
          type: "token_count", rate_limits: { primary: { used_percent: 87, window_minutes, resets_at: 1792649691 }, secondary: null }
        } }))
      ].join("\n"))
      const { CODEX_HOME: _, ...env } = jobEnv
      const result = yield* run("codex-success.synthetic.jsonl", { env: { ...env, HOME: home } }).effect
      expect(result.output).toEqual({ answer: 42 })
      expect(result.codexSubscription).toBe(null)
      expect(existsSync(rollout)).toBe(false)
    }))

  it.effect("reports a recorded 401 from codex-cli 0.101.0 as auth", () =>
    Effect.gen(function*() {
      const error = yield* Effect.flip(run("codex-noauth.jsonl", { code: 1 }).effect)
      expect([error.kind, error.detail.startsWith("unexpected status 401 Unauthorized")]).toEqual(["auth", true])
    }))

  it.effect("keeps a partial stream with an ordinary stderr warning as no-output", () =>
    Effect.gen(function*() {
      const error = yield* Effect.flip(run("codex-partial-warning.synthetic.jsonl", { code: 1 }).effect)
      expect(error.kind).toBe("no-output")
    }))

  it.effect("reports a nonzero partial stream with connection refused on stderr as vendor", () =>
    Effect.gen(function*() {
      const error = yield* Effect.flip(run("codex-partial-connection-refused.synthetic.jsonl", { code: 1 }).effect)
      expect([error.kind, error.detail]).toEqual(["vendor", "codex exited 1: error sending request to provider: connection refused (os error 61)"])
    }))

  it.effect("rejects a session that ran a shell command", () =>
    Effect.gen(function*() {
      const error = yield* Effect.flip(run("codex-shell.synthetic.jsonl").effect)
      expect([error.kind, error.detail]).toEqual(["tool-violation", "model ran a command_execution item"])
    }))

  it.effect("disables every MCP server the operator's Codex config defines", () =>
    Effect.gen(function*() {
      const reviewer = run("codex-success.synthetic.jsonl", { mcpList: "codex-mcp-list.json" })
      yield* reviewer.effect
      const servers = (argv: ReadonlyArray<string>) => Object.entries(overrides(argv)).filter(([k]) => k.endsWith(".enabled"))
      expect(servers(reviewer.captured().argv)).toEqual([["mcp_servers.docs.enabled", "false"], ["mcp_servers.shell.enabled", "false"]])
    }))

  it.effect("refuses to run when an operator MCP server cannot be disabled by name", () =>
    Effect.gen(function*() {
      const error = yield* Effect.flip(run("codex-success.synthetic.jsonl", { mcpList: "codex-mcp-list-dotted.synthetic.json" }).effect)
      expect([error.kind, error.detail]).toEqual([
        "vendor",
        "the Codex config defines MCP server \"team.docs\", which cannot be disabled from the command line; use only letters, digits, - and _ in its name"
      ])
    }))

  it.effect("refuses to run when the operator's Codex config already defines a server named heron", () =>
    Effect.gen(function*() {
      const reviewer = yield* Effect.flip(run("codex-success.synthetic.jsonl", { mcpList: "codex-mcp-list-heron.synthetic.json" }).effect)
      expect([reviewer.kind, reviewer.detail]).toEqual([
        "vendor",
        "the Codex config defines an MCP server named \"heron\", which Heron reserves for its source tools; rename it in the Codex config"
      ])
    }))
})
