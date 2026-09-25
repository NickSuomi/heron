import { Config as EnvConfig, Duration, Effect, FileSystem, Layer, Redacted, Schema } from "effect"
import { HttpClient, HttpClientRequest } from "effect/unstable/http"
import { ChildProcessSpawner } from "effect/unstable/process"
import type { Config } from "../config.ts"
import { type Change, type MrRef, type MrSnapshot, NoteId, Sha } from "../domain.ts"
import { Forge, ForgeError, type ForgeShape, IncompleteSnapshot } from "../ports.ts"
import { parseMarker } from "../report.ts"
import { fetchCommit } from "./git.ts"

const User = Schema.Struct({ id: Schema.Int })
const Project = Schema.Struct({ http_url_to_repo: Schema.String })
const Label = Schema.Struct({ name: Schema.String })
const MergeRequest = Schema.Struct({
  iid: Schema.Int,
  title: Schema.String,
  description: Schema.NullOr(Schema.String),
  author: Schema.Struct({ username: Schema.String }),
  source_branch: Schema.String,
  target_branch: Schema.String,
  web_url: Schema.String,
  sha: Sha,
  labels: Schema.Array(Schema.String),
  /** A decimal string, "N+" when GitLab capped the diff, null while the diff is being prepared. */
  changes_count: Schema.NullOr(Schema.String)
})
const Version = Schema.Struct({
  state: Schema.String,
  head_commit_sha: Sha,
  base_commit_sha: Sha,
  start_commit_sha: Sha
})
const Diff = Schema.Struct({
  old_path: Schema.String,
  new_path: Schema.String,
  diff: Schema.String,
  new_file: Schema.Boolean,
  renamed_file: Schema.Boolean,
  deleted_file: Schema.Boolean,
  collapsed: Schema.optionalKey(Schema.Boolean),
  too_large: Schema.optionalKey(Schema.Boolean)
})
const Note = Schema.Struct({ id: NoteId, body: Schema.String, system: Schema.Boolean, author: Schema.Struct({ id: Schema.Int }) })

type Method = "GET" | "POST" | "PUT"
type Query = Readonly<Record<string, string>>

const MAX_PAGES = 100
const MAX_RETRY_AFTER_SECONDS = 60

const change = (d: typeof Diff.Type): Change => ({
  path: d.new_path,
  oldPath: d.renamed_file ? d.old_path : null,
  status: d.new_file ? "added" : d.deleted_file ? "deleted" : d.renamed_file ? "renamed" : "modified",
  diff: d.diff
})

/** Returns the reason the diff GitLab served is not the whole merge request, or null when it is. */
const incompleteness = (
  mr: typeof MergeRequest.Type,
  latest: typeof Version.Type | undefined,
  diffs: ReadonlyArray<typeof Diff.Type>
): string | null => {
  if (latest === undefined) return "GitLab lists no diff version"
  if (latest.head_commit_sha !== mr.sha) return `the latest diff version is at ${latest.head_commit_sha}, the merge request head is ${mr.sha}`
  if (latest.state === "overflow") return "GitLab truncated the diff (version state overflow)"
  if (mr.changes_count === null) return "GitLab has not finished preparing the diff"
  if (mr.changes_count.endsWith("+")) return `GitLab caps the diff at ${mr.changes_count} files`
  const cut = diffs.find((d) => d.collapsed === true || d.too_large === true)
  if (cut !== undefined) return `GitLab collapsed the diff of ${cut.new_path}`
  if (Number(mr.changes_count) !== diffs.length) return `GitLab reports ${mr.changes_count} changed files but served ${diffs.length}`
  return null
}

const errorText = (text: string): string => {
  try {
    const body = JSON.parse(text) as { message?: unknown; error?: unknown }
    const detail = body.message ?? body.error
    if (detail !== undefined) return typeof detail === "string" ? detail : JSON.stringify(detail)
  } catch {
    // not JSON; fall through to the raw text
  }
  return text
}

