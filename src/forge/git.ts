import { Effect, Redacted, Stream } from "effect"
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process"
import type { Sha } from "../domain.ts"
import { ForgeError } from "../ports.ts"

export interface FetchCommit {
  readonly gitDir: string
  readonly url: string
  readonly commit: Sha
  /** Sent only to URLs under `prefix`, so a clone URL on another host never sees the token. */
  readonly authorization: { readonly prefix: string; readonly header: Redacted.Redacted<string> }
}

const lastLine = (text: string) => text.trim().split("\n").at(-1)?.slice(0, 200) ?? ""

/**
 * Fetches exactly one commit into a fresh bare repository. The credential travels in the child's
 * environment as git config, never on argv or in a file, and no credential helper or prompt can run.
 */
export const fetchCommit = Effect.fn("fetchCommit")(function*(input: FetchCommit) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
  const secret = Redacted.value(input.authorization.header)
  const env = {
    GIT_TERMINAL_PROMPT: "0",
    GIT_CONFIG_COUNT: "2",
    GIT_CONFIG_KEY_0: "credential.helper",
    GIT_CONFIG_VALUE_0: "",
    GIT_CONFIG_KEY_1: `http.${input.authorization.prefix}.extraHeader`,
    GIT_CONFIG_VALUE_1: secret
  }
  const git = (step: string, args: ReadonlyArray<string>) =>
    Effect.scoped(Effect.gen(function*() {
      const handle = yield* spawner.spawn(ChildProcess.make("git", args, { env, extendEnv: true, stdout: "ignore" }))
      const [stderr, code] = yield* Effect.all([Stream.mkString(Stream.decodeText(handle.stderr)), handle.exitCode], {
        concurrency: 2
      })
      if (code !== 0) {
        return yield* new ForgeError({
          operation: "checkout",
          detail: `git ${step} exited ${code}: ${lastLine(stderr.split(secret).join("[redacted]"))}`
        })
      }
    })).pipe(
      Effect.catchTag("PlatformError", (e) => Effect.fail(new ForgeError({ operation: "checkout", detail: `git ${step} could not run: ${e.reason._tag}` })))
    )

  yield* git("init", ["init", "--quiet", "--bare", input.gitDir])
  yield* git("fetch", [
    "--git-dir",
    input.gitDir,
    "fetch",
    "--quiet",
    "--no-tags",
    "--depth=1",
    input.url,
    `${input.commit}:refs/heron/head`
  ])
  yield* git("verify", ["--git-dir", input.gitDir, "cat-file", "-e", `${input.commit}^{commit}`])
})
