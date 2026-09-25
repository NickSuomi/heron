import { spawn } from "node:child_process"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Effect } from "effect"
import type { Env } from "../config.ts"
import { HarnessError } from "../ports.ts"

/** Proxy and TLS variables a vendor CLI needs behind a corporate proxy; nothing else is inherited. */
const NETWORK_VARS = ["HTTP_PROXY", "HTTPS_PROXY", "NO_PROXY", "http_proxy", "https_proxy", "no_proxy", "NODE_EXTRA_CA_CERTS", "SSL_CERT_FILE", "SSL_CERT_DIR"]

/** Builds a child environment from an explicit allowlist; `GITLAB_TOKEN` can never appear because it is never listed. */
export const childEnv = (env: Env, names: ReadonlyArray<string>): Record<string, string> => {
  const out: Record<string, string> = {}
  for (const name of [...names, ...NETWORK_VARS]) {
    const value = env[name]
    if (value !== undefined && value !== "") out[name] = value
  }
  return out
}

/** Every secret value in the allowlisted env, for scrubbing vendor text before it lands in a HarnessError. */
export const redactor = (env: Record<string, string>, secretNames: ReadonlyArray<string>) => (text: string): string =>
  secretNames.reduce((t, name) => {
    const v = env[name]
    return v === undefined || v.length < 8 ? t : t.split(v).join("[redacted]")
  }, text)

export const clip = (text: string, max = 400) => (text.length > max ? `${text.slice(0, max)}...` : text)

/** A private temporary directory, removed when the scope closes. */
export const tempDir = Effect.acquireRelease(
  Effect.promise(() => mkdtemp(join(tmpdir(), "heron-"))),
  (dir) => Effect.promise(() => rm(dir, { recursive: true, force: true }))
)

export interface ProcessOutput {
  readonly stdout: string
  readonly stderr: string
  readonly code: number | null
}

export interface ProcessRun extends ProcessOutput {
  readonly events: ReadonlyArray<unknown>
  /** Non-JSON stdout lines, in order. */
  readonly text: ReadonlyArray<string>
}

export interface ProcessSpec {
  readonly command: string
  readonly args: ReadonlyArray<string>
  readonly env: Record<string, string>
  readonly cwd: string
  readonly stdin: string
}

const STDERR_CAP = 16 * 1024

/**
 * Runs a vendor CLI to completion. The child leads its own process group, so interruption (the session timeout in
 * `makeHarness`) kills it together with the MCP server it started.
 */
export const runProcess = (spec: ProcessSpec) =>
  Effect.callback<ProcessOutput, HarnessError>((resume, signal) => {
    const child = spawn(spec.command, [...spec.args], {
      cwd: spec.cwd,
      env: spec.env,
      stdio: ["pipe", "pipe", "pipe"],
      detached: true
    })
    const killGroup = () => {
      if (child.pid === undefined) return
      try {
        process.kill(-child.pid, "SIGKILL")
      } catch {
        // The group is already gone.
      }
    }
    signal.addEventListener("abort", killGroup)
    let stdout = ""
    let stderr = ""
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
      stdout += chunk
    })
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
      if (stderr.length < STDERR_CAP) stderr += chunk
    })
    child.stdin.on("error", () => {})
    child.stdin.end(spec.stdin)
    child.on("error", (e: NodeJS.ErrnoException) =>
      resume(Effect.fail(new HarnessError({ kind: "vendor", detail: e.code === "ENOENT" ? `${spec.command} not found on PATH` : `cannot start ${spec.command}` }))))
    child.on("close", (code) => {
      signal.removeEventListener("abort", killGroup)
      killGroup()
      resume(Effect.succeed({ stdout, stderr, code }))
    })
  })

/** Runs a vendor CLI that prints JSON lines on stdout. */
export const runJsonLines = (spec: ProcessSpec) =>
  Effect.map(runProcess(spec), (out): ProcessRun => {
    const events: Array<unknown> = []
    const text: Array<string> = []
    for (const line of out.stdout.split("\n")) {
      if (line.trim() === "") continue
      try {
        events.push(JSON.parse(line))
      } catch {
        text.push(line)
      }
    }
    return { ...out, events, text }
  })

export const isRecord = (u: unknown): u is Record<string, unknown> => typeof u === "object" && u !== null && !Array.isArray(u)
export const num = (u: unknown): number | null => (typeof u === "number" && Number.isFinite(u) ? u : null)
export const str = (u: unknown): string | null => (typeof u === "string" ? u : null)
