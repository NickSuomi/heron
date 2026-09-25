import { Duration } from "effect"
import type { GateName, HarnessKey, ProfileName, SessionId } from "../../../src/domain.ts"
import type { HarnessRequest, SourceCheckout } from "../../../src/ports.ts"

export const answerSchema = {
  type: "object",
  properties: { answer: { type: "integer" } },
  required: ["answer"],
  additionalProperties: false
}

export const requestFor = (harness: string, source: SourceCheckout | null, timeout = Duration.seconds(20)): HarnessRequest => ({
  slot: {
    id: "reviewer" as SessionId,
    role: "reviewer",
    profile: { name: "p" as ProfileName, harness: harness as HarnessKey, model: "model-x", effort: "low" },
    gates: [{ name: "correctness" as GateName, instructions: "Check correctness." }]
  },
  instructions: "You review code.",
  prompt: "What number does a.ts export?",
  source,
  outputSchema: answerSchema,
  maxTurns: 6,
  timeout
})

/** Env as a CI job would have it: the forge token must never reach a vendor process. */
export const jobEnv = {
  PATH: process.env["PATH"] ?? "",
  HOME: "/tmp/heron-home",
  GITLAB_TOKEN: "glpat-must-not-leak",
  CI_JOB_TOKEN: "job-token-must-not-leak",
  CLAUDE_CODE_OAUTH_TOKEN: "sk-ant-oat-test-token",
  CODEX_HOME: "/var/lib/codex-home",
  HTTPS_PROXY: "http://proxy.invalid:3128"
}
