import { execFileSync, spawnSync } from "node:child_process"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { afterAll, describe, expect, it } from "@effect/vitest"

const script = resolve("scripts/check-commit-metadata.mjs")
const dirs: Array<string> = []
afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })))

/** A repository with one commit by `email` whose message is `message`. */
const repoWith = (email: string, message: string) => {
  const dir = mkdtempSync(join(tmpdir(), "heron-metadata-"))
  dirs.push(dir)
  const git = (...args: Array<string>) =>
    execFileSync("git", args, { cwd: dir, env: { ...process.env, GIT_AUTHOR_NAME: "a", GIT_AUTHOR_EMAIL: email, GIT_COMMITTER_NAME: "a", GIT_COMMITTER_EMAIL: email } })
  git("init", "-q")
  writeFileSync(join(dir, "f"), "x")
  git("add", "f")
  git("commit", "-q", "-m", message)
  return dir
}
const check = (dir: string) => spawnSync("node", [script, "HEAD"], { cwd: dir, encoding: "utf8" })

describe("check-commit-metadata", () => {
  it("passes a commit by a GitHub noreply address", () => {
    expect(check(repoWith("123+owner@users.noreply.github.com", "fix: something")).status).toBe(0)
  })

  it.each([
    ["an author email that is not a GitHub noreply address", "dev@acme.example", "fix: something"],
    ["a Signed-off-by trailer", "123+owner@users.noreply.github.com", "fix: something\n\n> Signed-off-by: Owner <owner@users.noreply.gitlab.example.com>"],
    ["another email in the message", "123+owner@users.noreply.github.com", "fix: something\n\nreported by dev@acme.example"]
  ])("fails a commit with %s, without printing the address", (_, email, message) => {
    const result = check(repoWith(email, message))
    expect(result.status).toBe(1)
    expect(result.stderr).not.toContain("acme.example")
    expect(result.stderr).not.toContain("gitlab.example.com")
  })
})
