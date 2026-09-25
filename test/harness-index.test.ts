import { afterAll, describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import type { HarnessConfig } from "../src/config.ts"
import type { HarnessKey } from "../src/domain.ts"
import { makeHarness } from "../src/harness/index.ts"
import { fakeCli, makeRepo } from "./fixtures/harness/repo.ts"
import { jobEnv, requestFor } from "./fixtures/harness/request.ts"

const repo = makeRepo()
afterAll(repo.cleanup)

const harnesses = {
  alpha: { kind: "claude-cli", concurrency: 1 },
  beta: { kind: "codex-cli", concurrency: 1 },
  gamma: { kind: "ai-sdk", provider: "openrouter", concurrency: 1 }
} as Readonly<Record<HarnessKey, HarnessConfig>>

describe("makeHarness", () => {
  it.effect("dispatches by the profile's harness key", () =>
    Effect.gen(function*() {
      const harness = makeHarness(harnesses, {
        env: jobEnv,
        claudeCommand: fakeCli(repo.root, "claude-success.jsonl").bin,
        codexCommand: fakeCli(repo.root, "codex-success.synthetic.jsonl").bin
      })
      const claude = yield* harness.run(requestFor("alpha", repo.source))
      const codex = yield* harness.run(requestFor("beta", repo.source))
      const api = yield* Effect.flip(harness.run(requestFor("gamma", null)))
      const unknown = yield* Effect.flip(harness.run(requestFor("delta", null)))
      expect([claude.reportedModel, codex.vendorSessionId, [api.kind, api.detail], [unknown.kind, unknown.detail]]).toEqual([
        "claude-sonnet-5",
        "0199a213-81c0-7800-8aa1-bbab2a035a53",
        ["auth", "OPENROUTER_API_KEY is not set"],
        ["vendor", "no harness configured under \"delta\""]
      ])
    }))
})
