import { Config as EnvConfig, Effect, Layer, Option, Redacted, Schema } from "effect"
import { HttpClient, HttpClientRequest } from "effect/http"
import type { MemoryConfig } from "../config.ts"
import type { MemoryEntry, MemoryWrite } from "../domain.ts"
import { Memory, MemoryError, type MemoryShape } from "../ports.ts"

/**
 * Hindsight's HTTP API (hindsight-clients/go/api/openapi.yaml at v0.10.1): recall is
 * `POST /v1/default/banks/{bank}/memories/recall`, retain is `POST /v1/default/banks/{bank}/memories`, and a bank's
 * config is `PATCH /v1/default/banks/{bank}/config`. A write creates a missing bank; a read of one answers 404.
 */
const RecallResponse = Schema.Struct({
  results: Schema.Array(Schema.Struct({
    text: Schema.String,
    metadata: Schema.optionalKey(Schema.NullOr(Schema.Record(Schema.String, Schema.String)))
  }))
})

/** How many tokens of memory text one recall may return; Hindsight counts only the text. */
const RECALL_MAX_TOKENS = 2048

/**
 * `chunks` stores each text as one memory without an LLM call, so what a review reads is what the person wrote. Heron
 * sets it on every write, so a bank converges to it however it was created.
 */
const BANK_CONFIG = { updates: { retain_extraction_mode: "chunks" } }

export const make = Effect.fn("Hindsight.make")(function*(config: MemoryConfig, key: Redacted.Redacted<string> | null) {
  const client = yield* HttpClient.HttpClient
  const root = `${config.url.replace(/\/+$/, "")}/v1/default/banks/${encodeURIComponent(config.bank)}`
  const secret = key === null ? null : Redacted.value(key)
  // Only a status or the transport failure's tag reaches the error; a response body could echo anything.
  const fail = (operation: string, detail: string) =>
    new MemoryError({ operation, detail: secret === null ? detail : detail.split(secret).join("[redacted]") })

  const send = (operation: string, method: "POST" | "PATCH", path: string, body: unknown) => {
    const base = HttpClientRequest.make(method)(`${root}${path}`).pipe(HttpClientRequest.acceptJson)
    const request = HttpClientRequest.bodyJsonUnsafe(secret === null ? base : HttpClientRequest.bearerToken(base, secret), body)
    return client.execute(request).pipe(Effect.mapError((e) => fail(operation, `could not reach Hindsight (${e.reason._tag})`)))
  }

  const recall = (query: string) =>
    Effect.gen(function*() {
      const response = yield* send("recall", "POST", "/memories/recall", {
        query,
        // Observations are Hindsight's own paraphrases; a review reads only what people stored.
        types: ["world", "experience"],
        max_tokens: RECALL_MAX_TOKENS
      })
      if (response.status === 404) return []
      if (response.status < 200 || response.status >= 300) return yield* fail("recall", `HTTP ${response.status}`)
      const json = yield* response.json.pipe(Effect.mapError(() => fail("recall", "the response is not JSON")))
      const decoded = yield* Schema.decodeUnknownEffect(RecallResponse)(json).pipe(Effect.mapError(() => fail("recall", "unexpected response shape")))
      return decoded.results.map((r): MemoryEntry => ({ text: r.text, metadata: r.metadata ?? {} }))
    })

  const write = (operation: string, method: "POST" | "PATCH", path: string, body: unknown) =>
    Effect.flatMap(send(operation, method, path, body), (response) =>
      response.status >= 200 && response.status < 300 ? Effect.void : Effect.fail(fail(operation, `HTTP ${response.status}`)))

  const retain = (entry: MemoryWrite) =>
    Effect.andThen(
      write("retain", "PATCH", "/config", BANK_CONFIG),
      write("retain", "POST", "/memories", {
        items: [{ content: entry.text, document_id: entry.id, context: `@heron ${entry.metadata["kind"] ?? "memory"}`, metadata: entry.metadata }],
        async: false
      })
    )

  return { bank: config.bank, recall, retain } satisfies MemoryShape
})

/** The team memory from the config, with HERON_HINDSIGHT_API_KEY when set; no layer at all when none is configured. */
export const layer = (memory: MemoryConfig | null) =>
  memory === null ? Layer.empty : Layer.effect(Memory)(
    Effect.gen(function*() {
      const key = yield* EnvConfig.option(EnvConfig.Redacted("HERON_HINDSIGHT_API_KEY")).pipe(Effect.orElseSucceed(() => Option.none()))
      return yield* make(memory, Option.getOrNull(Option.filter(key, (k) => Redacted.value(k) !== "")))
    })
  )

export const Hindsight = { make, layer } as const
