import { createOpenRouter } from "@openrouter/ai-sdk-provider"
import {
  APICallError,
  generateText,
  isStepCount,
  jsonSchema,
  type JSONSchema7,
  type LanguageModel,
  NoOutputGeneratedError,
  Output,
  tool,
  type ToolSet
} from "ai"
import { Effect } from "effect"
import { z } from "zod"
import type { Env } from "../config.ts"
import { HarnessError, type HarnessRequest, type HarnessResult, type SourceCheckout } from "../ports.ts"
import { runSourceTool, sourceTools } from "./sourceTools.ts"

type ProviderOptions = NonNullable<Parameters<typeof generateText>[0]["providerOptions"]>

export interface AiSdkBinding {
  readonly model: (modelId: string) => LanguageModel
  /** Maps the profile's effort to provider options; a string is a configuration error to report. */
  readonly options: (effort: string) => ProviderOptions | string
  /** Sums the vendor-reported cost from one step's provider metadata. */
  readonly cost: (metadata: unknown) => number | null
}

/** The source tools as AI SDK tools. Tool failures go back to the model as text so it can correct itself. */
export const aiSourceTools = (source: SourceCheckout): ToolSet =>
  Object.fromEntries(sourceTools.map((t) => [
    t.name,
    tool({
      description: t.description,
      inputSchema: z.object(t.input),
      execute: async (args: unknown, { abortSignal }) => (await Effect.runPromise(runSourceTool(t, source, args), { signal: abortSignal })).text
    })
  ]))

const failure = (error: unknown): HarnessError => {
  if (NoOutputGeneratedError.isInstance(error)) return new HarnessError({ kind: "no-output", detail: "the model produced no structured output" })
  if (APICallError.isInstance(error)) {
    const status = error.statusCode
    const kind = status === 401 || status === 403 ? "auth" : status === 402 || status === 429 ? "quota" : "vendor"
    return new HarnessError({ kind, detail: `provider returned HTTP ${status ?? "error"}` })
  }
  const name = error instanceof Error ? error.name : "error"
  return new HarnessError({ kind: "vendor", detail: `generation failed (${name})` })
}

export const aiSdk = (binding: AiSdkBinding) => (request: HarnessRequest) =>
  Effect.gen(function*() {
    const providerOptions = binding.options(request.slot.profile.effort)
    if (typeof providerOptions === "string") return yield* new HarnessError({ kind: "vendor", detail: providerOptions })
    const result = yield* Effect.tryPromise({
      try: async (signal) => {
        const r = await generateText({
          model: binding.model(request.slot.profile.model),
          instructions: request.instructions,
          prompt: request.prompt,
          tools: request.source === null ? {} : aiSourceTools(request.source),
          stopWhen: isStepCount(request.maxTurns),
          // The core decodes the output against its schema; the AI SDK only needs the JSON Schema to constrain generation.
          output: Output.object({ schema: jsonSchema(request.outputSchema as JSONSchema7) }),
          providerOptions,
          abortSignal: signal
        })
        return { r, output: r.output as unknown }
      },
      catch: failure
    })
    const { output, r } = result
    const costs = r.steps.map((s) => binding.cost(s.providerMetadata))
    const usage = r.totalUsage
    return {
      output,
      reportedModel: r.response.modelId,
      vendorSessionId: r.response.id,
      usage: {
        inputTokens: usage.inputTokens ?? null,
        cachedInputTokens: usage.inputTokenDetails.cacheReadTokens ?? null,
        outputTokens: usage.outputTokens ?? null,
        reasoningTokens: usage.outputTokenDetails.reasoningTokens ?? null,
        costUsd: costs.every((c) => c === null) ? null : costs.reduce<number>((a, c) => a + (c ?? 0), 0)
      },
      toolCalls: r.steps.reduce((n, s) => n + s.toolCalls.length, 0)
    } satisfies HarnessResult
  })

/** OpenRouter's documented reasoning efforts (`OpenRouterProviderOptions.reasoning.effort`, provider 3.0.0). */
const OPENROUTER_EFFORTS = ["xhigh", "high", "medium", "low", "minimal", "none"] as const

const isRecord = (u: unknown): u is Record<string, unknown> => typeof u === "object" && u !== null

export const OPENROUTER_CREDENTIALS = ["OPENROUTER_API_KEY"]

export const openRouterBinding = (env: Env, baseURL: string | undefined): AiSdkBinding | HarnessError => {
  const apiKey = env["OPENROUTER_API_KEY"]
  if (apiKey === undefined || apiKey === "") return new HarnessError({ kind: "auth", detail: "OPENROUTER_API_KEY is not set" })
  const provider = createOpenRouter({ apiKey, ...(baseURL === undefined ? {} : { baseURL }) })
  return {
    model: (id) => provider.chat(id, { usage: { include: true } }),
    options: (effort) =>
      (OPENROUTER_EFFORTS as ReadonlyArray<string>).includes(effort)
        ? { openrouter: { reasoning: { effort } } }
        : `effort "${effort}" is not an OpenRouter reasoning effort (${OPENROUTER_EFFORTS.join(", ")})`,
    cost: (metadata) => {
      const openrouter = isRecord(metadata) ? metadata["openrouter"] : undefined
      const usage = isRecord(openrouter) ? openrouter["usage"] : undefined
      const cost = isRecord(usage) ? usage["cost"] : undefined
      return typeof cost === "number" ? cost : null
    }
  }
}
