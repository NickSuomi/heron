import { spawn } from "node:child_process"
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs"

const [capture, fixture, code, mcpList, ...argv] = process.argv.slice(2)
if (argv[0] === "mcp" && argv[1] === "list") {
  process.stdout.write(mcpList === "-" ? "[]\n" : readFileSync(mcpList, "utf8"))
} else {
  const stdin = readFileSync(0, "utf8")
  const files = Object.fromEntries(argv.filter((a) => a.startsWith("/") && existsSync(a) && statSync(a).isFile()).map((a) => [a, readFileSync(a, "utf8")]))
  // A hanging vendor starts a grandchild in its process group, the way a CLI starts its MCP server.
  const pids = code === "hang" ? [process.pid, spawn(process.execPath, ["-e", "setTimeout(() => {}, 60000)"], { stdio: "ignore" }).pid] : [process.pid]
  writeFileSync(capture, JSON.stringify({ argv, env: process.env, stdin, files, pids }))
  if (code === "hang") setTimeout(() => {}, 60_000)
  else {
    process.stdout.write(readFileSync(fixture, "utf8"))
    process.exitCode = Number(code)
  }
}
