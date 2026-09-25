import { mkdir, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { Effect } from "effect"
import type { Env } from "../config.ts"
import type { Usage } from "../domain.ts"
import { HarnessError, type HarnessRequest, type HarnessResult } from "../ports.ts"
import { type Launcher, MCP_SERVER_NAME, mcpSourceCommand } from "./mcpSource.ts"
import { childEnv, clip, isRecord, num, redactor, runJsonLines, str, tempDir } from "./process.ts"

export interface ClaudeCliOptions {
  /** The operator's Claude Code binary; Heron never logs it in. */
  readonly command: string
  readonly env: Env
  readonly mcp: Launcher
}

const SECRETS = ["CLAUDE_CODE_OAUTH_TOKEN", "ANTHROPIC_API_KEY"]
/** CLAUDE_CONFIG_DIR locates an operator login kept outside HOME. */
const ALLOWED = ["PATH", "HOME", "LANG", "CLAUDE_CONFIG_DIR", ...SECRETS]

const TOOL_PREFIX = `mcp__${MCP_SERVER_NAME}__`
/** Claude Code delivers `--json-schema` output through this built-in tool. */
const STRUCTURED_OUTPUT_TOOL = "StructuredOutput"

/** Flags verified against `claude --help` of Claude Code 2.1.281 and code.claude.com/docs/en/cli-reference. */
export const claudeArgs = (request: HarnessRequest, files: { readonly systemPrompt: string; readonly mcpConfig: string | null }) => [
  "-p",
  "--output-format", "stream-json",
  "--verbose",
  "--json-schema", JSON.stringify(request.outputSchema),
  "--model", request.slot.profile.model,
  "--effort", request.slot.profile.effort,
  "--system-prompt-file", files.systemPrompt,
  "--tools", "",
  "--strict-mcp-config",
  ...(files.mcpConfig === null ? [] : ["--mcp-config", files.mcpConfig, "--allowedTools", `mcp__${MCP_SERVER_NAME}`]),
  "--permission-mode", "dontAsk",
  "--permission-prompts", "none",
  "--setting-sources", "",
  "--no-session-persistence",
  "--max-turns", String(request.maxTurns)
]

/** Error categories Claude Code puts on assistant and `system/api_retry` events. */
const errorKind = (category: string): HarnessError["kind"] =>
  ["authentication_failed", "oauth_org_not_allowed", "account_on_hold"].includes(category)
    ? "auth"
    : ["rate_limit", "billing_error"].includes(category)
    ? "quota"
    : "vendor"

const usageOf = (result: Record<string, unknown>): Usage => {
  const u = isRecord(result["usage"]) ? result["usage"] : {}
  const fresh = num(u["input_tokens"])
  const cacheRead = num(u["cache_read_input_tokens"])
  const cacheWrite = num(u["cache_creation_input_tokens"])
  const details = isRecord(u["output_tokens_details"]) ? u["output_tokens_details"] : {}
  return {
    inputTokens: fresh === null ? null : fresh + (cacheRead ?? 0) + (cacheWrite ?? 0),
    cachedInputTokens: cacheRead,
    outputTokens: num(u["output_tokens"]),
    reasoningTokens: num(details["thinking_tokens"]),
    costUsd: num(result["total_cost_usd"])
  }
}

/** Folds a Claude Code stream-json transcript into a result, or the first reason it cannot be one. */
export const foldClaudeEvents = (
  events: ReadonlyArray<unknown>,
  redact: (text: string) => string
): HarnessResult | HarnessError => {
  let initModel: string | null = null
  let apiModel: string | null = null
  let sessionId: string | null = null
  let toolCalls = 0
  const failures: Array<HarnessError> = []
  let result: Record<string, unknown> | null = null
  const note = (e: HarnessError) => failures.push(e)

  for (const event of events) {
    if (!isRecord(event)) continue
    const type = event["type"]
    if (type === "system" && event["subtype"] === "init") {
      initModel = str(event["model"])
      sessionId = str(event["session_id"])
      const servers = Array.isArray(event["mcp_servers"]) ? event["mcp_servers"].filter(isRecord) : []
      const heron = servers.find((s) => s["name"] === MCP_SERVER_NAME)
      if (heron !== undefined && heron["status"] !== "connected") {
        note(new HarnessError({ kind: "vendor", detail: `the source tool server did not connect (${String(heron["status"])})` }))
      }
    } else if (type === "assistant" && isRecord(event["message"])) {
      const message = event["message"]
      const model = str(message["model"])
      if (apiModel === null && model !== null && !model.startsWith("<")) apiModel = model
      const error = str(event["error"])
      if (error !== null) note(new HarnessError({ kind: errorKind(error), detail: `Claude Code reported ${error}` }))
      for (const block of Array.isArray(message["content"]) ? message["content"].filter(isRecord) : []) {
        if (block["type"] !== "tool_use") continue
        const name = str(block["name"]) ?? ""
        if (name.startsWith(TOOL_PREFIX)) toolCalls++
        else if (name !== STRUCTURED_OUTPUT_TOOL) note(new HarnessError({ kind: "tool-violation", detail: `model called ${name}` }))
      }
    } else if (type === "system" && event["subtype"] === "api_retry") {
      const error = str(event["error"])
      if (error !== null && errorKind(error) !== "vendor") note(new HarnessError({ kind: errorKind(error), detail: `Claude Code reported ${error}` }))
    } else if (type === "result") {
      result = event
    }
  }

  const failure = failures[0] ?? null
  if (result === null) return failure ?? new HarnessError({ kind: "no-output", detail: "Claude Code ended without a result event" })
  const denials = Array.isArray(result["permission_denials"]) ? result["permission_denials"].filter(isRecord) : []
  if (denials.length > 0) {
    return new HarnessError({ kind: "tool-violation", detail: `denied tool calls: ${denials.map((d) => str(d["tool_name"]) ?? "?").join(", ")}` })
  }
  if (result["is_error"] === true || result["subtype"] !== "success") {
    if (failure !== null) return failure
    const subtype = str(result["subtype"]) ?? "error"
    const text = clip(redact(str(result["result"]) ?? ""))
    if (subtype === "error_max_turns") return new HarnessError({ kind: "no-output", detail: "reached the turn limit before answering" })
    if (subtype === "error_max_structured_output_retries") return new HarnessError({ kind: "no-output", detail: "could not produce output matching the schema" })
    const status = num(result["api_error_status"])
    const kind = status === 401 || status === 403 ? "auth" : status === 429 ? "quota" : "vendor"
    return new HarnessError({ kind, detail: `${subtype}${text === "" ? "" : `: ${text}`}` })
  }
  if (failure !== null && failure.kind === "tool-violation") return failure
  if (!("structured_output" in result) || result["structured_output"] === undefined) {
    return new HarnessError({ kind: "no-output", detail: "the result carried no structured output" })
  }
  return {
    output: result["structured_output"],
    reportedModel: apiModel ?? initModel,
    vendorSessionId: str(result["session_id"]) ?? sessionId,
    usage: usageOf(result),
    toolCalls
  }
}

export const claudeCli = (options: ClaudeCliOptions) => (request: HarnessRequest) =>
  Effect.scoped(Effect.gen(function*() {
    const dir = yield* tempDir
    const cwd = join(dir, "cwd")
    const systemPrompt = join(dir, "system-prompt.md")
    const mcpConfig = request.source === null ? null : join(dir, "mcp.json")
    yield* Effect.promise(async () => {
      await mkdir(cwd)
      await writeFile(systemPrompt, request.instructions)
      if (mcpConfig !== null && request.source !== null) {
        const server = mcpSourceCommand(options.mcp, request.source)
        const config = { mcpServers: { [MCP_SERVER_NAME]: { type: "stdio", command: server.command, args: server.args, env: {} } } }
        await writeFile(mcpConfig, JSON.stringify(config))
      }
    })
    const env = childEnv(options.env, ALLOWED)
    const run = yield* runJsonLines(
      { command: options.command, args: claudeArgs(request, { systemPrompt, mcpConfig }), env, cwd, stdin: request.prompt },
      request.timeout
    )
    const redact = redactor(env, SECRETS)
    const folded = foldClaudeEvents(run.events, redact)
    if (folded instanceof HarnessError) {
      const vendorless = folded.kind === "no-output" && run.events.length === 0 && run.code !== 0
      return yield* vendorless
        ? new HarnessError({ kind: "vendor", detail: `claude exited ${run.code}: ${clip(redact(run.stderr.trim() || run.text.join(" ")))}` })
        : folded
    }
    return folded
  }))
