/**
 * One tiny real session per selected harness against a throwaway repository; prints output and usage.
 *
 *   node scripts/probe.ts claude-cli [codex-cli] [ai-sdk]
 *
 * Models and efforts: PROBE_<KIND>_MODEL / PROBE_<KIND>_EFFORT (KIND = CLAUDE_CLI, CODEX_CLI, AI_SDK).
 * This file doubles as the `mcp-source` entry so the probe does not depend on the CLI wiring.
 */
import { execFileSync } from "node:child_process"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { Duration, Effect, Exit } from "effect"
import type { HarnessConfig } from "../src/config.ts"
import type { GateName, HarnessKey, ProfileName, SessionId, Sha } from "../src/domain.ts"
import { makeHarness } from "../src/harness/index.ts"
import { runMcpSource } from "../src/harness/mcpSource.ts"

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

const throwawayRepo = () => {
  const root = mkdtempSync(join(tmpdir(), "heron-probe-"))
  const work = join(root, "work")
  const git = (cwd: string, ...args: Array<string>) =>
    execFileSync("git", args, { cwd, encoding: "utf8", env: { PATH: process.env["PATH"] ?? "", HOME: root, GIT_AUTHOR_NAME: "p", GIT_AUTHOR_EMAIL: "p@example.invalid", GIT_COMMITTER_NAME: "p", GIT_COMMITTER_EMAIL: "p@example.invalid" } }).trim()
  execFileSync("mkdir", ["-p", join(work, "src")])
  writeFileSync(join(work, "src/math.ts"), "export const add = (a: number, b: number) => a + b\nexport const sub = (a: number, b: number) => a - b\n")
  git(work, "init", "-q", "-b", "main")
  git(work, "add", ".")
  git(work, "commit", "-q", "-m", "init")
  git(root, "clone", "-q", "--bare", work, "repo.git")
  return { root, source: { gitDir: join(root, "repo.git"), commit: git(work, "rev-parse", "HEAD") as Sha } }
}

const schema = {
  type: "object",
  properties: { name: { type: "string" }, line: { type: "integer" } },
  required: ["name", "line"],
  additionalProperties: false
}

const main = async (kinds: ReadonlyArray<HarnessConfig["kind"]>) => {
  const repo = throwawayRepo()
  const self = fileURLToPath(import.meta.url)
  const harness = makeHarness(Object.fromEntries(kinds.map((k) => [k, configs[k]])) as Record<HarnessKey, HarnessConfig>, {
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
        instructions: "You answer one question about a repository. Use the grep, list_files and read_file tools; they read the exact commit under review.",
        prompt: "Which exported function in src/math.ts subtracts, and on which line is it defined?",
        source: repo.source,
        outputSchema: schema,
        maxTurns: 6,
        timeout: Duration.minutes(3)
      }))
      const ms = Date.now() - started
      console.log(JSON.stringify(Exit.isSuccess(exit) ? { kind, model, effort, ms, ...exit.value } : { kind, model, effort, ms, failure: String(exit.cause) }, null, 2))
    }
  } finally {
    rmSync(repo.root, { recursive: true, force: true })
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
