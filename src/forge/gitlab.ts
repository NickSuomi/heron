import { rm } from "node:fs/promises"
import { join } from "node:path"
import { Config as EnvConfig, Duration, Effect, FileSystem, Layer, Redacted, Schema } from "effect"
import { HttpClient, HttpClientRequest } from "effect/unstable/http"
import { ChildProcessSpawner } from "effect/unstable/process"
import type { Config } from "../config.ts"
import {
  type Change,
  type CommandNote,
  type CommentThread,
  DiscussionId,
  type MrRef,
  type MrSnapshot,
  NoteId,
  Sha,
  type Thread,
  UserId
} from "../domain.ts"
import { parseCommand } from "../policy.ts"
import { Forge, ForgeError, type ForgeShape, IncompleteSnapshot, type Noteable, type SourceCheckout, TREE_REFS } from "../ports.ts"
import { parseDenied, parseDismissal, parseFingerprint, parseMarker, parsePrior } from "../report.ts"
import { fetchCommits, materialize, thaw } from "./git.ts"

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
  changes_count: Schema.NullOr(Schema.String),
  head_pipeline: Schema.optionalKey(Schema.NullOr(Schema.Struct({
    id: Schema.Int,
    project_id: Schema.Int,
    status: Schema.String,
    web_url: Schema.String
  })))
})
const Issue = Schema.Struct({
  id: Schema.Int,
  iid: Schema.Int,
  title: Schema.String,
  description: Schema.NullOr(Schema.String),
  state: Schema.String,
  web_url: Schema.String,
  // GitLab 18.11 leaves this out of related_issues items.
  references: Schema.optionalKey(Schema.Struct({ full: Schema.String }))
})
/** `group/app#12` from the issue's page URL, for items that come without `references`. */
const referenceOf = (issue: typeof Issue.Type): string =>
  issue.references?.full ?? `${new URL(issue.web_url).pathname.split("/-/")[0]!.slice(1)}#${issue.iid}`
const Job = Schema.Struct({ id: Schema.Int, name: Schema.String, stage: Schema.String, web_url: Schema.String })
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
const RawChanges = Schema.Struct({
  sha: Sha,
  changes_count: Schema.NullOr(Schema.String),
  overflow: Schema.Boolean,
  diff_refs: Schema.Struct({ head_sha: Sha, base_sha: Sha, start_sha: Sha }),
  changes: Schema.Array(Diff)
})
const Commit = Schema.Struct({ id: Sha })
const Compare = Schema.Struct({ compare_timeout: Schema.Boolean, diffs: Schema.Array(Diff) })
const Note = Schema.Struct({ id: NoteId, body: Schema.String, system: Schema.Boolean, author: Schema.Struct({ id: Schema.Int }) })
/** GitLab leaves `resolved` out of a note that cannot be resolved. A diff note's `position` has a shape per position type. */
const DiscussionNote = Schema.Struct({ ...Note.fields, resolved: Schema.optionalKey(Schema.Boolean), position: Schema.optionalKey(Schema.Unknown) })
/** A `text` position on a head-side line. GitLab moves it to the newest diff when a push leaves the line unchanged. */
const decodeLinePosition = Schema.decodeUnknownOption(Schema.Struct({
  position_type: Schema.Literal("text"),
  head_sha: Sha,
  new_path: Schema.String,
  new_line: Schema.Int
}))
const Discussion = Schema.Struct({ id: DiscussionId, notes: Schema.Array(DiscussionNote) })
/** A diff note's place on the diff; GitLab sends null for a line the note does not sit on. */
const Position = Schema.Struct({
  new_path: Schema.optionalKey(Schema.NullOr(Schema.String)),
  old_path: Schema.optionalKey(Schema.NullOr(Schema.String)),
  new_line: Schema.optionalKey(Schema.NullOr(Schema.Int)),
  old_line: Schema.optionalKey(Schema.NullOr(Schema.Int))
})
/** A note as `read_discussions` needs it; `internal` and its older name `confidential` mark a note only members may see. */
const CommentNote = Schema.Struct({
  ...DiscussionNote.fields,
  author: Schema.Struct({ id: Schema.Int, username: Schema.String }),
  created_at: Schema.String,
  resolvable: Schema.optionalKey(Schema.Boolean),
  internal: Schema.optionalKey(Schema.Boolean),
  confidential: Schema.optionalKey(Schema.Boolean),
  position: Schema.optionalKey(Schema.NullOr(Position))
})
const CommentDiscussion = Schema.Struct({ id: Schema.String, notes: Schema.Array(CommentNote) })
/** A discussion as `heron poll` reads it: Heron replies to a command in the discussion it is in. */
const CommandDiscussion = Schema.Struct({
  id: DiscussionId,
  notes: Schema.Array(Schema.Struct({ ...CommentNote.fields, author: Schema.Struct({ id: UserId, username: Schema.String }) }))
})
const isUserId = Schema.is(UserId)
const Award = Schema.Struct({ id: Schema.Int, name: Schema.String, user: Schema.Struct({ id: Schema.Int }) })

