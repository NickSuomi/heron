import * as NodeServices from "@effect/platform-node/NodeServices"
import { describe, expect, it } from "@effect/vitest"
import { Effect, Result } from "effect"
import { configSource, decodeConfigFile, loadConfig, resolveConfig } from "../src/config.ts"
import { baseConfig, configOf, texts } from "./fakes.ts"

const errorOf = (raw: unknown, env: Record<string, string> = {}) => {
  const r = Result.flatMap(decodeConfigFile(raw, env), (file) => resolveConfig(file, texts))
  return Result.isFailure(r) ? r.failure.message : "ok"
}

describe("config", () => {
  it.effect("loads the shipped example file", () =>
    Effect.gen(function*() {
      const config = yield* loadConfig({ kind: "file", path: "heron.config.example.json" }, {})
      expect(config.lanes.map((l) => `${l.name}:${l.shape}`)).toEqual(["light:single", "standard:gated", "critical:dual"])
      expect(config.defaultLane.name).toBe("standard")
      expect(config.labels.inProgress).toBe("review::in progress")
      expect(config.digest).toMatch(/^[0-9a-f]{64}$/)
    }).pipe(Effect.provide(NodeServices.layer)))

  it("applies scalar env overrides, including keyed ones", () => {
    const config = configOf(baseConfig, {
      HERON_PROJECT: "other/app",
      HERON_ALLOWED_TRIGGER_USERS: "7, 8",
      HERON_PROFILE_QUICK_MODEL: "model-x",
      HERON_HARNESS_BETA_CONCURRENCY: "3",
      HERON_LABEL_PASS: "lgtm"
    })
    expect([config.forge.project, config.allowedTriggerUserIds, config.harnesses["beta" as never]?.concurrency, config.labels.pass]).toEqual([
      "other/app",
      [7, 8],
      3,
      "lgtm"
    ])
    expect(config.lanes[0].shape === "single" && config.lanes[0].reviewer.model).toBe("model-x")
  })

  it("routes profiles without a harness to the backend, which HERON_BACKEND overrides", () => {
    const lane = configOf(baseConfig, { HERON_BACKEND: "beta" }).lanes[0]
    expect(lane.shape === "single" && lane.reviewer.harness).toBe("beta")
  })

  it("rejects bad references, unknown keys and malformed env values", () => {
    expect(errorOf({ ...baseConfig, defaultLane: "nope" })).toBe(`unknown lane "nope"`)
    expect(errorOf({ ...baseConfig, profiles: { ...baseConfig.profiles, quick: { harness: "gamma", model: "m", effort: "low" } } })).toBe(
      `profile "quick" uses unknown harness "gamma"`
    )
    expect(errorOf({ ...baseConfig, lanes: [{ name: "x", shape: "single", gates: ["spec"], reviewer: "quick" }], defaultLane: "x", rules: [] }))
      .toBe(`unknown gate "spec"`)
    expect(errorOf({ ...baseConfig, labels: { pass: "same", blocked: "same" } })).toBe("label names must be distinct")
    expect(errorOf(baseConfig, { HERON_MAX_TURNS: "many" })).toBe(`HERON_MAX_TURNS: expected an integer, got "many"`)
    expect(errorOf({ ...baseConfig, extra: true })).toContain(`"extra"`)
  })

  it("changes the digest when an instruction file changes", () => {
    const changed = new Map([...texts, ["design.md", "Check the design twice."]])
    expect(configOf(baseConfig, {}, changed).digest).not.toBe(configOf().digest)
    expect(configOf().digest).toBe(configOf().digest)
  })

  it("resolves the config source in precedence order", () => {
    expect(configSource("a.json", { HERON_CONFIG: "b.json" })).toEqual({ kind: "file", path: "a.json" })
    expect(configSource(null, { HERON_CONFIG: "b.json", HERON_CONFIG_JSON: "{}" })).toEqual({ kind: "file", path: "b.json" })
    expect(configSource(null, { HERON_CONFIG_JSON: "{}" })).toEqual({ kind: "json", text: "{}" })
    expect(configSource(null, {})).toEqual({ kind: "file", path: "heron.config.json" })
  })
})
