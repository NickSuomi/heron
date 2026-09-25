import { Effect, Layer } from "effect"
import type { Config, Env, HarnessConfig } from "../config.ts"
import { Harness, HarnessError, type HarnessRequest, type HarnessResult, type HarnessShape } from "../ports.ts"
import { aiSdk, openRouterBinding } from "./aiSdk.ts"
import { claudeCli } from "./claudeCli.ts"
import { codexCli } from "./codexCli.ts"
import { defaultMcpLauncher, type Launcher } from "./mcpSource.ts"

export { runMcpSource } from "./mcpSource.ts"

export interface HarnessOptions {
  readonly env: Env
  /** How a CLI harness starts `heron mcp-source`; defaults to this Node binary running the Heron CLI entry. */
  readonly mcpLauncher?: Launcher
}

type Run = (request: HarnessRequest) => Effect.Effect<HarnessResult, HarnessError>

const adapter = (config: HarnessConfig, options: HarnessOptions): Run => {
  const mcp = options.mcpLauncher ?? defaultMcpLauncher()
  switch (config.kind) {
    case "claude-cli":
      return claudeCli({ command: config.command ?? "claude", env: options.env, mcp })
    case "codex-cli":
      return codexCli({ command: config.command ?? "codex", env: options.env, mcp })
    case "ai-sdk": {
      const binding = openRouterBinding(options.env, config.baseUrl)
      return binding instanceof HarnessError ? () => Effect.fail(binding) : aiSdk(binding)
    }
  }
}

/** Dispatches each request to the adapter of its profile's harness key. */
export const makeHarness = (harnesses: Config["harnesses"], options: HarnessOptions): HarnessShape => {
  const adapters = new Map(Object.entries(harnesses).map(([key, config]) => [key, adapter(config, options)]))
  return {
    run: (request) => {
      const run = adapters.get(request.slot.profile.harness)
      return run === undefined
        ? Effect.fail(new HarnessError({ kind: "vendor", detail: `no harness configured under "${request.slot.profile.harness}"` }))
        : run(request)
    }
  }
}

export const HarnessLive = (config: Pick<Config, "harnesses">, options: HarnessOptions) =>
  Layer.succeed(Harness)(makeHarness(config.harnesses, options))
