import { spawn } from "node:child_process"
import { Data, Effect } from "effect"

/** A tool failure the model may read; never carries a host path. */
export class SourceError extends Data.TaggedError("SourceError")<{ readonly message: string }> {}

export const fail = (message: string) => new SourceError({ message })

/**
 * The whole environment of a tool process. No credential, no operator config: git reads no system or global config,
 * and HOME does not exist, so nothing the host user configured can change what a tool does.
 */
export const toolEnv = (): Record<string, string> => ({
  PATH: process.env["PATH"] ?? "/usr/bin:/bin",
  HOME: "/nonexistent",
  LC_ALL: "C",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_TERMINAL_PROMPT: "0"
})

export interface ToolOutput {
  readonly stdout: string
  readonly stderr: string
  readonly code: number | null
}

const STDERR_CHARS = 4096

/** Runs one read-only helper to completion and keeps all of its stdout; interruption kills it. */
export const runTool = (command: string, args: ReadonlyArray<string>, cwd?: string) =>
  Effect.callback<ToolOutput, SourceError>((resume, signal) => {
    const child = spawn(command, [...args], { cwd, stdio: ["ignore", "pipe", "pipe"], env: toolEnv() })
    const chunks: Array<string> = []
    let stderr = ""
    const stop = () => child.kill("SIGKILL")
    signal.addEventListener("abort", stop)
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => chunks.push(chunk))
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
      if (stderr.length < STDERR_CHARS) stderr += chunk
    })
    child.on("error", () => resume(Effect.fail(fail(`${command.split("/").at(-1)} is not available`))))
    child.on("close", (code) => {
      signal.removeEventListener("abort", stop)
      resume(Effect.succeed({ stdout: chunks.join(""), stderr, code }))
    })
  })

/** Output split into lines without the empty string after a trailing newline. */
export const linesOf = (text: string): Array<string> => {
  if (text === "") return []
  const lines = text.split("\n")
  if (lines.at(-1) === "") lines.pop()
  return lines
}

export interface Page<A> {
  /** How many results exist in total. */
  readonly total: number
  readonly offset: number
  /** The offset of the next page; null when this page reaches the end. */
  readonly next: number | null
  readonly items: ReadonlyArray<A>
}

export const page = <A>(all: ReadonlyArray<A>, offset: number, limit: number): Page<A> => {
  const items = all.slice(offset, offset + limit)
  const end = offset + items.length
  return { total: all.length, offset, next: end < all.length ? end : null, items }
}
