import { mkdir, readFile, readdir, unlink, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import { basename, join } from "node:path"
import { Effect, Option, Schema } from "effect"
import type { Env } from "../config.ts"
import type { CodexSubscription, LimitWindow } from "../domain.ts"
import { HarnessError, type HarnessRequest, type HarnessResult } from "../ports.ts"
import { discussionsFile, type Launcher, MCP_SERVER_NAME, mcpSourceCommand } from "./mcpSource.ts"
import { childEnv, clip, isRecord, num, redactor, runJsonLines, runProcess, str, tempDir } from "./process.ts"
import { sourceToolNames } from "./sourceTools.ts"

export interface CodexCliOptions {
  /** The operator's Codex CLI; Heron never logs it in. */
  readonly command: string
  readonly env: Env
  readonly mcp: Launcher
}

const SECRETS = ["CODEX_API_KEY"]
/** CODEX_HOME holds the operator's auth.json; it must be persistent and have a single writer. */
export const CODEX_CREDENTIALS = [...SECRETS, "CODEX_HOME"]
const ALLOWED = ["PATH", "HOME", "LANG", ...CODEX_CREDENTIALS]

const TOOL_OUTPUT_TOKENS = 1_000_000
/** Codex waits 60 s for an MCP tool by default; a first language-server call on a large repository can take longer. */
const TOOL_TIMEOUT_SECONDS = 86_400

/** `-c` values are TOML; JSON strings and string arrays are valid TOML literals. */
const toml = (value: string | ReadonlyArray<string>) => JSON.stringify(value)

/**
 * Flags verified against `codex exec --help` of codex-cli 0.101.0; config keys against the Codex config reference
 * (features.shell_tool, features.unified_exec, web_search, approval_policy, tools.view_image, project_doc_max_bytes,
 * mcp_servers.<id>.{command,args,required,enabled_tools,tool_timeout_sec}); tool_output_token_limit is a key the 0.101.0
 * binary contains. The prompt, instructions first, arrives on stdin (`-`). Codex keeps no shell: a shell could read its
 * own auth file, so the model reads only through Heron's tools.
 */
export const codexArgs = (
  request: HarnessRequest,
  files: { readonly schema: string; readonly cwd: string },
  server: Launcher,
  operatorServers: ReadonlyArray<string>
) => [
  "exec",
  "--json",
  "--output-schema", files.schema,
  "-m", request.slot.profile.model,
  "-c", `model_reasoning_effort=${toml(request.slot.profile.effort)}`,
  "--sandbox", "read-only",
  "--skip-git-repo-check",
  "-C", files.cwd,
  "-c", "features.shell_tool=false",
  "-c", "features.unified_exec=false",
  "-c", `web_search=${toml("disabled")}`,
  "-c", `approval_policy=${toml("never")}`,
  "-c", "tools.view_image=false",
  "-c", "project_doc_max_bytes=0",
  // Codex's own caps on a tool result, raised so they never cut a Heron tool short; Heron's tools page large results.
  "-c", `tool_output_token_limit=${TOOL_OUTPUT_TOKENS}`,
  "-c", `mcp_servers.${MCP_SERVER_NAME}.command=${toml(server.command)}`,
  "-c", `mcp_servers.${MCP_SERVER_NAME}.args=${toml(server.args)}`,
  "-c", `mcp_servers.${MCP_SERVER_NAME}.required=true`,
  "-c", `mcp_servers.${MCP_SERVER_NAME}.tool_timeout_sec=${TOOL_TIMEOUT_SECONDS}`,
  "-c", `mcp_servers.${MCP_SERVER_NAME}.enabled_tools=${toml(sourceToolNames)}`,
  ...operatorServers.flatMap((name) => ["-c", `mcp_servers.${name}.enabled=false`]),
  "-"
]

const classify = (message: string): HarnessError["kind"] =>
  /\b(401|403)\b|unauthori[sz]ed|not logged in|log ?in again|refresh token/i.test(message)
    ? "auth"
    : /\b429\b|quota|usage limit|rate limit/i.test(message)
    ? "quota"
    : "vendor"

/** Item types that mean the model ran something other than the Heron source tools. */
const FORBIDDEN_ITEMS = new Set(["command_execution", "file_change", "web_search"])

export const foldCodexEvents = (events: ReadonlyArray<unknown>, redact: (text: string) => string): HarnessResult | HarnessError => {
  let threadId: string | null = null
  let message: string | null = null
  let toolCalls = 0
  let completed = false
  let violation: string | null = null
  let failure: string | null = null
  let lastError: string | null = null
  const usage: Record<"input" | "cached" | "output" | "reasoning", number | null> = { input: null, cached: null, output: null, reasoning: null }
  const add = (previous: number | null, value: unknown) => {
    const parsed = num(value)
    return parsed === null ? previous : (previous ?? 0) + parsed
  }

  for (const event of events) {
    if (!isRecord(event)) continue
    switch (event["type"]) {
      case "thread.started":
        threadId = str(event["thread_id"])
        break
      case "item.completed": {
        const item = isRecord(event["item"]) ? event["item"] : {}
        const type = str(item["type"]) ?? ""
        if (type === "agent_message") message = str(item["text"])
        else if (type === "mcp_tool_call") {
          if (item["server"] === MCP_SERVER_NAME) toolCalls++
          else violation ??= `model called ${String(item["server"])}/${String(item["tool"])}`
        } else if (FORBIDDEN_ITEMS.has(type)) violation ??= `model ran a ${type} item`
        break
      }
      case "turn.completed": {
        completed = true
        const u = isRecord(event["usage"]) ? event["usage"] : {}
        usage.input = add(usage.input, u["input_tokens"])
        usage.cached = add(usage.cached, u["cached_input_tokens"])
        usage.output = add(usage.output, u["output_tokens"])
        usage.reasoning = add(usage.reasoning, u["reasoning_output_tokens"])
        break
      }
      case "turn.failed": {
        const error = isRecord(event["error"]) ? event["error"] : {}
        failure = str(error["message"]) ?? "turn failed"
        break
      }
      case "error":
        lastError = str(event["message"])
        break
    }
  }

  const accounting = {
    reportedModel: null,
    vendorSessionId: threadId,
    usage: { inputTokens: usage.input, cachedInputTokens: usage.cached, outputTokens: usage.output, reasoningTokens: usage.reasoning, costUsd: null },
    toolCalls
  }
  const failed = (kind: HarnessError["kind"], detail: string) => new HarnessError({ kind, detail, accounting })
  if (violation !== null) return failed("tool-violation", violation)
  const reason = failure ?? (completed ? null : lastError)
  if (reason !== null) return failed(classify(reason), clip(redact(reason)))
  if (!completed) return failed("no-output", "Codex ended without completing the turn")
  if (message === null) return failed("no-output", "Codex returned no final message")
  let output: unknown
  try {
    output = JSON.parse(message)
  } catch {
    return failed("no-output", "the final message is not JSON")
  }
  return {
    output,
    ...accounting
  }
}

/** A name `-c mcp_servers.<name>.enabled=false` can address; Codex splits the key on every dot. */
const ADDRESSABLE = /^[A-Za-z0-9_-]+$/

const rolloutWindow = Schema.decodeUnknownOption(Schema.Struct({ used_percent: Schema.Finite, window_minutes: Schema.Finite, resets_at: Schema.Finite }))
const rolloutReading = Schema.decodeUnknownOption(Schema.Struct({
  timestamp: Schema.String,
  type: Schema.Literal("event_msg"),
  payload: Schema.Struct({
    type: Schema.Literal("token_count"),
    rate_limits: Schema.Struct({ primary: Schema.optionalKey(Schema.Unknown), secondary: Schema.optionalKey(Schema.Unknown) })
  })
}))

const rolloutSubscription = (home: string, threadId: string | null): Effect.Effect<CodexSubscription | null> =>
  threadId === null ? Effect.succeed(null) : Effect.tryPromise(async () => {
    const sessions = join(home, "sessions")
    const file = (await readdir(sessions, { recursive: true })).find((path) => basename(path).startsWith("rollout-") && path.endsWith(`-${threadId}.jsonl`))
    if (file === undefined) return null
    const path = join(sessions, file)
    try {
      let before: CodexSubscription["before"] | null = null
      let after: CodexSubscription["after"] | null = null
      for (const line of (await readFile(path, "utf8")).split("\n")) {
        let body: unknown
        try {
          body = JSON.parse(line)
        } catch {
          continue
        }
        const reading = rolloutReading(body)
        if (Option.isNone(reading)) continue
        const at = Date.parse(reading.value.timestamp)
        if (!Number.isFinite(at)) continue
        const limits = reading.value.payload.rate_limits
        const windows = [limits.primary, limits.secondary].flatMap((value): ReadonlyArray<LimitWindow> => {
          const parsed = rolloutWindow(value)
          if (Option.isNone(parsed)) return []
          const w = parsed.value
          const window = w.window_minutes === 300 ? "five-hour" : w.window_minutes === 10080 ? "weekly" : null
          const reset = new Date(w.resets_at * 1000)
          return window === null || !Number.isFinite(reset.getTime()) ? [] : [{ window, percent: w.used_percent, resetsAt: reset.toISOString() }]
        })
        if (windows.length === 0) continue
        const sample = { at, windows }
        before ??= sample
        after = sample
      }
      return before === null || after === null ? null : { before, after }
    } finally {
      await unlink(path)
    }
  }).pipe(Effect.orElseSucceed(() => null))

/**
 * `-c` merges into the operator's config.toml instead of replacing `mcp_servers`, and Codex has no flag to skip that
 * file, so every server it defines is listed first and switched off by name. A server already named like Heron's would
 * merge with it, so that name is refused.
 */
const operatorServers = (spec: { readonly command: string; readonly env: Record<string, string>; readonly cwd: string }) =>
  Effect.gen(function*() {
    const out = yield* runProcess({ ...spec, args: ["mcp", "list", "--json"], stdin: "" })
    let listed: unknown
    try {
      listed = JSON.parse(out.stdout)
    } catch {
      listed = null
    }
    if (out.code !== 0 || !Array.isArray(listed)) {
      return yield* new HarnessError({ kind: "vendor", detail: `codex mcp list failed (exit ${out.code})` })
    }
    const names = listed.filter(isRecord).map((s) => String(s["name"]))
    if (names.includes(MCP_SERVER_NAME)) {
      return yield* new HarnessError({
        kind: "vendor",
        detail: `the Codex config defines an MCP server named ${JSON.stringify(MCP_SERVER_NAME)}, which Heron reserves for its source tools; rename it in the Codex config`
      })
    }
    const bad = names.find((name) => !ADDRESSABLE.test(name))
    if (bad !== undefined) {
      return yield* new HarnessError({
        kind: "vendor",
        detail: `the Codex config defines MCP server ${JSON.stringify(bad)}, which cannot be disabled from the command line; use only letters, digits, - and _ in its name`
      })
    }
    return names
  })

export const codexCli = (options: CodexCliOptions) => (request: HarnessRequest) =>
  Effect.scoped(Effect.gen(function*() {
    const dir = yield* tempDir
    const cwd = join(dir, "cwd")
    const schema = join(dir, "schema.json")
    yield* Effect.promise(async () => {
      await mkdir(cwd)
      await writeFile(schema, JSON.stringify(request.outputSchema))
      await writeFile(discussionsFile(dir), JSON.stringify(request.discussions))
    })
    const server = mcpSourceCommand(options.mcp, request.source, discussionsFile(dir))
    const env = childEnv(options.env, ALLOWED)
    const disabled = yield* operatorServers({ command: options.command, env, cwd })
    const run = yield* runJsonLines(
      { command: options.command, args: codexArgs(request, { schema, cwd }, server, disabled), env, cwd, stdin: `${request.instructions}\n\n${request.prompt}` }
    )
    const redact = redactor(env, SECRETS)
    const folded = foldCodexEvents(run.events, redact)
    const threadId = folded instanceof HarnessError ? folded.accounting?.vendorSessionId ?? null : folded.vendorSessionId
    const codexSubscription = yield* rolloutSubscription(env["CODEX_HOME"] ?? join(env["HOME"] ?? homedir(), ".codex"), threadId)
    if (folded instanceof HarnessError) {
      const transport = /connection refused|ECONNREFUSED|error sending request|connect(?:ion)? (?:error|failed)|network error|TLS handshake/i.test(run.stderr)
      const incomplete = folded.kind === "no-output" && !run.events.some((e) => isRecord(e) && e["type"] === "turn.completed")
      const providerFailure = incomplete && run.code !== 0 && (run.events.length === 0 || transport || classify(run.stderr) !== "vendor")
      return yield* new HarnessError({
        kind: providerFailure ? classify(run.stderr) : folded.kind,
        detail: providerFailure ? `codex exited ${run.code}: ${clip(redact(run.stderr.trim() || run.text.join(" ")))}` : folded.detail,
        ...(folded.accounting === undefined ? {} : { accounting: { ...folded.accounting, codexSubscription } })
      })
    }
    return { ...folded, codexSubscription }
  }))
