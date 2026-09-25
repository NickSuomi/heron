import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs"

const [capture, fixture, code, ...argv] = process.argv.slice(2)
const stdin = readFileSync(0, "utf8")
const files = Object.fromEntries(argv.filter((a) => a.startsWith("/") && existsSync(a) && statSync(a).isFile()).map((a) => [a, readFileSync(a, "utf8")]))
writeFileSync(capture, JSON.stringify({ argv, env: process.env, stdin, files }))
if (code === "hang") setTimeout(() => {}, 60_000)
else {
  process.stdout.write(readFileSync(fixture, "utf8"))
  process.exitCode = Number(code)
}
