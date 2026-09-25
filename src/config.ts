import { createHash } from "node:crypto"
import * as NodePath from "node:path"
import { Effect, FileSystem, Result, Schema } from "effect"
import type { NonEmptyReadonlyArray } from "effect/Array"
import {
  type BranchSpec,
  type Gate,
  GateName,
  HarnessKey,
  type LabelMap,
  type Lane,
  LaneName,
  type Profile,
  ProfileName,
  UserId
} from "./domain.ts"

export class ConfigError extends Schema.TaggedError<ConfigError>()("ConfigError", {
  message: Schema.String
}) {}

const Text = Schema.String.check(Schema.isMinLength(1))
const Positive = Schema.Int.check(Schema.isGreaterThan(0))

const HarnessFile = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("claude-cli"), concurrency: Positive, command: Schema.optionalKey(Text) }),
  Schema.Struct({ kind: Schema.Literal("codex-cli"), concurrency: Positive, command: Schema.optionalKey(Text) }),
  Schema.Struct({ kind: Schema.Literal("ai-sdk"), provider: Schema.Literal("openrouter"), concurrency: Positive, baseUrl: Schema.optionalKey(Text) })
])
export type HarnessConfig = typeof HarnessFile.Type

const BranchFile = Schema.Struct({ gate: ProfileName, supervisor: ProfileName })
const Gates = Schema.NonEmptyArray(GateName)

const LaneFile = Schema.Union([
  Schema.Struct({ name: LaneName, shape: Schema.Literal("single"), gates: Gates, reviewer: ProfileName }),
  Schema.Struct({ name: LaneName, shape: Schema.Literal("gated"), gates: Gates, gate: ProfileName, supervisor: ProfileName }),
  Schema.Struct({
    name: LaneName,
    shape: Schema.Literal("dual"),
    gates: Gates,
    branches: Schema.Tuple([BranchFile, BranchFile]),
    judge: ProfileName
  })
])

export const ConfigFile = Schema.Struct({
  forge: Schema.Struct({
    kind: Schema.Literal("gitlab"),
    url: Schema.String.check(Schema.isPattern(/^https?:\/\/[^\s/]+(\/[^\s]*)?$/)),
    project: Text,
    botUserId: UserId
  }),
  admission: Schema.optionalKey(Schema.Struct({ allowedTriggerUserIds: Schema.optionalKey(Schema.Array(UserId)) })),
  labels: Schema.optionalKey(Schema.Struct({
    inProgress: Schema.optionalKey(Text),
    pass: Schema.optionalKey(Text),
    changesRequested: Schema.optionalKey(Text),
    blocked: Schema.optionalKey(Text)
  })),
  backend: Schema.optionalKey(HarnessKey),
  harnesses: Schema.Record(HarnessKey, HarnessFile),
  profiles: Schema.Record(ProfileName, Schema.Struct({ harness: Schema.optionalKey(HarnessKey), model: Text, effort: Text })),
  gates: Schema.Record(GateName, Schema.Struct({ instructions: Text })),
  lanes: Schema.NonEmptyArray(LaneFile),
  defaultLane: LaneName,
  rules: Schema.optionalKey(Schema.Array(Schema.Struct({
    id: Text,
    lane: LaneName,
    when: Schema.Literals(["any", "all"]),
    paths: Schema.NonEmptyArray(Text)
  }))),
  policy: Schema.optionalKey(Schema.Struct({ instructions: Schema.Array(Text) })),
  limits: Schema.optionalKey(Schema.Struct({ maxTurns: Schema.optionalKey(Positive), sessionTimeoutSeconds: Schema.optionalKey(Positive) }))
})
export type ConfigFile = typeof ConfigFile.Type

export interface Rule {
  readonly id: string
  readonly lane: Lane
  readonly when: "any" | "all"
  readonly paths: NonEmptyReadonlyArray<string>
}

export interface Config {
  readonly forge: ConfigFile["forge"]
  readonly allowedTriggerUserIds: ReadonlyArray<UserId> | null
  readonly labels: LabelMap
  readonly harnesses: Readonly<Record<HarnessKey, HarnessConfig>>
  /** Severity order: a later lane is stricter. */
  readonly lanes: NonEmptyReadonlyArray<Lane>
  readonly defaultLane: Lane
  readonly rules: ReadonlyArray<Rule>
  readonly policy: ReadonlyArray<string>
  readonly limits: { readonly maxTurns: number; readonly sessionTimeoutSeconds: number }
  /** The file after env overrides, as decoded; printed by `config check`. */
  readonly effective: ConfigFile
  readonly digest: string
}

