/**
 * One tiny real session per selected harness against a throwaway repository; prints output and usage.
 *
 *   node scripts/probe.ts claude-cli [codex-cli] [ai-sdk]
 *
 * Models and efforts: PROBE_<KIND>_MODEL / PROBE_<KIND>_EFFORT (KIND = CLAUDE_CLI, CODEX_CLI, AI_SDK).
 * PROBE_TRANSCRIPT=<file> keeps Claude Code's event stream there and prints the tools the model called.
 * This file doubles as the `mcp-source` entry so the probe does not depend on the CLI wiring.
 */
import { chmodSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { Duration, Effect, Exit } from "effect"
import type { HarnessConfig } from "../src/config.ts"
import type { GateName, HarnessKey, ProfileName, SessionId } from "../src/domain.ts"
import { makeHarness } from "../src/harness/index.ts"
import { runMcpSource } from "../src/harness/mcpSource.ts"
import { makeRepo } from "../test/fixtures/harness/repo.ts"

const defaults: Record<HarnessConfig["kind"], { model: string; effort: string }> = {
  "claude-cli": { model: "claude-sonnet-5", effort: "low" },
  "codex-cli": { model: "gpt-5", effort: "low" },
  "ai-sdk": { model: "anthropic/claude-sonnet-5", effort: "low" }
}

const configs: Record<HarnessConfig["kind"], HarnessConfig> = {
  "claude-cli": { kind: "claude-cli", concurrency: 1 },
  "codex-cli": { kind: "codex-cli", concurrency: 1 },
  "ai-sdk": { kind: "ai-sdk", provider: "openrouter", concurrency: 1 }
}

const schema = {
  type: "object",
  properties: { targetFile: { type: "string" }, subType: { type: "string" } },
  required: ["targetFile", "subType"],
  additionalProperties: false
}

/** A shell wrapper that runs the real CLI and copies its event stream to `file`. */
const teeing = (root: string, command: string, file: string) => {
  const bin = join(root, "claude-tee")
  writeFileSync(bin, `#!/bin/bash\nset -o pipefail\n${JSON.stringify(command)} "$@" | tee ${JSON.stringify(file)}\n`)
  chmodSync(bin, 0o755)
  return bin
}

const toolsCalled = (file: string) =>
  readFileSync(file, "utf8").split("\n").flatMap((line) => {
    try {
      const e = JSON.parse(line) as { type?: string; message?: { content?: Array<{ type: string; name?: string; input?: unknown }> } }
      return e.type === "assistant" ? (e.message?.content ?? []).filter((b) => b.type === "tool_use").map((b) => `${b.name} ${JSON.stringify(b.input)}`) : []
    } catch {
      return []
    }
  })

const main = async (kinds: ReadonlyArray<HarnessConfig["kind"]>) => {
  const repo = makeRepo()
  const self = fileURLToPath(import.meta.url)
  const transcript = process.env["PROBE_TRANSCRIPT"]
  const withTee = { ...configs, "claude-cli": { kind: "claude-cli", concurrency: 1, ...(transcript ? { command: teeing(repo.root, "claude", transcript) } : {}) } } as const
  const harness = makeHarness(Object.fromEntries(kinds.map((k) => [k, withTee[k]])) as Record<HarnessKey, HarnessConfig>, {
    env: process.env,
    mcpLauncher: { command: process.execPath, args: [self, "mcp-source"] }
  })
  try {
    for (const kind of kinds) {
      const envKey = kind.toUpperCase().replace(/-/g, "_")
      const model = process.env[`PROBE_${envKey}_MODEL`] ?? defaults[kind].model
      const effort = process.env[`PROBE_${envKey}_EFFORT`] ?? defaults[kind].effort
      const started = Date.now()
      const exit = await Effect.runPromiseExit(harness.run({
        slot: {
          id: "probe" as SessionId,
          role: "reviewer",
          profile: { name: "probe" as ProfileName, harness: kind as HarnessKey, model, effort },
          gates: [{ name: "probe" as GateName, instructions: "Answer from the repository." }]
        },
        instructions: "You answer two questions about a repository you can read at three commits: source, target and base.",
        prompt: [
          "1. Which file on the target branch exports `onlyOnTarget`? Find it with the native Grep or Read tool in the target tree.",
          "2. What type does the Heron `hover` tool report for `sub` on line 2 of src/math.ts at source?"
        ].join("\n"),
        source: repo.source,
        outputSchema: schema,
        maxTurns: null,
        timeout: Duration.minutes(5)
      }))
      const ms = Date.now() - started
      console.log(JSON.stringify(Exit.isSuccess(exit) ? { kind, model, effort, ms, ...exit.value } : { kind, model, effort, ms, failure: String(exit.cause) }, null, 2))
      if (kind === "claude-cli" && transcript) console.log(["tools called:", ...toolsCalled(transcript)].join("\n  "))
    }
  } finally {
    repo.cleanup()
  }
}

const [first, ...rest] = process.argv.slice(2)
if (first === "mcp-source") await runMcpSource(rest)
else {
  const kinds = [first, ...rest].filter((k): k is HarnessConfig["kind"] => k !== undefined && k in configs)
  if (kinds.length === 0) {
    console.error("usage: node scripts/probe.ts claude-cli|codex-cli|ai-sdk ...")
    process.exitCode = 2
  } else await main(kinds)
}