/**
 * The notes of each discussion a review may read. Dropped: system notes, internal notes, notes by `skip`, the bot's report
 * notes (its author and a marker, as `findReport` matches them), and the bot's notes in a thread it started with a
 * fingerprint, which restate its own blocker; a person's reply in that thread stays. A thread is resolved when every note
 * that can be resolved is.
 */
const commentThreads = (
  discussions: ReadonlyArray<typeof CommentDiscussion.Type>,
  me: number,
  skip: ReadonlySet<string>
): ReadonlyArray<CommentThread> =>
  discussions.flatMap((d) => {
    const first = d.notes[0]
    if (first === undefined) return []
    const heronThread = !first.system && first.author.id === me && parseFingerprint(first.body) !== null
    const notes = d.notes.filter((n) =>
      !n.system && n.internal !== true && n.confidential !== true && !skip.has(n.author.username) &&
      !(n.author.id === me && (heronThread || parseMarker(n.body) !== null))
    )
    if (notes.length === 0) return []
    const resolvable = d.notes.filter((n) => n.resolvable === true)
    const position = first.position ?? null
    return [{
      id: d.id,
      resolved: resolvable.length > 0 && resolvable.every((n) => n.resolved === true),
      path: position === null ? null : position.new_path ?? position.old_path ?? null,
      line: position === null ? null : position.new_line ?? position.old_line ?? null,
      notes: notes.map((n) => ({ author: n.author.username, createdAt: n.created_at, body: n.body }))
    }]
  })

type Method = "GET" | "POST" | "PUT"
type Query = Readonly<Record<string, string | ReadonlyArray<string>>>

const MAX_PAGES = 100
const MAX_RETRY_AFTER_SECONDS = 60
/** How much of each failed job's log the packet carries. */
export const LOG_TAIL_LINES = 200

/** Token shapes that must never reach a model even when a job printed them: GitLab, Anthropic, OpenAI, OpenRouter keys. */
const SECRET_SHAPES = /\b(?:gl[a-z]{2,4}-[A-Za-z0-9_-]{20,}|sk-ant-[A-Za-z0-9_-]{20,}|sk-or-v1-[A-Za-z0-9]{20,}|sk-[A-Za-z0-9_-]{32,})/g