type EnvKind = "path" | "json" | "string" | "int" | "int-list" | "secret"

export interface EnvVar {
  /** `*` stands for a record key upper-cased with `-` turned into `_`. */
  readonly name: string
  readonly target: ReadonlyArray<string> | null
  readonly kind: EnvKind
  readonly description: string
}

export const envVars: ReadonlyArray<EnvVar> = [
  { name: "HERON_CONFIG", target: null, kind: "path", description: "Config file path when --config is absent." },
  { name: "HERON_CONFIG_JSON", target: null, kind: "json", description: "Whole config as JSON, used when no file path is given." },
  { name: "HERON_GITLAB_URL", target: ["forge", "url"], kind: "string", description: "GitLab base URL." },
  { name: "HERON_PROJECT", target: ["forge", "project"], kind: "string", description: "Project path or numeric id." },
  { name: "HERON_BOT_USER_ID", target: ["forge", "botUserId"], kind: "int", description: "User id that owns the report note." },
  { name: "HERON_ALLOWED_TRIGGER_USERS", target: ["admission", "allowedTriggerUserIds"], kind: "int-list", description: "Comma-separated user ids allowed to trigger a review." },
  { name: "HERON_BACKEND", target: ["backend"], kind: "string", description: "Harness key for profiles that name none." },
  { name: "HERON_DEFAULT_LANE", target: ["defaultLane"], kind: "string", description: "Lane used when no rule matches." },
  { name: "HERON_LABEL_IN_PROGRESS", target: ["labels", "inProgress"], kind: "string", description: "Label set while a review runs." },
  { name: "HERON_LABEL_PASS", target: ["labels", "pass"], kind: "string", description: "Label for a PASS verdict." },
  { name: "HERON_LABEL_CHANGES_REQUESTED", target: ["labels", "changesRequested"], kind: "string", description: "Label for a CHANGES REQUESTED verdict." },
  { name: "HERON_LABEL_BLOCKED", target: ["labels", "blocked"], kind: "string", description: "Label for a BLOCKED verdict." },
  { name: "HERON_MAX_TURNS", target: ["limits", "maxTurns"], kind: "int", description: "Tool-use turns per session." },
  { name: "HERON_SESSION_TIMEOUT_SECONDS", target: ["limits", "sessionTimeoutSeconds"], kind: "int", description: "Wall-clock limit per session." },
  { name: "HERON_PROFILE_*_HARNESS", target: ["profiles", "*", "harness"], kind: "string", description: "Harness key of one profile." },
  { name: "HERON_PROFILE_*_MODEL", target: ["profiles", "*", "model"], kind: "string", description: "Model of one profile." },
  { name: "HERON_PROFILE_*_EFFORT", target: ["profiles", "*", "effort"], kind: "string", description: "Reasoning effort of one profile." },
  { name: "HERON_HARNESS_*_CONCURRENCY", target: ["harnesses", "*", "concurrency"], kind: "int", description: "Parallel sessions on one harness." },
  { name: "HERON_HARNESS_*_COMMAND", target: ["harnesses", "*", "command"], kind: "string", description: "Vendor CLI path for a claude-cli or codex-cli harness." },
  { name: "HERON_HARNESS_*_BASE_URL", target: ["harnesses", "*", "baseUrl"], kind: "string", description: "API base URL for an ai-sdk harness." },
  { name: "GITLAB_TOKEN", target: null, kind: "secret", description: "Bot token for the GitLab API. Never passed to a harness." },
  { name: "GITLAB_USER_ID", target: null, kind: "int", description: "Triggering user when --triggered-by is absent; GitLab CI sets it." },
  { name: "CLAUDE_CODE_OAUTH_TOKEN", target: null, kind: "secret", description: "Token for the claude-cli harness." },
  { name: "CODEX_HOME", target: null, kind: "secret", description: "Persistent Codex home for the codex-cli harness." },
  { name: "OPENROUTER_API_KEY", target: null, kind: "secret", description: "API key for the ai-sdk harness." }
]

export type Env = Readonly<Record<string, string | undefined>>

const envKey = (key: string) => key.toUpperCase().replace(/-/g, "_")

