import { mkdir, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { Effect } from "effect"
import type { Env } from "../config.ts"
import { HarnessError, type HarnessRequest, type HarnessResult } from "../ports.ts"
import { type Launcher, MCP_SERVER_NAME, mcpSourceCommand } from "./mcpSource.ts"
import { childEnv, clip, isRecord, num, redactor, runJsonLines, str, tempDir } from "./process.ts"
import { sourceToolNames } from "./sourceTools.ts"

export interface CodexCliOptions {
  /** The operator's Codex CLI; Heron never logs it in. */
  readonly command: string
  readonly env: Env
  readonly mcp: Launcher
}

const SECRETS = ["CODEX_API_KEY"]
/** CODEX_HOME holds the operator's auth.json; it must be persistent and have a single writer. */
const ALLOWED = ["PATH", "HOME", "LANG", "CODEX_HOME", ...SECRETS]

/** `-c` values are TOML; JSON strings and string arrays are valid TOML literals. */
const toml = (value: string | ReadonlyArray<string>) => JSON.stringify(value)

/**
 * Flags verified against `codex exec --help` of codex-cli 0.101.0; config keys against the Codex config reference
 * (features.shell_tool, features.unified_exec, web_search, approval_policy, tools.view_image, project_doc_max_bytes,
 * mcp_servers.<id>.{command,args,required,enabled_tools}). The prompt, instructions first, arrives on stdin (`-`).
 */
export const codexArgs = (
  request: HarnessRequest,
  files: { readonly schema: string; readonly cwd: string },
  server: Launcher | null
) => [
  "exec",
  "--json",
  "--output-schema", files.schema,
  "-m", request.slot.profile.model,
  "-c", `model_reasoning_effort=${toml(request.slot.profile.effort)}`,
  "--sandbox", "read-only",
  "--skip-git-repo-check",
  "--ephemeral",
  "-C", files.cwd,
  "-c", "features.shell_tool=false",
  "-c", "features.unified_exec=false",
  "-c", `web_search=${toml("disabled")}`,
  "-c", `approval_policy=${toml("never")}`,
  "-c", "tools.view_image=false",
  "-c", "project_doc_max_bytes=0",
  ...(server === null ? [] : [
    "-c", `mcp_servers.${MCP_SERVER_NAME}.command=${toml(server.command)}`,
    "-c", `mcp_servers.${MCP_SERVER_NAME}.args=${toml(server.args)}`,
    "-c", `mcp_servers.${MCP_SERVER_NAME}.required=true`,
    "-c", `mcp_servers.${MCP_SERVER_NAME}.enabled_tools=${toml(sourceToolNames)}`
  ]),
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
  const usage = { input: 0, cached: 0, output: 0, reasoning: 0 }

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
        usage.input += num(u["input_tokens"]) ?? 0
        usage.cached += num(u["cached_input_tokens"]) ?? 0
        usage.output += num(u["output_tokens"]) ?? 0
        usage.reasoning += num(u["reasoning_output_tokens"]) ?? 0
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

  if (violation !== null) return new HarnessError({ kind: "tool-violation", detail: violation })
  const reason = failure ?? (completed ? null : lastError)
  if (reason !== null) return new HarnessError({ kind: classify(reason), detail: clip(redact(reason)) })
  if (!completed) return new HarnessError({ kind: "no-output", detail: "Codex ended without completing the turn" })
  if (message === null) return new HarnessError({ kind: "no-output", detail: "Codex returned no final message" })
  let output: unknown
  try {
    output = JSON.parse(message)
  } catch {
    return new HarnessError({ kind: "no-output", detail: "the final message is not JSON" })
  }
  return {
    output,
    reportedModel: null,
    vendorSessionId: threadId,
    usage: { inputTokens: usage.input, cachedInputTokens: usage.cached, outputTokens: usage.output, reasoningTokens: usage.reasoning, costUsd: null },
    toolCalls
  }
}

export const codexCli = (options: CodexCliOptions) => (request: HarnessRequest) =>
  Effect.scoped(Effect.gen(function*() {
    const dir = yield* tempDir
    const cwd = join(dir, "cwd")
    const schema = join(dir, "schema.json")
    yield* Effect.promise(async () => {
      await mkdir(cwd)
      await writeFile(schema, JSON.stringify(request.outputSchema))
    })
    const server = request.source === null ? null : mcpSourceCommand(options.mcp, request.source)
    const env = childEnv(options.env, ALLOWED)
    const run = yield* runJsonLines(
      { command: options.command, args: codexArgs(request, { schema, cwd }, server), env, cwd, stdin: `${request.instructions}\n\n${request.prompt}` },
      request.timeout
    )
    const redact = redactor(env, SECRETS)
    const folded = foldCodexEvents(run.events, redact)
    if (folded instanceof HarnessError) {
      return yield* run.events.length === 0 && run.code !== 0
        ? new HarnessError({ kind: classify(run.stderr), detail: `codex exited ${run.code}: ${clip(redact(run.stderr.trim() || run.text.join(" ")))}` })
        : folded
    }
    return folded
  }))
