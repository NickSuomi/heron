import { readFileSync } from "node:fs"
import { afterAll, describe, expect, it } from "@effect/vitest"
import { Duration, Effect } from "effect"
import type { HarnessConfig } from "../src/config.ts"
import type { HarnessKey } from "../src/domain.ts"
import { makeHarness } from "../src/harness/index.ts"
import { type Captured, fakeCli, makeRepo } from "./fixtures/harness/repo.ts"
import { jobEnv, requestFor } from "./fixtures/harness/request.ts"

const repo = makeRepo()
afterAll(repo.cleanup)

const harnesses = {
  alpha: { kind: "claude-cli", concurrency: 1, command: fakeCli(repo.root, "claude-success.jsonl").bin },
  beta: { kind: "codex-cli", concurrency: 1, command: fakeCli(repo.root, "codex-success.synthetic.jsonl").bin },
  gamma: { kind: "ai-sdk", provider: "openrouter", concurrency: 1 }
} as Readonly<Record<HarnessKey, HarnessConfig>>

describe("makeHarness", () => {
  it.effect("dispatches by the profile's harness key", () =>
    Effect.gen(function*() {
      const harness = makeHarness(harnesses, { env: jobEnv })
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

const alive = (pid: number) => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

describe("session timeout", () => {
  it.live("fails a hung vendor session with a timeout and kills its whole process group", () =>
    Effect.gen(function*() {
      const hung = fakeCli(repo.root, "claude-success.jsonl", "hang")
      const harness = makeHarness({ alpha: { kind: "claude-cli", concurrency: 1, command: hung.bin } } as Readonly<Record<HarnessKey, HarnessConfig>>, { env: jobEnv })
      const error = yield* Effect.flip(harness.run(requestFor("alpha", repo.source, Duration.millis(1000))))
      const { pids } = JSON.parse(readFileSync(hung.capture, "utf8")) as Captured
      let survivors = pids.filter(alive)
      for (let i = 0; i < 40 && survivors.length > 0; i++) {
        yield* Effect.sleep(50)
        survivors = pids.filter(alive)
      }
      expect([error.kind, error.detail, pids.length, survivors]).toEqual(["timeout", "no result within 1s", 2, []])
    }))
})