const envValue = (row: EnvVar, text: string): Result.Result<unknown, ConfigError> => {
  const int = (s: string) => /^\d+$/.test(s.trim()) ? Result.succeed(Number(s.trim())) : Result.fail(new ConfigError({ message: `${row.name}: expected an integer, got "${s}"` }))
  switch (row.kind) {
    case "int":
      return int(text)
    case "int-list":
      return Result.all(text.split(",").filter((s) => s.trim() !== "").map(int))
    default:
      return Result.succeed(text)
  }
}

type Json = { [key: string]: unknown }
const isObject = (u: unknown): u is Json => typeof u === "object" && u !== null && !Array.isArray(u)

const setPath = (root: Json, path: ReadonlyArray<string>, value: unknown): void => {
  let node = root
  for (const key of path.slice(0, -1)) {
    const next = node[key]
    node = isObject(next) ? next : (node[key] = {})
  }
  node[path[path.length - 1]!] = value
}

/** Env overrides apply to the raw JSON so the decoded result is checked exactly like a file value. */
export const applyEnv = (raw: unknown, env: Env): Result.Result<unknown, ConfigError> => {
  if (!isObject(raw)) return Result.succeed(raw)
  const out: Json = structuredClone(raw)
  for (const row of envVars) {
    if (row.target === null) continue
    const star = row.target.indexOf("*")
    const record = star < 0 ? null : out[row.target[0]!]
    const targets: ReadonlyArray<readonly [string, ReadonlyArray<string>]> = star < 0
      ? [[row.name, row.target]]
      : isObject(record)
      ? Object.keys(record).map((k) => [row.name.replace("*", envKey(k)), row.target!.map((p) => p === "*" ? k : p)] as const)
      : []
    for (const [name, path] of targets) {
      const text = env[name]
      if (text === undefined || text === "") continue
      const value = envValue(row, text)
      if (Result.isFailure(value)) return value
      setPath(out, path, value.success)
    }
  }
  return Result.succeed(out)
}

export const decodeConfigFile = (raw: unknown, env: Env): Result.Result<ConfigFile, ConfigError> =>
  Result.flatMap(applyEnv(raw, env), (withEnv) =>
    Result.mapError(
      Schema.decodeUnknownResult(ConfigFile, { onExcessProperty: "error", errors: "all" })(withEnv),
      (e) => new ConfigError({ message: e.message })
    ))

/** Every instruction file the config names, relative to the config's directory. */
export const instructionPaths = (file: ConfigFile): ReadonlyArray<string> => [
  ...Object.values(file.gates).map((g) => g.instructions),
  ...(file.policy?.instructions ?? [])
]

const canonical = (u: unknown): string =>
  Array.isArray(u)
    ? `[${u.map(canonical).join(",")}]`
    : isObject(u)
    ? `{${Object.keys(u).sort().map((k) => `${JSON.stringify(k)}:${canonical(u[k])}`).join(",")}}`
    : JSON.stringify(u)

const sha256 = (text: string) => createHash("sha256").update(text).digest("hex")

const missing = (what: string) => Result.fail(new ConfigError({ message: what }))

