#!/usr/bin/env node
// Fails when a commit in the given range would publish a personal or company identity: an author or committer email
// that is not a GitHub noreply address, a Signed-off-by trailer, or any email address in the message that is not one.
// Usage: node scripts/check-commit-metadata.mjs <from>..<to>   (or a single commit)
import { execFileSync } from "node:child_process"

const range = process.argv[2]
if (range === undefined) {
  console.error("usage: check-commit-metadata.mjs <from>..<to>")
  process.exit(2)
}
const NOREPLY = /^(\d+\+)?[A-Za-z0-9-]+@users\.noreply\.github\.com$|^noreply@github\.com$/
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g
const args = range.includes("..") ? ["log", "--format=%H%x00%ae%x00%ce%x00%B%x1e", range] : ["log", "-1", "--format=%H%x00%ae%x00%ce%x00%B%x1e", range]
const out = execFileSync("git", args, { encoding: "utf8" })
const problems = []
for (const record of out.split("\x1e").map((r) => r.trim()).filter((r) => r !== "")) {
  const [sha, author, committer, message] = record.split("\x00")
  const short = sha.slice(0, 7)
  if (!NOREPLY.test(author)) problems.push(`${short}: author email is not a GitHub noreply address`)
  if (!NOREPLY.test(committer)) problems.push(`${short}: committer email is not a GitHub noreply address`)
  if (/^\s*>?\s*Signed-off-by:/im.test(message)) problems.push(`${short}: the message has a Signed-off-by trailer`)
  const foreign = (message.match(EMAIL) ?? []).filter((e) => !NOREPLY.test(e))
  if (foreign.length > 0) problems.push(`${short}: the message contains an email address that is not a GitHub noreply address`)
}
// The addresses themselves are not printed, so a failing log does not repeat them.
for (const p of problems) console.error(p)
process.exit(problems.length === 0 ? 0 : 1)
