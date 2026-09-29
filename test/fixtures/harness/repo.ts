import { execFileSync } from "node:child_process"
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import type { Sha } from "../../../src/domain.ts"
import type { SourceCheckout } from "../../../src/ports.ts"

/** The base commit: what both branches start from. */
export const baseFiles: Readonly<Record<string, string>> = {
  "README.md": "# Demo\n",
  "AGENTS.md": "Every exported function needs a test.\n",
  "tsconfig.json": "{ \"compilerOptions\": { \"strict\": true, \"module\": \"nodenext\", \"target\": \"es2022\", \"noEmit\": true, \"allowImportingTsExtensions\": true }, \"include\": [\"src\"] }\n",
  "src/app.ts": "import { add } from \"./math.ts\"\n\nexport const total = add(1, 2)\n// TODO: remove debug\nconsole.log(\"Total\", total)\n",
  "src/math.ts": "export const add = (a: number, b: number) => a + b\n",
  "docs/guide.md": "Use add for sums.\n",
  "many.txt": Array.from({ length: 30 }, (_, i) => `hit ${i + 1}`).join("\n") + "\n"
}
/** The merge request: adds `sub` and a file with a type error. */
export const sourceChanges: Readonly<Record<string, string>> = {
  "src/math.ts": "export const add = (a: number, b: number) => a + b\nexport const sub = (a: number, b: number) => a - b\n",
  "src/broken.ts": "import { sub } from \"./math.ts\"\n\nexport const wrong: string = sub(3, 1)\n"
}
/** The target branch moved on after the merge request branched. */
export const targetChanges: Readonly<Record<string, string>> = {
  "src/target-only.ts": "export const onlyOnTarget = 1\n"
}

const env = (home: string) => ({
  PATH: process.env["PATH"] ?? "",
  GIT_CONFIG_NOSYSTEM: "1",
  HOME: home,
  GIT_AUTHOR_NAME: "t",
  GIT_AUTHOR_EMAIL: "t@example.invalid",
  GIT_COMMITTER_NAME: "t",
  GIT_COMMITTER_EMAIL: "t@example.invalid",
  GIT_AUTHOR_DATE: "2026-01-02T03:04:05Z",
  GIT_COMMITTER_DATE: "2026-01-02T03:04:05Z"
})

export const git = (cwd: string, ...args: Array<string>) => execFileSync("git", args, { cwd, encoding: "utf8", env: env(cwd) }).trim()

const write = (dir: string, files: Readonly<Record<string, string>>) => {
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true })
    writeFileSync(join(dir, path), content)
  }
}

/** A working repository with base, target (main) and source (feature) commits; returns the three ids. */
export const makeWork = (work: string) => {
  mkdirSync(work, { recursive: true })
  write(work, baseFiles)
  git(work, "init", "-q", "-b", "main")
  git(work, "add", ".")
  git(work, "commit", "-q", "-m", "base")
  const base = git(work, "rev-parse", "HEAD") as Sha
  git(work, "checkout", "-q", "-b", "feature")
  write(work, sourceChanges)
  git(work, "add", ".")
  git(work, "commit", "-q", "-m", "add sub")
  const source = git(work, "rev-parse", "HEAD") as Sha
  // A later commit that must stay invisible to tools pinned at `source`.
  writeFileSync(join(work, "late.txt"), "hit late\n")
  git(work, "add", ".")
  git(work, "commit", "-q", "-m", "late")
  git(work, "checkout", "-q", "main")
  write(work, targetChanges)
  git(work, "add", ".")
  git(work, "commit", "-q", "-m", "target moves on")
  const target = git(work, "rev-parse", "HEAD") as Sha
  return { base, source, target }
}

/** A bare repository with the three commits and one working tree each; `cleanup` removes it. */
export const makeRepo = () => {
  const root = mkdtempSync(join(tmpdir(), "heron-test-"))
  const commits = makeWork(join(root, "work"))
  git(root, "clone", "-q", "--bare", join(root, "work"), "repo.git")
  const gitDir = join(root, "repo.git")
  const trees = { source: join(root, "source"), target: join(root, "target"), base: join(root, "base") }
  for (const [ref, dir] of Object.entries(trees)) {
    mkdirSync(dir)
    git(root, "--git-dir", gitDir, "--work-tree", dir, "checkout", "-q", commits[ref as keyof typeof commits], "--", ".")
  }
  const source: SourceCheckout = { gitDir, commits, trees }
  return { root, source, cleanup: () => rmSync(root, { recursive: true, force: true }) }
}

export interface Captured {
  readonly argv: ReadonlyArray<string>
  readonly env: Readonly<Record<string, string>>
  readonly stdin: string
  readonly files: Readonly<Record<string, string>>
  /** The fake's own pid and, when it hangs, the grandchild it started. */
  readonly pids: ReadonlyArray<number>
}

/**
 * A fake vendor executable: records argv, env, stdin and the content of every file argument, prints a recorded
 * event stream, and exits with `code` (`hang` sleeps instead). `mcp list` prints the `mcpList` fixture (Codex's
 * `mcp list --json`) or an empty list.
 */
export const fakeCli = (root: string, fixture: string, code: number | "hang" = 0, mcpList: string | null = null) => {
  const capture = join(root, `capture-${Math.random().toString(36).slice(2)}.json`)
  const bin = join(root, `fake-${Math.random().toString(36).slice(2)}`)
  const script = join(import.meta.dirname, "fake-cli.mjs")
  writeFileSync(bin, `#!/bin/sh\nexec "${process.execPath}" "${script}" "${capture}" "${join(import.meta.dirname, fixture)}" "${code}" "${mcpList === null ? "-" : join(import.meta.dirname, mcpList)}" "$@"\n`)
  chmodSync(bin, 0o755)
  return { bin, capture }
}
