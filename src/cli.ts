#!/usr/bin/env node
import * as NodeRuntime from "@effect/platform-node/NodeRuntime"
import * as NodeHttpClient from "@effect/platform-node/NodeHttpClient"
import * as NodeServices from "@effect/platform-node/NodeServices"
import { Console, Effect, Layer, Option, Schema } from "effect"
import { Command, Flag } from "effect/unstable/cli"
import pkg from "../package.json" with { type: "json" }
import { type Config, configSource, type Env, type HarnessConfig, loadConfig } from "./config.ts"
import { UserId } from "./domain.ts"
import { GitLabForge } from "./forge/gitlab.ts"
import { harnessCredentials, HarnessLive, runMcpSource } from "./harness/index.ts"
import { reviewOnce } from "./review.ts"

const env: Env = process.env
const configFlag = Flag.String("config").pipe(Flag.withDescription("Config file path"), Flag.optional)
const load = (flag: Option.Option<string>) => loadConfig(configSource(Option.getOrNull(flag), env), env)

const credential = (kind: HarnessConfig["kind"]): string => {
  const names = harnessCredentials[kind]
  const found = names.find((name) => env[name])
  return `${kind} credential (${names.join(" or ")}): ${found === undefined ? "missing" : `set via ${found}`}`
}

const describe = (config: Config): string => {
  const kinds = [...new Set(Object.values(config.harnesses).map((h) => h.kind))]
  return [
    JSON.stringify(config.effective, null, 2),
    `lanes: ${config.lanes.map((l) => `${l.name} (${l.shape}, ${l.gates.length} gates)`).join(", ")}; default ${config.defaultLane.name}`,
    `GITLAB_TOKEN: ${env["GITLAB_TOKEN"] ? "set" : "missing"}`,
    ...kinds.map(credential),
    `digest: ${config.digest}`
  ].join("\n")
}

const triggeredBy = (flag: Option.Option<number>) => {
  const raw = Option.getOrElse(flag, () => env["GITLAB_USER_ID"] === undefined ? null : Number(env["GITLAB_USER_ID"]))
  return raw === null ? Effect.succeed(null) : Schema.decodeUnknownEffect(UserId)(raw)
}

const review = Command.make("review", {
  mr: Flag.Int("mr").pipe(Flag.withDescription("Merge request IID")),
  dryRun: Flag.Boolean("dry-run").pipe(Flag.withDefault(false), Flag.withDescription("Print the report; publish nothing and leave labels alone")),
  config: configFlag,
  triggeredBy: Flag.Int("triggered-by").pipe(Flag.withDescription("User id that triggered the review; defaults to GITLAB_USER_ID"), Flag.optional)
}, (flags) =>
  Effect.gen(function*() {
    const config = yield* load(flags.config)
    const result = yield* reviewOnce(config, {
      ref: { project: config.forge.project, iid: flags.mr },
      triggeredBy: yield* triggeredBy(flags.triggeredBy),
      publish: !flags.dryRun
    }).pipe(
      Effect.provide(Layer.mergeAll(GitLabForge.layer(config), HarnessLive(config, { env }))),
      Effect.provide(NodeHttpClient.layerUndici)
    )
    yield* Console.log(result.note.kind === "dry-run" ? result.body : `${result.review.verdict}: note ${result.note.note} ${result.note.kind}`)
  })).pipe(Command.withDescription("Review one merge request at its current head"))

const check = Command.make("check", { config: configFlag }, (flags) =>
  load(flags.config).pipe(Effect.flatMap((config) => Console.log(describe(config))))).pipe(
    Command.withDescription("Validate the config and print it with its digest; no network")
  )

const configCommand = Command.make("config").pipe(Command.withSubcommands([check]), Command.withDescription("Config commands"))

const heron = Command.make("heron").pipe(
  Command.withSubcommands([
    review,
    configCommand
  ])
)

// The MCP server owns stdout for its protocol, so it must start before the CLI framework can write anything.
if (process.argv[2] === "mcp-source") {
  await runMcpSource(process.argv.slice(3))
} else {
  Command.run(heron, { version: pkg.version }).pipe(Effect.provide(NodeServices.layer), NodeRuntime.runMain)
}
