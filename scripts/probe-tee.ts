#!/usr/bin/env node
// Runs the CLI that probe-tee.json beside it names, with this program's arguments, and copies the CLI's standard
// output to the transcript file it names. scripts/probe.ts copies this file next to that JSON for each probe run.
import { spawn } from "node:child_process"
import { appendFileSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

const { command, file }: { readonly command: string; readonly file: string } = JSON.parse(readFileSync(join(import.meta.dirname, "probe-tee.json"), "utf8"))
writeFileSync(file, "")
const cli = spawn(command, process.argv.slice(2), { stdio: ["inherit", "pipe", "inherit"] })
cli.stdout.on("data", (chunk: Buffer) => {
  process.stdout.write(chunk)
  appendFileSync(file, chunk)
})
cli.on("error", () => process.exit(127))
cli.on("close", (code) => process.exit(code ?? 1))
