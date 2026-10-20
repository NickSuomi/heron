#!/usr/bin/env node
// Stands in for git in forge-gitlab.test.ts, which copies it into a directory and links `git` to it. It appends its
// arguments and environment to calls.jsonl beside it, then runs the real git whose path real-git holds.
import { spawnSync } from "node:child_process"
import { appendFileSync, readFileSync } from "node:fs"
import { join } from "node:path"

const args: ReadonlyArray<string> = process.argv.slice(2)
appendFileSync(join(import.meta.dirname, "calls.jsonl"), JSON.stringify({ args, env: process.env }) + "\n")
const git = spawnSync(readFileSync(join(import.meta.dirname, "real-git"), "utf8"), args, { stdio: "inherit" })
process.exit(git.status ?? 1)
