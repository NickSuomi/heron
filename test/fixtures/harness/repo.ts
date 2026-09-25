import { execFileSync } from "node:child_process"
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import type { Sha } from "../../../src/domain.ts"
import type { SourceCheckout } from "../../../src/ports.ts"

export const files: Readonly<Record<string, string>> = {
  "README.md": "# Demo\n",
  "src/app.ts": "import { add } from \"./math.ts\"\n\nexport const total = add(1, 2)\n// TODO: remove debug\nconsole.log(\"Total\", total)\n",
  "src/math.ts": "export const add = (a: number, b: number) => a + b\nexport const sub = (a: number, b: number) => a - b\n",
  "docs/guide.md": "Use add for sums.\n",
  "many.txt": Array.from({ length: 30 }, (_, i) => `hit ${i + 1}`).join("\n") + "\n"
}

const git = (cwd: string, ...args: Array<string>) =>
  execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    env: { PATH: process.env["PATH"] ?? "", GIT_CONFIG_NOSYSTEM: "1", HOME: cwd, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@example.invalid", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@example.invalid" }
  }).trim()

/** A bare repository holding one commit of `files`; `cleanup` removes it. */
export const makeRepo = () => {
  const root = mkdtempSync(join(tmpdir(), "heron-test-"))
  const work = join(root, "work")
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(work, path)), { recursive: true })
    writeFileSync(join(work, path), content)
  }
  git(work, "init", "-q", "-b", "main")
  git(work, "add", ".")
  git(work, "commit", "-q", "-m", "init")
  // A later commit that must stay invisible to tools pinned at the first one.
  writeFileSync(join(work, "late.txt"), "hit late\n")
  const commit = git(work, "rev-parse", "HEAD") as Sha
  git(work, "add", ".")
  git(work, "commit", "-q", "-m", "late")
  git(root, "clone", "-q", "--bare", work, "repo.git")
  const source: SourceCheckout = { gitDir: join(root, "repo.git"), commit }
  return { root, source, cleanup: () => rmSync(root, { recursive: true, force: true }) }
}

export interface Captured {
  readonly argv: ReadonlyArray<string>
  readonly env: Readonly<Record<string, string>>
  readonly stdin: string
  readonly files: Readonly<Record<string, string>>
}

/**
 * A fake vendor executable: records argv, env, stdin and the content of every file argument, prints a recorded
 * event stream, and exits with `code` (`hang` sleeps instead).
 */
export const fakeCli = (root: string, fixture: string, code: number | "hang" = 0) => {
  const capture = join(root, `capture-${Math.random().toString(36).slice(2)}.json`)
  const bin = join(root, `fake-${Math.random().toString(36).slice(2)}`)
  const script = join(import.meta.dirname, "fake-cli.mjs")
  writeFileSync(bin, `#!/bin/sh\nexec "${process.execPath}" "${script}" "${capture}" "${join(import.meta.dirname, fixture)}" "${code}" "$@"\n`)
  chmodSync(bin, 0o755)
  return { bin, capture }
}