/** The last lines of a job log as a reader sees them: no ANSI codes, no section markers, no overwritten progress lines. */
export const logTail = (raw: string, secrets: ReadonlyArray<string>): string => {
  const lines = raw
    .replace(/\x1b\[[0-9;]*[A-Za-z]/g, "")
    .replace(/section_(?:start|end):\d+:[^\r\n]*?\r/g, "")
    .split("\n")
    .map((l) => l.split("\r").filter((part) => part !== "").at(-1) ?? "")
  while (lines.length > 0 && lines.at(-1)!.trim() === "") lines.pop()
  const tail = lines.slice(-LOG_TAIL_LINES).join("\n")
  return secrets.filter((x) => x.length >= 8).reduce((t, x) => t.split(x).join("[redacted]"), tail).replace(SECRET_SHAPES, "[redacted]")
}

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

const recoveryIncompleteness = (
  mr: typeof MergeRequest.Type,
  listed: ReadonlyArray<typeof Diff.Type>,
  raw: typeof RawChanges.Type,
  latest: typeof Version.Type | undefined
): string | null => {
  if (raw.overflow) return "GitLab truncated the repository-backed diff"
  if (raw.sha !== mr.sha || raw.diff_refs.head_sha !== mr.sha)
    return "the repository-backed diff does not match the merge request head"
  if (latest !== undefined && (raw.diff_refs.base_sha !== latest.base_commit_sha || raw.diff_refs.start_sha !== latest.start_commit_sha))
    return "the repository-backed diff does not match the latest diff version"
  if (raw.changes_count !== mr.changes_count || raw.changes.length !== listed.length)
    return "the repository-backed diff has a different changed-file count"
  const recovered = new Map(raw.changes.map((d) => [d.new_path, d]))
  if (recovered.size !== raw.changes.length) return "the repository-backed diff repeats a changed file"
  for (const file of listed) {
    const full = recovered.get(file.new_path)
    if (full === undefined || full.old_path !== file.old_path || full.new_file !== file.new_file ||
      full.renamed_file !== file.renamed_file || full.deleted_file !== file.deleted_file)
      return `the repository-backed diff has different file metadata for ${file.new_path}`
    if (full.collapsed === true || full.too_large === true || (file.collapsed === true && full.diff === ""))
      return `GitLab still omitted the diff of ${file.new_path}`
    if (file.collapsed !== true && full.diff !== file.diff)
      return `the repository-backed patch differs from the listed patch for ${file.new_path}`
  }
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
  const forgeRoot = config.forge.url.replace(/\/+$/, "")
  const secret = Redacted.value(token)
  const fail = (operation: string, detail: string) =>
    new ForgeError({ operation, detail: detail.split(secret).join("[redacted]").slice(0, 300) })

  const send = (operation: string, method: Method, path: string, query: Query, body: unknown) => {
    const base = HttpClientRequest.make(method)(`${forgeRoot}/api/v4${path}`).pipe(
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

  const text = (operation: string, path: string) =>
    Effect.flatMap(send(operation, "GET", path, {}, undefined), (response) =>
      response.text.pipe(Effect.mapError(() => fail(operation, `GET ${path}: unreadable response`))))

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
  const noteablePath = (n: Noteable) =>
    n.kind === "merge_request" ? `${mrPath(n.ref)}/discussions` : `/projects/${encodeURIComponent(n.project)}/issues/${n.iid}/discussions`
  const skipAuthors = new Set(config.skipAuthors)

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
        let diffs = yield* pages("snapshot", `${mrPath(ref)}/diffs`, Diff)
        // Only /changes with access_raw_diffs retrieves repository-backed patches omitted by /diffs.
        const raw = diffs.some((d) => d.collapsed === true) && !diffs.some((d) => d.too_large === true) &&
          mr.changes_count !== null && /^\d+$/.test(mr.changes_count) && Number(mr.changes_count) === diffs.length
          ? yield* call("snapshot", "GET", `${mrPath(ref)}/changes`, RawChanges, { query: { access_raw_diffs: "true" } })
          : null
        const [latest] = yield* call("snapshot", "GET", `${mrPath(ref)}/versions`, Schema.Array(Version), { query: { per_page: "1" } })
        if (raw !== null) {
          const reason = recoveryIncompleteness(mr, diffs, raw, latest)
          if (reason !== null) return yield* new IncompleteSnapshot({ reason })
          diffs = raw.changes
        }
        const reason = incompleteness(mr, latest, diffs)
        if (reason !== null || latest === undefined) return yield* new IncompleteSnapshot({ reason: reason ?? "" })
        const suffix = `/-/merge_requests/${ref.iid}`
        if (!mr.web_url.endsWith(suffix)) return yield* fail("snapshot", `unexpected merge request URL ${mr.web_url}`)
        const closing = yield* pages("snapshot", `${mrPath(ref)}/closes_issues`, Issue)
        const related = yield* pages("snapshot", `${mrPath(ref)}/related_issues`, Issue)
        const issues = [
          ...closing.map((i) => ({ i, relation: "closes" as const })),
          ...related.filter((r) => !closing.some((c) => c.id === r.id)).map((i) => ({ i, relation: "related" as const }))
        ].map(({ i, relation }) => ({
          reference: referenceOf(i),
          relation,
          title: i.title,
          description: i.description ?? "",
          state: i.state,
          webUrl: i.web_url
        }))
        const head = mr.head_pipeline ?? null
        const pipeline = head === null ? null : {
          id: head.id,
          status: head.status,
          webUrl: head.web_url,
          failedJobs: yield* Effect.forEach(
            yield* pages("snapshot", `/projects/${head.project_id}/pipelines/${head.id}/jobs`, Job, { "scope[]": "failed" }),
            (job) =>
              Effect.map(text("snapshot", `/projects/${head.project_id}/jobs/${job.id}/trace`), (log) => ({
                name: job.name,
                stage: job.stage,
                webUrl: job.web_url,
                logTail: logTail(log, [secret])
              }))
          )
        }
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
          changes: diffs.map(change),
          issues,
          pipeline
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
            return marker !== null && marker.iid === ref.iid ? [{ id: n.id, marker, prior: parsePrior(n.body) }] : []
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

    // The merge request discussions API: https://docs.gitlab.com/api/discussions/#merge-requests
    findThreads: (ref) =>
      Effect.gen(function*() {
        const me = yield* self
        const discussions = yield* pages("findThreads", `${mrPath(ref)}/discussions`, Discussion)
        return discussions
          .flatMap((d): ReadonlyArray<Thread> => {
            const first = d.notes[0]
            if (first === undefined || first.system || first.author.id !== me) return []
            const fingerprint = parseFingerprint(first.body)
            if (fingerprint === null) return []
            const at = decodeLinePosition(first.position)
            const position = at._tag === "Some" ? { path: at.value.new_path, line: at.value.new_line, head: at.value.head_sha } : null
            return [{ id: d.id, note: first.id, fingerprint, body: first.body, resolved: first.resolved === true, position }]
          })
          .sort((a, b) => a.note - b.note)
      }),

    // The merge request and issue discussions API: https://docs.gitlab.com/api/discussions/
    discussions: (noteable) =>
      Effect.gen(function*() {
        const me = yield* self
        const listed = yield* pages("discussions", noteablePath(noteable), CommentDiscussion)
        return commentThreads(listed, me, skipAuthors)
      }),

    // A `text` position on an added line carries only `new_line`; on an unchanged line it carries both line numbers.
    createThread: (ref, revision, anchor, body) =>
      Effect.map(
        call("createThread", "POST", `${mrPath(ref)}/discussions`, Discussion, {
          body: {
            body,
            position: {
              position_type: "text",
              base_sha: revision.base,
              start_sha: revision.start,
              head_sha: revision.head,
              old_path: anchor.oldPath,
              new_path: anchor.newPath,
              new_line: anchor.newLine,
              ...(anchor.oldLine === null ? {} : { old_line: anchor.oldLine })
            }
          }
        }),
        (d) => d.id
      ),

    updateThreadNote: (ref, thread, note, body) =>
      Effect.asVoid(call("updateThreadNote", "PUT", `${mrPath(ref)}/discussions/${thread}/notes/${note}`, DiscussionNote, { body: { body } })),

    replyToThread: (ref, thread, body) =>
      Effect.asVoid(call("replyToThread", "POST", `${mrPath(ref)}/discussions/${thread}/notes`, DiscussionNote, { body: { body } })),

    resolveThread: (ref, thread, resolved) =>
      Effect.asVoid(call("resolveThread", "PUT", `${mrPath(ref)}/discussions/${thread}`, Discussion, { query: { resolved: String(resolved) } })),

    delta: (ref, from, to) =>
      Effect.gen(function*() {
        const repo = `${projectPath(ref)}/repository`
        const base = yield* call("delta", "GET", `${repo}/merge_base`, Commit, { query: { "refs[]": [from, to] } })
        if (base.id !== from) return null
        const compare = yield* call("delta", "GET", `${repo}/compare`, Compare, { query: { from, to, straight: "true" } })
        const cut = compare.compare_timeout || compare.diffs.some((d) => d.collapsed === true || d.too_large === true)
        return cut ? null : compare.diffs.map(change)
      }),

    checkout: (ref, revision) =>
      Effect.gen(function*() {
        const project = yield* call("checkout", "GET", projectPath(ref), Project)
        const workDir = yield* Effect.acquireRelease(
          fs.makeTempDirectory({ prefix: "heron-source-" }),
          (dir) => Effect.promise(() => thaw(dir).then(() => rm(dir, { recursive: true, force: true })))
        ).pipe(Effect.mapError((e) => fail("checkout", `cannot create a temporary directory: ${e.message}`)))
        const gitDir = join(workDir, "repo.git")
        const commits = { source: revision.head, target: revision.start, base: revision.base }
        const provide = Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner)
        yield* fetchCommits({
          gitDir,
          url: project.http_url_to_repo,
          commits: [commits.source, commits.target, commits.base],
          authorization: {
            prefix: `${new URL(forgeRoot).origin}/`,
            header: Redacted.make(`Authorization: Basic ${Buffer.from(`oauth2:${secret}`).toString("base64")}`)
          }
        }).pipe(provide)
        const trees = { source: join(workDir, "source"), target: join(workDir, "target"), base: join(workDir, "base") }
        for (const tree of TREE_REFS) {
          yield* materialize(gitDir, commits[tree], trees[tree], join(workDir, `${tree}.index`)).pipe(provide)
        }
        return { gitDir, commits, trees } satisfies SourceCheckout
      }),

    // The project is the configured one; nothing a note says reaches this list. https://docs.gitlab.com/api/merge_requests/#list-project-merge-requests
    openMergeRequests: (updatedAfter) =>
      Effect.map(
        pages("openMergeRequests", `/projects/${encodeURIComponent(config.forge.project)}/merge_requests`, Schema.Struct({ iid: Schema.Int }), {
          state: "opened",
          updated_after: updatedAfter,
          order_by: "updated_at",
          sort: "asc"
        }),
        (mrs) => mrs.map((mr) => mr.iid)
      ),

    // Discussions give each note the discussion to reply in; each command note's award emoji say whether the bot took it.
    // https://docs.gitlab.com/api/discussions/#list-project-merge-request-discussion-items
    // https://docs.gitlab.com/api/emoji_reactions/#list-all-emoji-reactions-for-a-comment
    commandNotes: (ref, createdAfter) =>
      Effect.gen(function*() {
        const me = yield* self
        const since = Date.parse(createdAfter)
        const listed = yield* pages("commandNotes", `${mrPath(ref)}/discussions`, CommandDiscussion)
        const denied = listed.flatMap((d) =>
          d.notes.flatMap((n) => {
            const user = n.system || n.author.id !== me ? null : parseDenied(n.body)
            return isUserId(user) ? [user] : []
          })
        )
        const notes: Array<CommandNote> = []
        for (const d of listed) {
          const first = d.notes[0]
          if (first === undefined) continue
          const blocker = !first.system && first.author.id === me ? parseFingerprint(first.body) : null
          const readable = d.notes.filter((n) => !n.system && n.internal !== true && n.confidential !== true)
          for (const n of readable) {
            if (n.author.id === me || Date.parse(n.created_at) < since || parseCommand(n.body) === null) continue
            const awards = yield* pages("commandNotes", `${mrPath(ref)}/notes/${n.id}/award_emoji`, Award)
            notes.push({
              id: n.id,
              discussion: d.id,
              author: n.author,
              body: n.body,
              handled: awards.some((a) => a.user.id === me),
              blocker: n.id === first.id ? null : blocker,
              thread: readable.slice(0, readable.indexOf(n) + 1).map((t) => ({ author: t.author.username, createdAt: t.created_at, body: t.body }))
            })
          }
        }
        return { notes, denied }
      }),

    // https://docs.gitlab.com/api/emoji_reactions/#add-an-emoji-reaction-to-a-comment
    claim: (ref, note, emoji) =>
      Effect.gen(function*() {
        const me = yield* self
        const path = `${mrPath(ref)}/notes/${note}/award_emoji`
        const awarded = yield* Effect.result(call("claim", "POST", path, Award, { body: { name: emoji } }))
        // Read back, so a refused duplicate and two awards a race let through both leave exactly one winner: the lowest id.
        const mine = (yield* pages("claim", path, Award)).filter((a) => a.user.id === me && a.name === emoji).map((a) => a.id)
        if (awarded._tag === "Failure") return mine.length > 0 ? false : yield* awarded.failure
        return Math.min(...mine) === awarded.success.id
      }),

    dismissals: (ref) =>
      Effect.gen(function*() {
        const me = yield* self
        const notes = yield* pages("dismissals", `${mrPath(ref)}/notes`, Note, { sort: "asc", order_by: "created_at" })
        return notes.filter((n) => !n.system && n.author.id === me).flatMap((n) => {
          const d = parseDismissal(n.body)
          return d === null ? [] : [d]
        })
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