export const make = Effect.fn("GitLabForge.make")(function*(config: Config, token: Redacted.Redacted<string>) {
  const client = yield* HttpClient.HttpClient
  const fs = yield* FileSystem.FileSystem
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
  const root = config.forge.url.replace(/\/+$/, "")
  const secret = Redacted.value(token)
  const fail = (operation: string, detail: string) =>
    new ForgeError({ operation, detail: detail.split(secret).join("[redacted]").slice(0, 300) })

  const send = (operation: string, method: Method, path: string, query: Query, body: unknown) => {
    const base = HttpClientRequest.make(method)(`${root}/api/v4${path}`).pipe(
      HttpClientRequest.setUrlParams(query),
      HttpClientRequest.bearerToken(secret),
      HttpClientRequest.acceptJson
    )
    const request = body === undefined ? base : HttpClientRequest.bodyJsonUnsafe(base, body)
    const attempt = client.execute(request).pipe(
      Effect.mapError((e) => fail(operation, `${method} ${path}: ${e.reason._tag}`))
    )
    // A POST that failed with 5xx may have been applied; only 429 proves it was not.
    const retryable = (status: number) => status === 429 || (status >= 500 && method !== "POST")
    return Effect.gen(function*() {
      let response = yield* attempt
      if (retryable(response.status)) {
        const after = Number(response.headers["retry-after"] ?? "1")
        const seconds = Number.isFinite(after) && after >= 0 ? Math.min(after, MAX_RETRY_AFTER_SECONDS) : 1
        yield* Effect.sleep(Duration.seconds(seconds))
        response = yield* attempt
      }
      if (response.status < 200 || response.status >= 300) {
        const text = yield* response.text.pipe(Effect.orElseSucceed(() => ""))
        return yield* fail(operation, `${method} ${path}: HTTP ${response.status}: ${errorText(text)}`)
      }
      return response
    })
  }

  const call = <S extends Schema.Top>(
    operation: string,
    method: Method,
    path: string,
    schema: S,
    options: { readonly query?: Query; readonly body?: unknown } = {}
  ) =>
    Effect.gen(function*() {
      const response = yield* send(operation, method, path, options.query ?? {}, options.body)
      const json = yield* response.json.pipe(Effect.mapError(() => fail(operation, `${method} ${path}: response is not JSON`)))
      return yield* Schema.decodeUnknownEffect(schema)(json).pipe(
        Effect.mapError(() => fail(operation, `${method} ${path}: unexpected response shape`))
      )
    }) as Effect.Effect<S["Type"], ForgeError, S["DecodingServices"]>

  const pages = <S extends Schema.Top>(operation: string, path: string, schema: S, query: Query = {}) =>
    Effect.gen(function*() {
      const items: Array<S["Type"]> = []
      for (let page = 1; page <= MAX_PAGES; page++) {
        const response = yield* send(operation, "GET", path, { ...query, per_page: "100", page: String(page) }, undefined)
        const json = yield* response.json.pipe(Effect.mapError(() => fail(operation, `GET ${path}: response is not JSON`)))
        items.push(
          ...(yield* Schema.decodeUnknownEffect(Schema.Array(schema))(json).pipe(
            Effect.mapError(() => fail(operation, `GET ${path}: unexpected response shape`))
          ))
        )
        const next = response.headers["x-next-page"] ?? ""
        if (next === "") return items as ReadonlyArray<S["Type"]>
        if (next !== String(page + 1)) return yield* fail(operation, `GET ${path}: unexpected next page "${next}" after ${page}`)
      }
      return yield* fail(operation, `GET ${path}: more than ${MAX_PAGES} pages`)
    }) as Effect.Effect<ReadonlyArray<S["Type"]>, ForgeError, S["DecodingServices"]>

  const projectPath = (ref: MrRef) => `/projects/${encodeURIComponent(ref.project)}`
  const mrPath = (ref: MrRef) => `${projectPath(ref)}/merge_requests/${ref.iid}`

  let identity: number | null = null
  const self = Effect.gen(function*() {
    if (identity !== null) return identity
    const user = yield* call("identity", "GET", "/user", User)
    if (user.id !== config.forge.botUserId) {
      return yield* fail("identity", `the token belongs to user ${user.id}, the config names bot user ${config.forge.botUserId}`)
    }
    identity = user.id
    return user.id
  })

  const forge: ForgeShape = {
    snapshot: (ref) =>
      Effect.gen(function*() {
        // Versions are read after the diffs: if the newest version still matches the head read first,
        // no push landed in between and the diffs belong to that head.
        const mr = yield* call("snapshot", "GET", mrPath(ref), MergeRequest)
        const diffs = yield* pages("snapshot", `${mrPath(ref)}/diffs`, Diff)
        const [latest] = yield* call("snapshot", "GET", `${mrPath(ref)}/versions`, Schema.Array(Version), { query: { per_page: "1" } })
        const reason = incompleteness(mr, latest, diffs)
        if (reason !== null || latest === undefined) return yield* new IncompleteSnapshot({ reason: reason ?? "" })
        const suffix = `/-/merge_requests/${ref.iid}`
        if (!mr.web_url.endsWith(suffix)) return yield* fail("snapshot", `unexpected merge request URL ${mr.web_url}`)
        const snapshot: MrSnapshot = {
          ref,
          title: mr.title,
          description: mr.description ?? "",
          author: mr.author.username,
          sourceBranch: mr.source_branch,
          targetBranch: mr.target_branch,
          webUrl: mr.web_url,
          projectWebUrl: mr.web_url.slice(0, -suffix.length),
          labels: mr.labels,
          revision: { base: latest.base_commit_sha, start: latest.start_commit_sha, head: latest.head_commit_sha },
          changes: diffs.map(change)
        }
        return snapshot
      }),

    live: (ref) => Effect.map(call("live", "GET", mrPath(ref), MergeRequest), (mr) => ({ head: mr.sha, labels: mr.labels })),

    findReport: (ref) =>
      Effect.gen(function*() {
        const me = yield* self
        const notes = yield* pages("findReport", `${mrPath(ref)}/notes`, Note, { sort: "asc", order_by: "created_at" })
        const ours = notes
          .filter((n) => !n.system && n.author.id === me)
          .flatMap((n) => {
            const marker = parseMarker(n.body)
            return marker !== null && marker.iid === ref.iid ? [{ id: n.id, marker }] : []
          })
          .sort((a, b) => a.id - b.id)
        return ours[0] ?? null
      }),

    createNote: (ref, body) =>
      Effect.map(call("createNote", "POST", `${mrPath(ref)}/notes`, Note, { body: { body } }), (n) => n.id),

    updateNote: (ref, note, body) => Effect.asVoid(call("updateNote", "PUT", `${mrPath(ref)}/notes/${note}`, Note, { body: { body } })),

    updateLabels: (ref, transition) =>
      Effect.gen(function*() {
        const { add, remove } = transition
        if (add.length === 0 && remove.length === 0) return
        const listed = [...add, ...remove].find((l) => l.includes(","))
        if (listed !== undefined) return yield* fail("updateLabels", `label "${listed}" contains a comma, which GitLab reads as a separator`)
        if (add.length > 0) {
          // GitLab creates any label it does not know on MR update; refuse instead of inventing one.
          const known = new Set((yield* pages("updateLabels", `${projectPath(ref)}/labels`, Label, { include_ancestor_groups: "true" })).map((l) => l.name))
          const missing = add.filter((l) => !known.has(l))
          if (missing.length > 0) return yield* fail("updateLabels", `labels do not exist in the project or its groups: ${missing.join(", ")}`)
        }
        const body: Record<string, string> = {}
        if (add.length > 0) body["add_labels"] = add.join(",")
        if (remove.length > 0) body["remove_labels"] = remove.join(",")
        yield* call("updateLabels", "PUT", mrPath(ref), Schema.Unknown, { body })
      }),

    checkout: (ref, head) =>
      Effect.gen(function*() {
        const project = yield* call("checkout", "GET", projectPath(ref), Project)
        const gitDir = yield* fs.makeTempDirectoryScoped({ prefix: "heron-source-" }).pipe(
          Effect.mapError((e) => fail("checkout", `cannot create a temporary directory: ${e.message}`))
        )
        yield* fetchCommit({
          gitDir,
          url: project.http_url_to_repo,
          commit: head,
          authorization: {
            prefix: `${new URL(root).origin}/`,
            header: Redacted.make(`Authorization: Basic ${Buffer.from(`oauth2:${secret}`).toString("base64")}`)
          }
        }).pipe(Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner))
        return { gitDir, commit: head }
      })
  }
  return forge
})

/** Reads GITLAB_TOKEN from the environment; everything else comes from the resolved config. */
export const layer = (config: Config) =>
  Layer.effect(Forge)(
    Effect.gen(function*() {
      const token = yield* EnvConfig.Redacted("GITLAB_TOKEN").pipe(
        Effect.mapError(() => new ForgeError({ operation: "configure", detail: "GITLAB_TOKEN is not set" }))
      )
      return yield* make(config, token)
    })
  )

export const GitLabForge = { make, layer } as const
