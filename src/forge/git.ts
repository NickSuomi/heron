import { chmod, lstat, mkdir, readdir } from "node:fs/promises"
import { join } from "node:path"
import { Effect, Redacted, Stream } from "effect"
import { ChildProcess, ChildProcessSpawner } from "effect/process"
import type { Sha } from "../domain.ts"
import { ForgeError } from "../ports.ts"

export interface FetchCommits {
  readonly gitDir: string
  readonly url: string
  /** Fetched with their full history, so log and blame see every commit. */
  readonly commits: ReadonlyArray<Sha>
  /** Sent only to URLs under `prefix`, so a clone URL on another host never sees the token. */
  readonly authorization: { readonly prefix: string; readonly header: Redacted.Redacted<string> }
}

/** What git needs from the host to reach a remote through a proxy or a private CA; nothing else is inherited. */
const INHERITED = [
  "PATH", "HTTP_PROXY", "HTTPS_PROXY", "NO_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "no_proxy", "all_proxy",
  "GIT_SSL_CAINFO", "GIT_SSL_CAPATH", "SSL_CERT_FILE", "SSL_CERT_DIR", "CURL_CA_BUNDLE"
]

const lastLine = (text: string) => text.trim().split("\n").at(-1)?.slice(0, 200) ?? ""

const baseEnv = () => ({
  ...Object.fromEntries(INHERITED.flatMap((name) => process.env[name] ? [[name, process.env[name]]] : [])),
  HOME: "/nonexistent",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_TERMINAL_PROMPT: "0"
})

const runGit = (env: Record<string, string>, secret: string | null) => (step: string, args: ReadonlyArray<string>) =>
  Effect.gen(function*() {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
    yield* Effect.scoped(Effect.gen(function*() {
      const handle = yield* spawner.spawn(ChildProcess.make("git", args, { env, extendEnv: false, stdout: "ignore" }))
      const [stderr, code] = yield* Effect.all([Stream.mkString(Stream.decodeText(handle.stderr)), handle.exitCode], {
        concurrency: 2
      })
      if (code !== 0) {
        const text = secret === null ? stderr : stderr.split(secret).join("[redacted]")
        return yield* new ForgeError({ operation: "checkout", detail: `git ${step} exited ${code}: ${lastLine(text)}` })
      }
    })).pipe(
      Effect.catchTag("PlatformError", (e) => Effect.fail(new ForgeError({ operation: "checkout", detail: `git ${step} could not run: ${e.reason._tag}` })))
    )
  })

/**
 * Fetches the commits with their history into a fresh bare repository. The credential travels in the child's
 * environment as git config, never on argv or in a file, and no credential helper or prompt can run. The child sees no
 * other host secret and no operator git config or `.netrc`.
 */
export const fetchCommits = Effect.fn("fetchCommits")(function*(input: FetchCommits) {
  const secret = Redacted.value(input.authorization.header)
  const git = runGit({
    ...baseEnv(),
    GIT_CONFIG_COUNT: "2",
    GIT_CONFIG_KEY_0: "credential.helper",
    GIT_CONFIG_VALUE_0: "",
    GIT_CONFIG_KEY_1: `http.${input.authorization.prefix}.extraHeader`,
    GIT_CONFIG_VALUE_1: secret
  }, secret)
  const unique = [...new Set(input.commits)]
  yield* git("init", ["init", "--quiet", "--bare", input.gitDir])
  yield* git("fetch", [
    "--git-dir", input.gitDir, "fetch", "--quiet", "--no-tags", input.url,
    ...unique.map((c, i) => `${c}:refs/heron/c${i}`)
  ])
  for (const commit of unique) yield* git("verify", ["--git-dir", input.gitDir, "cat-file", "-e", `${commit}^{commit}`])
})

/** Removes write permission from every file and directory under `dir`, children before their parent. */
const freeze = async (dir: string): Promise<void> => {
  for (const entry of await readdir(dir)) {
    const path = join(dir, entry)
    const stat = await lstat(path)
    if (stat.isDirectory()) await freeze(path)
    else await chmod(path, stat.mode & ~0o222)
  }
  await chmod(dir, (await lstat(dir)).mode & ~0o222)
}

/** Gives the owner write permission back so the tree can be removed. */
export const thaw = async (dir: string): Promise<void> => {
  let stat
  try {
    stat = await lstat(dir)
  } catch {
    return
  }
  if (!stat.isDirectory()) return
  await chmod(dir, stat.mode | 0o200)
  for (const entry of await readdir(dir)) await thaw(join(dir, entry))
}

/**
 * Writes the files of `commit` into `dir` and makes them read-only. It runs no hook, filter or fsmonitor, and a
 * symbolic link in the repository becomes a plain file holding its target, so no path in the tree leads outside it.
 * The index lives next to the tree, never inside it.
 */
export const materialize = Effect.fn("materialize")(function*(gitDir: string, commit: Sha, dir: string, index: string) {
  const git = runGit({ ...baseEnv(), GIT_INDEX_FILE: index }, null)
  const flags = ["--git-dir", gitDir, "-c", "core.symlinks=false", "-c", "core.hooksPath=/dev/null", "-c", "core.fsmonitor=false"]
  yield* Effect.tryPromise({
    try: () => mkdir(dir),
    catch: () => new ForgeError({ operation: "checkout", detail: "cannot create a working tree directory" })
  })
  yield* git("read-tree", [...flags, "read-tree", commit])
  yield* git("checkout-index", [...flags, "-c", "core.bare=false", "--work-tree", dir, "checkout-index", "--all", "--force", `--prefix=${dir}/`])
  yield* Effect.tryPromise({
    try: () => freeze(dir),
    catch: () => new ForgeError({ operation: "checkout", detail: "cannot make the working tree read-only" })
  })
})
