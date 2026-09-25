import { execFileSync } from "node:child_process"
import { describe, expect, it } from "@effect/vitest"

const configCheck = (env: Record<string, string>) =>
  execFileSync(process.execPath, ["src/cli.ts", "config", "check", "--config", "heron.config.example.json"], {
    encoding: "utf8",
    env: { PATH: process.env["PATH"] ?? "", ...env }
  }).split("\n").filter((l) => /^(GITLAB_TOKEN|claude-cli|codex-cli|ai-sdk)\b/.test(l))

describe("heron config check", () => {
  it("reports each harness credential by the variables that harness accepts", () => {
    expect(configCheck({ ANTHROPIC_API_KEY: "k", CODEX_HOME: "/var/lib/codex" })).toEqual([
      "GITLAB_TOKEN: missing",
      "claude-cli credential (CLAUDE_CODE_OAUTH_TOKEN or ANTHROPIC_API_KEY): set via ANTHROPIC_API_KEY",
      "codex-cli credential (CODEX_API_KEY or CODEX_HOME): set via CODEX_HOME",
      "ai-sdk credential (OPENROUTER_API_KEY): missing"
    ])
    expect(configCheck({ GITLAB_TOKEN: "t", CLAUDE_CODE_OAUTH_TOKEN: "o", CODEX_API_KEY: "c", OPENROUTER_API_KEY: "r" })).toEqual([
      "GITLAB_TOKEN: set",
      "claude-cli credential (CLAUDE_CODE_OAUTH_TOKEN or ANTHROPIC_API_KEY): set via CLAUDE_CODE_OAUTH_TOKEN",
      "codex-cli credential (CODEX_API_KEY or CODEX_HOME): set via CODEX_API_KEY",
      "ai-sdk credential (OPENROUTER_API_KEY): set via OPENROUTER_API_KEY"
    ])
  })
})