/** Cross-reference checks and name resolution; `texts` maps each instruction path to its content. */
export const resolveConfig = (
  file: ConfigFile,
  texts: ReadonlyMap<string, string>
): Result.Result<Config, ConfigError> =>
  Result.gen(function*() {
    const text = (path: string) => {
      const content = texts.get(path)
      return content === undefined ? missing(`instruction file not read: ${path}`) : Result.succeed(content)
    }
    const profile = (name: ProfileName): Result.Result<Profile, ConfigError> => {
      const p = file.profiles[name]
      if (p === undefined) return missing(`unknown profile "${name}"`)
      const harness = p.harness ?? file.backend
      if (harness === undefined) return missing(`profile "${name}" names no harness and no backend is set`)
      if (file.harnesses[harness] === undefined) return missing(`profile "${name}" uses unknown harness "${harness}"`)
      return Result.succeed({ name, harness, model: p.model, effort: p.effort })
    }
    const gate = (name: GateName): Result.Result<Gate, ConfigError> => {
      const g = file.gates[name]
      return g === undefined ? missing(`unknown gate "${name}"`) : Result.map(text(g.instructions), (instructions) => ({ name, instructions }))
    }
    const branch = (b: { gate: ProfileName; supervisor: ProfileName }): Result.Result<BranchSpec, ConfigError> =>
      Result.all({ gate: profile(b.gate), supervisor: profile(b.supervisor) })

    const lanes: Array<Lane> = []
    for (const l of file.lanes) {
      if (lanes.some((x) => x.name === l.name)) return yield* missing(`duplicate lane "${l.name}"`)
      if (new Set(l.gates).size !== l.gates.length) return yield* missing(`lane "${l.name}" repeats a gate`)
      const [first, ...rest] = l.gates
      const gates = [yield* gate(first), ...(yield* Result.all(rest.map(gate)))] as const
      switch (l.shape) {
        case "single":
          lanes.push({ name: l.name, shape: "single", gates, reviewer: yield* profile(l.reviewer) })
          break
        case "gated":
          lanes.push({ name: l.name, shape: "gated", gates, branch: yield* branch(l) })
          break
        case "dual":
          lanes.push({
            name: l.name,
            shape: "dual",
            gates,
            branches: [yield* branch(l.branches[0]), yield* branch(l.branches[1])],
            judge: yield* profile(l.judge)
          })
      }
    }
    const lane = (name: LaneName) => {
      const found = lanes.find((l) => l.name === name)
      return found === undefined ? missing(`unknown lane "${name}"`) : Result.succeed(found)
    }
    const rules: Array<Rule> = []
    for (const r of file.rules ?? []) rules.push({ id: r.id, lane: yield* lane(r.lane), when: r.when, paths: r.paths })

    const labels: LabelMap = {
      inProgress: file.labels?.inProgress ?? null,
      pass: file.labels?.pass ?? null,
      changesRequested: file.labels?.changesRequested ?? null,
      blocked: file.labels?.blocked ?? null
    }
    const named = Object.values(labels).filter((l) => l !== null)
    if (new Set(named).size !== named.length) return yield* missing("label names must be distinct")

    const policy = yield* Result.all((file.policy?.instructions ?? []).map(text))
    const instructions = Object.fromEntries(instructionPaths(file).map((p) => [p, sha256(texts.get(p) ?? "")]))
    return {
      forge: file.forge,
      allowedTriggerUserIds: file.admission?.allowedTriggerUserIds ?? null,
      labels,
      harnesses: file.harnesses,
      lanes: [lanes[0]!, ...lanes.slice(1)],
      defaultLane: yield* lane(file.defaultLane),
      rules,
      policy,
      limits: { maxTurns: file.limits?.maxTurns ?? 40, sessionTimeoutSeconds: file.limits?.sessionTimeoutSeconds ?? 900 },
      effective: file,
      digest: sha256(canonical({ config: file, instructions }))
    }
  })

export type ConfigSource =
  | { readonly kind: "file"; readonly path: string }
  | { readonly kind: "json"; readonly text: string }

/** `--config` wins, then HERON_CONFIG, then HERON_CONFIG_JSON, then ./heron.config.json. */
export const configSource = (flag: string | null, env: Env): ConfigSource =>
  flag !== null
    ? { kind: "file", path: flag }
    : env["HERON_CONFIG"]
    ? { kind: "file", path: env["HERON_CONFIG"] }
    : env["HERON_CONFIG_JSON"]
    ? { kind: "json", text: env["HERON_CONFIG_JSON"] }
    : { kind: "file", path: "heron.config.json" }

export const loadConfig = Effect.fn("loadConfig")(function*(source: ConfigSource, env: Env) {
  const fs = yield* FileSystem.FileSystem
  const fail = (message: string) => new ConfigError({ message })
  const text = source.kind === "json"
    ? source.text
    : yield* fs.readFileString(source.path).pipe(Effect.mapError(() => fail(`cannot read config file ${source.path}`)))
  const raw = yield* Effect.try({ try: () => JSON.parse(text) as unknown, catch: () => fail("config is not valid JSON") })
  const file = yield* Effect.fromResult(decodeConfigFile(raw, env))
  const base = source.kind === "file" ? NodePath.dirname(source.path) : "."
  const texts = new Map<string, string>()
  for (const path of instructionPaths(file)) {
    const content = yield* fs.readFileString(NodePath.resolve(base, path)).pipe(
      Effect.mapError(() => fail(`cannot read instruction file ${path}`))
    )
    texts.set(path, content)
  }
  return yield* Effect.fromResult(resolveConfig(file, texts))
})
