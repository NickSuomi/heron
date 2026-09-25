import { afterAll, describe, expect, it } from "@effect/vitest"
import { MockLanguageModelV4 } from "ai/test"
import { Effect } from "effect"
import { aiSdk, openRouterBinding } from "../src/harness/aiSdk.ts"
import { HarnessError } from "../src/ports.ts"
import { makeRepo } from "./fixtures/harness/repo.ts"
import { requestFor } from "./fixtures/harness/request.ts"

const repo = makeRepo()
afterAll(repo.cleanup)

const usage = (input: number, output: number, reasoning: number) => ({
  inputTokens: { total: input, noCache: input - 10, cacheRead: 10, cacheWrite: 0 },
  outputTokens: { total: output, text: output - reasoning, reasoning }
})
const openrouterCost = (cost: number) => ({ openrouter: { usage: { cost } } })

const model = () =>
  new MockLanguageModelV4({
    modelId: "vendor/model-x",
    doGenerate: [
      {
        content: [{ type: "tool-call", toolCallId: "call-1", toolName: "grep", input: JSON.stringify({ pattern: "sub" }) }],
        finishReason: { unified: "tool-calls", raw: "tool_calls" },
        usage: usage(100, 20, 5),
        providerMetadata: openrouterCost(0.002),
        response: { id: "gen-1", modelId: "vendor/model-x-2026", timestamp: new Date(0) },
        warnings: []
      },
      {
        content: [{ type: "text", text: "{\"answer\":2}" }],
        finishReason: { unified: "stop", raw: "stop" },
        usage: usage(200, 30, 10),
        providerMetadata: openrouterCost(0.003),
        response: { id: "gen-2", modelId: "vendor/model-x-2026", timestamp: new Date(0) },
        warnings: []
      }
    ]
  })

const binding = (mock: MockLanguageModelV4) => {
  const openrouter = openRouterBinding({ OPENROUTER_API_KEY: "test-key" }, undefined)
  if (openrouter instanceof HarnessError) throw openrouter
  return { ...openrouter, model: () => mock }
}

describe("ai-sdk harness", () => {
  it.live("runs a source tool, then returns structured output with summed usage and cost", () =>
    Effect.gen(function*() {
      const mock = model()
      const result = yield* aiSdk(binding(mock))(requestFor("api", repo.source))
      expect(result).toEqual({
        output: { answer: 2 },
        reportedModel: "vendor/model-x-2026",
        vendorSessionId: "gen-2",
        usage: { inputTokens: 300, cachedInputTokens: 20, outputTokens: 50, reasoningTokens: 15, costUsd: 0.005 },
        toolCalls: 1
      })
      const second = JSON.stringify(mock.doGenerateCalls[1]!.prompt)
      expect(second).toContain(JSON.stringify(JSON.stringify({ lines: ["src/math.ts:2:export const sub = (a: number, b: number) => a - b"], truncated: false })).slice(1, -1))
      const first = mock.doGenerateCalls[0]!
      expect([first.tools?.map((t) => t.name), first.providerOptions, first.responseFormat?.type]).toEqual([
        ["grep", "list_files", "read_file"],
        { openrouter: { reasoning: { effort: "low" } } },
        "json"
      ])
    }))

  it.live("offers the judge no tools", () =>
    Effect.gen(function*() {
      const mock = new MockLanguageModelV4({
        doGenerate: {
          content: [{ type: "text", text: "{\"answer\":1}" }],
          finishReason: { unified: "stop", raw: "stop" },
          usage: usage(50, 5, 0),
          warnings: []
        }
      })
      const result = yield* aiSdk(binding(mock))(requestFor("api", null))
      expect([result.output, result.toolCalls, mock.doGenerateCalls[0]!.tools ?? []]).toEqual([{ answer: 1 }, 0, []])
    }))

  it.effect("refuses an effort OpenRouter does not define, and a missing key", () =>
    Effect.gen(function*() {
      const request = requestFor("api", null)
      const bad = { ...request, slot: { ...request.slot, profile: { ...request.slot.profile, effort: "max" } } }
      const error = yield* Effect.flip(aiSdk(binding(model()))(bad))
      expect([error.kind, error.detail]).toEqual(["vendor", "effort \"max\" is not an OpenRouter reasoning effort (xhigh, high, medium, low, minimal, none)"])
      const missing = openRouterBinding({}, undefined)
      expect(missing instanceof HarnessError && [missing.kind, missing.detail]).toEqual(["auth", "OPENROUTER_API_KEY is not set"])
    }))
})
