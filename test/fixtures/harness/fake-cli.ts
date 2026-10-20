#!/usr/bin/env node
// A fake vendor executable for the harness tests. fakeCli in repo.ts copies it into a directory of its own, beside a
// fake-cli.json that names the capture file, the recorded event stream to print, the exit code and the `mcp list` answer.
import { spawn } from "node:child_process"
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { join } from "node:path"

interface Settings {
  readonly capture: string
  readonly fixture: string
  readonly code: number | "hang"
  readonly mcpList: string | null
  readonly hangOutput: string | null
}

const { capture, fixture, code, mcpList, hangOutput }: Settings = JSON.parse(readFileSync(join(import.meta.dirname, "fake-cli.json"), "utf8"))
const argv = process.argv.slice(2)
if (argv[0] === "mcp" && argv[1] === "list") {
  process.stdout.write(mcpList === null ? "[]\n" : readFileSync(mcpList, "utf8"))
} else {
  const stdin = readFileSync(0, "utf8")
  const isFile = (a: string) => a.startsWith("/") && existsSync(a) && statSync(a).isFile()
  const files: Record<string, string> = Object.fromEntries(argv.filter(isFile).map((a) => [a, readFileSync(a, "utf8")]))
  // A file the MCP server command names, inside a `-c` value or the MCP config, is read before the session dir is gone.
  for (const text of [...argv, ...Object.values(files)]) {
    for (const [, path] of text.matchAll(/"--discussions",\s*"([^"]+)"/g)) if (path !== undefined && isFile(path)) files[path] = readFileSync(path, "utf8")
  }
  // A hanging vendor starts a grandchild in its process group, the way a CLI starts its MCP server.
  const pids = code === "hang" ? [process.pid, spawn("sleep", ["60"], { stdio: "ignore" }).pid] : [process.pid]
  writeFileSync(capture, JSON.stringify({ argv, env: process.env, stdin, files, pids }))
  if (code === "hang") {
    if (hangOutput !== null) process.stdout.write(hangOutput)
    setTimeout(() => {}, 60_000)
  } else {
    process.stdout.write(readFileSync(fixture, "utf8"))
    if (existsSync(`${fixture}.stderr`)) process.stderr.write(readFileSync(`${fixture}.stderr`, "utf8"))
    process.exitCode = code
  }
}
