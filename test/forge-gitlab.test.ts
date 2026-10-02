import { execFileSync } from "node:child_process"
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { basename, join } from "node:path"
import { NodeServices } from "@effect/platform-node"
import { afterAll, describe, expect, it } from "@effect/vitest"
import { ConfigProvider, Effect, Fiber, Layer, Redacted } from "effect"
import { TestClock } from "effect/testing"
import { HttpClient, HttpClientResponse } from "effect/http"
import { GitLabForge } from "../src/forge/gitlab.ts"
import { Forge } from "../src/ports.ts"
import type { DiscussionId, LocatedFinding, NoteId } from "../src/domain.ts"
import { parseFingerprint, parsePrior, printMarker, renderDenied, renderDismissed, renderReport, renderThread } from "../src/report.ts"
import { baseConfig, configOf, sha } from "./fakes.ts"
import { sampleOutcome, sampleReview } from "./report-sample.ts"
import { makeWork, sourceChanges } from "./fixtures/harness/repo.ts"

const TOKEN = "glpat-test-secret-0123456789"
const config = configOf()
const ref = { project: "group/app", iid: 7 }
const MR = "/api/v4/projects/group%2Fapp/merge_requests/7"

interface Sent {
  readonly method: string
  readonly path: string
  /** A parameter the request repeats is recorded as the list of its values. */
  readonly query: Record<string, string | ReadonlyArray<string>>
  readonly body?: unknown
}
interface Reply {
  readonly status?: number
  /** Sent as JSON, or as it is when it is a string (a job log). */
  readonly body: unknown
  readonly headers?: Record<string, string>
}

/** Answers requests from a queue in order and records each one; an unexpected extra request fails the test. */
const fakeGitLab = (replies: ReadonlyArray<Reply>) => {
  const sent: Array<Sent> = []
  const authorization: Array<string | undefined> = []
  const queue = [...replies]
  const client = HttpClient.make((request, url) =>
    Effect.sync(() => {
      const body = request.body._tag === "Uint8Array" ? JSON.parse(new TextDecoder().decode(request.body.body)) : undefined
      sent.push({
        method: request.method,
        path: url.pathname,
        query: Object.fromEntries([...new Set(url.searchParams.keys())].map((k) => {
          const values = url.searchParams.getAll(k)
          return [k, values.length === 1 ? values[0]! : values]
        })),
        ...(body === undefined ? {} : { body })
      })
      authorization.push(request.headers["authorization"])
      const reply = queue.shift()
      if (reply === undefined) throw new Error(`unexpected request ${request.method} ${url.pathname}`)
      return HttpClientResponse.fromWeb(
        request,
        new Response(typeof reply.body === "string" ? reply.body : JSON.stringify(reply.body), { status: reply.status ?? 200, headers: reply.headers ?? {} })
      )
    })
  )
  return { sent, authorization, remaining: () => queue.length, layer: Layer.succeed(HttpClient.HttpClient)(client) }
}

const withForge = <A, E>(
  fake: ReturnType<typeof fakeGitLab>,
  use: (forge: Forge["Service"]) => Effect.Effect<A, E>
) =>
  Effect.gen(function*() {
    const forge = yield* GitLabForge.make(config, Redacted.make(TOKEN))
    return yield* use(forge)
  }).pipe(Effect.provide(Layer.merge(fake.layer, NodeServices.layer)))

const mergeRequest = (overrides: Record<string, unknown> = {}) => ({
  iid: 7,
  title: "Add a feature",
  description: null,
  author: { username: "someone" },
  source_branch: "feature",
  target_branch: "main",
  web_url: "https://gitlab.example.com/group/app/-/merge_requests/7",
  sha: sha("c"),
  labels: ["team::web"],
  changes_count: "3",
  ...overrides
})
const version = (overrides: Record<string, unknown> = {}) => ({
  id: 41,
  state: "collected",
  head_commit_sha: sha("c"),
  base_commit_sha: sha("a"),
  start_commit_sha: sha("b"),
  ...overrides
})
const diff = (path: string, overrides: Record<string, unknown> = {}) => ({
  old_path: path,
  new_path: path,
  diff: `@@ -1 +1 @@\n-old\n+new in ${path}\n`,
  new_file: false,
  renamed_file: false,
  deleted_file: false,
  ...overrides
})
const page = (body: unknown, next: string): Reply => ({ body, headers: { "x-next-page": next } })

const note = (id: number, author: number, body: string, system = false) => ({ id, body, system, author: { id: author } })
const marker = (iid: number, head = sha("c")) =>
  printMarker({ iid, head, configDigest: "d".repeat(64), verdict: "PASS" })

describe("GitLab forge", () => {
  it.effect("snapshot reads every diff page and takes the revision from the latest version", () =>
    Effect.gen(function*() {
      const fake = fakeGitLab([
        { body: mergeRequest() },
        page([diff("src/a.ts"), diff("src/new.ts", { new_file: true })], "2"),
        page([diff("src/moved.ts", { old_path: "src/old.ts", renamed_file: true })], ""),
        { body: [version()] },
        page([], ""),
        page([], "")
      ])
      const snapshot = yield* withForge(fake, (forge) => forge.snapshot(ref))
      expect(fake.sent).toEqual([
        { method: "GET", path: MR, query: {} },
        { method: "GET", path: `${MR}/diffs`, query: { per_page: "100", page: "1" } },
        { method: "GET", path: `${MR}/diffs`, query: { per_page: "100", page: "2" } },
        { method: "GET", path: `${MR}/versions`, query: { per_page: "1" } },
        { method: "GET", path: `${MR}/closes_issues`, query: { per_page: "100", page: "1" } },
        { method: "GET", path: `${MR}/related_issues`, query: { per_page: "100", page: "1" } }
      ])
      expect(fake.authorization[0]).toBe(`Bearer ${TOKEN}`)
      expect(snapshot).toEqual({
        ref,
        title: "Add a feature",
        description: "",
        author: "someone",
        sourceBranch: "feature",
        targetBranch: "main",
        webUrl: "https://gitlab.example.com/group/app/-/merge_requests/7",
        projectWebUrl: "https://gitlab.example.com/group/app",
        labels: ["team::web"],
        revision: { base: sha("a"), start: sha("b"), head: sha("c") },
        changes: [
          { path: "src/a.ts", oldPath: null, status: "modified", diff: "@@ -1 +1 @@\n-old\n+new in src/a.ts\n" },
          { path: "src/new.ts", oldPath: null, status: "added", diff: "@@ -1 +1 @@\n-old\n+new in src/new.ts\n" },
          { path: "src/moved.ts", oldPath: "src/old.ts", status: "renamed", diff: "@@ -1 +1 @@\n-old\n+new in src/moved.ts\n" }
        ],
        issues: [],
        pipeline: null
      })
    }))

  it.effect("snapshot carries the linked issues and the failed jobs' log tails, with secrets removed", () =>
    Effect.gen(function*() {
      const issue = (id: number, iid: number, title: string) => ({
        id,
        iid,
        title,
        description: `Details of ${iid}.`,
        state: "opened",
        web_url: `https://gitlab.example.com/group/app/-/issues/${iid}`,
        references: { full: `group/app#${iid}` }
      })
      // GitLab 18.11 leaves `references` out of related_issues items.
      const related = (id: number, iid: number, title: string, project: string) => ({
        id,
        iid,
        title,
        description: `Details of ${iid}.`,
        state: "opened",
        web_url: `https://gitlab.example.com/${project}/-/work_items/${iid}`
      })
      const log = [
        "\x1b[0KRunning with gitlab-runner 18.0",
        "section_start:1700000000:step_script\r\x1b[0K\x1b[32;1m$ pnpm test\x1b[0m",
        ...Array.from({ length: 205 }, (_, i) => `line ${i + 1}`),
        "progress 10%\rprogress 100%",
        `token ${TOKEN} and glpat-${"x".repeat(20)} and sk-ant-oat01-${"y".repeat(24)}`,
        "FAIL test/app.test.ts > adds",
        ""
      ].join("\n")
      const fake = fakeGitLab([
        { body: mergeRequest({ changes_count: "1", head_pipeline: { id: 900, project_id: 55, status: "failed", web_url: "https://gitlab.example.com/group/app/-/pipelines/900" } }) },
        page([diff("src/a.ts")], ""),
        { body: [version()] },
        page([issue(1, 12, "Totals are wrong")], ""),
        page([related(1, 12, "Totals are wrong", "group/app"), related(2, 14, "Follow-up", "group/plans")], ""),
        page([{ id: 7001, name: "unit", stage: "test", web_url: "https://gitlab.example.com/group/app/-/jobs/7001" }], ""),
        { body: log }
      ])
      const snapshot = yield* withForge(fake, (forge) => forge.snapshot(ref))
      expect(fake.sent.slice(4)).toEqual([
        { method: "GET", path: `${MR}/related_issues`, query: { per_page: "100", page: "1" } },
        { method: "GET", path: "/api/v4/projects/55/pipelines/900/jobs", query: { "scope[]": "failed", per_page: "100", page: "1" } },
        { method: "GET", path: "/api/v4/projects/55/jobs/7001/trace", query: {} }
      ])
      expect(snapshot.issues).toEqual([
        { reference: "group/app#12", relation: "closes", title: "Totals are wrong", description: "Details of 12.", state: "opened", webUrl: "https://gitlab.example.com/group/app/-/issues/12" },
        { reference: "group/plans#14", relation: "related", title: "Follow-up", description: "Details of 14.", state: "opened", webUrl: "https://gitlab.example.com/group/plans/-/work_items/14" }
      ])
      const tail = snapshot.pipeline!.failedJobs[0]!.logTail.split("\n")
      expect([snapshot.pipeline!.id, snapshot.pipeline!.status, tail.length, tail[0], tail.slice(-3)]).toEqual([
        900,
        "failed",
        200,
        "line 9",
        ["progress 100%", "token [redacted] and [redacted] and [redacted]", "FAIL test/app.test.ts > adds"]
      ])
    }))

  it.effect("snapshot recovers collapsed patches from repository-backed changes before checking the final version", () =>
    Effect.gen(function*() {
      const full = [diff("src/a.ts"), diff("src/moved.ts", { old_path: "src/old.ts", renamed_file: true })]
      const fake = fakeGitLab([
        { body: mergeRequest({ changes_count: "2" }) },
        page([full[0], { ...full[1], collapsed: true, diff: "" }], ""),
        { body: {
          sha: sha("c"), changes_count: "2", overflow: false,
          diff_refs: { head_sha: sha("c"), base_sha: sha("a"), start_sha: sha("b") },
          changes: full
        } },
        { body: [version()] },
        page([], ""),
        page([], "")
      ])
      const snapshot = yield* withForge(fake, (forge) => forge.snapshot(ref))
      expect(snapshot.changes).toEqual([
        { path: "src/a.ts", oldPath: null, status: "modified", diff: full[0]!.diff },
        { path: "src/moved.ts", oldPath: "src/old.ts", status: "renamed", diff: full[1]!.diff }
      ])
      expect(fake.sent.slice(0, 4)).toEqual([
        { method: "GET", path: MR, query: {} },
        { method: "GET", path: `${MR}/diffs`, query: { per_page: "100", page: "1" } },
        { method: "GET", path: `${MR}/changes`, query: { access_raw_diffs: "true" } },
        { method: "GET", path: `${MR}/versions`, query: { per_page: "1" } }
      ])
      expect(fake.remaining()).toBe(0)
    }))

  const recovered = (overrides: Record<string, unknown> = {}) => ({
    sha: sha("c"), changes_count: "2", overflow: false,
    diff_refs: { head_sha: sha("c"), base_sha: sha("a"), start_sha: sha("b") },
    changes: [diff("src/a.ts"), diff("src/b.ts")],
    ...overrides
  })
  const badRecovery: ReadonlyArray<readonly [string, Record<string, unknown>, Record<string, unknown>, string]> = [
    ["overflow", { overflow: true }, {}, "GitLab truncated the repository-backed diff"],
    ["missing files", { changes: [diff("src/a.ts")] }, {}, "the repository-backed diff has a different changed-file count"],
    ["a capped count", { changes_count: "2+" }, {}, "the repository-backed diff has a different changed-file count"],
    ["an omitted patch", { changes: [diff("src/a.ts"), diff("src/b.ts", { diff: "" })] }, {}, "GitLab still omitted the diff of src/b.ts"],
    ["an oversized patch", { changes: [diff("src/a.ts"), diff("src/b.ts", { too_large: true })] }, {}, "GitLab still omitted the diff of src/b.ts"],
    ["changed file metadata", { changes: [diff("src/a.ts"), diff("src/b.ts", { old_path: "src/old.ts", renamed_file: true })] }, {}, "the repository-backed diff has different file metadata for src/b.ts"],
    ["repeated files", { changes: [diff("src/a.ts"), diff("src/a.ts")] }, {}, "the repository-backed diff repeats a changed file"],
    ["a changed listed patch", { changes: [diff("src/a.ts", { diff: "different" }), diff("src/b.ts")] }, {}, "the repository-backed patch differs from the listed patch for src/a.ts"],
    ["a moved raw head", { sha: sha("e") }, {}, "the repository-backed diff does not match the merge request head"],
    ["a moved comparison base", { diff_refs: { head_sha: sha("c"), base_sha: sha("e"), start_sha: sha("b") } }, {}, "the repository-backed diff does not match the latest diff version"],
    ["a push after recovery", {}, { head_commit_sha: sha("e") }, `the latest diff version is at ${sha("e")}, the merge request head is ${sha("c")}`]
  ]
  for (const [name, raw, v, reason] of badRecovery) {
    it.effect(`snapshot refuses repository-backed recovery with ${name}`, () =>
      Effect.gen(function*() {
        const fake = fakeGitLab([
          { body: mergeRequest({ changes_count: "2" }) },
          page([diff("src/a.ts"), diff("src/b.ts", { collapsed: true, diff: "" })], ""),
          { body: recovered(raw) },
          { body: [version(v)] }
        ])
        const error = yield* Effect.flip(withForge(fake, (forge) => forge.snapshot(ref)))
        expect(error._tag).toBe("IncompleteSnapshot")
        expect(error._tag === "IncompleteSnapshot" && error.reason).toBe(reason)
        expect(fake.remaining()).toBe(0)
      }))
  }

  const incomplete: ReadonlyArray<readonly [string, Record<string, unknown>, Record<string, unknown>, Record<string, unknown>, string]> = [
    ["an overflowing version", {}, { state: "overflow" }, {}, "GitLab truncated the diff (version state overflow)"],
    ["a capped change count", { changes_count: "1000+" }, {}, {}, "GitLab caps the diff at 1000+ files"],
    ["a too-large file", { changes_count: "1" }, {}, { too_large: true }, "GitLab collapsed the diff of src/a.ts"],
    ["a count mismatch", { changes_count: "2" }, {}, {}, "GitLab reports 2 changed files but served 1"],
    ["a diff still being prepared", { changes_count: null }, {}, {}, "GitLab has not finished preparing the diff"],
    [
      "a version behind the head",
      { changes_count: "1" },
      { head_commit_sha: sha("e") },
      {},
      `the latest diff version is at ${sha("e")}, the merge request head is ${sha("c")}`
    ]
  ]
  for (const [name, mr, v, d, reason] of incomplete) {
    it.effect(`snapshot refuses ${name}`, () =>
      Effect.gen(function*() {
        const fake = fakeGitLab([
          { body: mergeRequest({ changes_count: "1", ...mr }) },
          page([diff("src/a.ts", d)], ""),
          { body: [version(v)] }
        ])
        const error = yield* Effect.flip(withForge(fake, (forge) => forge.snapshot(ref)))
        expect(error._tag).toBe("IncompleteSnapshot")
        expect(error._tag === "IncompleteSnapshot" && error.reason).toBe(reason)
      }))
  }

  it.effect("live reads the head and labels", () =>
    Effect.gen(function*() {
      const fake = fakeGitLab([{ body: mergeRequest({ sha: sha("f"), labels: ["x", "y"] }) }])
      expect(yield* withForge(fake, (forge) => forge.live(ref))).toEqual({ head: sha("f"), labels: ["x", "y"] })
      expect(fake.sent).toEqual([{ method: "GET", path: MR, query: {} }])
    }))

  it.effect("findReport takes the bot's lowest marked note across pages and asks for the identity once", () =>
    Effect.gen(function*() {
      const notes = { sort: "asc", order_by: "created_at", per_page: "100" }
      const fake = fakeGitLab([
        { body: { id: 1001, username: "heron-bot" } },
        page([note(30, 555, marker(7)), note(31, 1001, "an ordinary comment"), note(32, 1001, marker(7), true)], "2"),
        page([note(12, 1001, `${marker(7)}\nolder report`), note(40, 1001, marker(7)), note(9, 1001, marker(8))], ""),
        page([note(5, 555, marker(7))], "")
      ])
      const [first, second] = yield* withForge(fake, (forge) => Effect.all([forge.findReport(ref), forge.findReport(ref)]))
      expect(first).toEqual({ id: 12, marker: { iid: 7, head: sha("c"), configDigest: "d".repeat(64), verdict: "PASS" }, prior: null })
      expect(second).toBeNull()
      expect(fake.sent).toEqual([
        { method: "GET", path: "/api/v4/user", query: {} },
        { method: "GET", path: `${MR}/notes`, query: { ...notes, page: "1" } },
        { method: "GET", path: `${MR}/notes`, query: { ...notes, page: "2" } },
        { method: "GET", path: `${MR}/notes`, query: { ...notes, page: "1" } }
      ])
    }))

  it.effect("findReport reads the earlier findings from the bot's note only", () =>
    Effect.gen(function*() {
      const body = renderReport(sampleReview)
      const fake = fakeGitLab([
        { body: { id: 1001, username: "heron-bot" } },
        page([note(3, 555, body), note(4, 1001, body)], ""),
        page([note(3, 555, body)], "")
      ])
      const [ours, theirs] = yield* withForge(fake, (forge) => Effect.all([forge.findReport(ref), forge.findReport(ref)]))
      expect([ours?.id, ours?.prior, theirs]).toEqual([4, parsePrior(body), null])
      expect(ours?.prior?.findings.length).toBe(sampleOutcome.findings.length)
    }))

  const threadBody = (title: string) => renderThread(sampleReview, { ...(sampleOutcome.findings[0] as LocatedFinding), title }, false)
  const discussion = (id: string, notes: ReadonlyArray<unknown>) => ({ id, individual_note: false, notes })
  const diffNote = (id: number, author: number, body: string, resolved?: boolean) => ({
    ...note(id, author, body),
    type: "DiffNote",
    ...(resolved === undefined ? {} : { resolvable: true, resolved })
  })

  it.effect("findThreads keeps the discussions whose first note the bot wrote with a fingerprint, across pages", () =>
    Effect.gen(function*() {
      const fake = fakeGitLab([
        { body: { id: 1001, username: "heron-bot" } },
        page([
          discussion("aa01", [
            { ...diffNote(20, 1001, threadBody("Second"), true), position: { position_type: "text", head_sha: sha("c"), new_path: "src/a.ts", new_line: 12, old_line: null } },
            diffNote(21, 555, "a reply", true)
          ]),
          discussion("aa02", [diffNote(22, 555, threadBody("Copied by a person"), false)]),
          discussion("aa03", [diffNote(23, 1001, "an ordinary bot comment", false)])
        ], "2"),
        page([
          discussion("aa04", [
            { ...diffNote(10, 1001, threadBody("First"), false), position: { position_type: "image", head_sha: sha("c"), new_path: "logo.png", width: 10 } },
            diffNote(11, 1001, "No longer a blocker at `cccccccc`.", false)
          ]),
          discussion("aa05", [{ ...note(12, 1001, threadBody("System"), true) }]),
          discussion("aa06", [])
        ], "")
      ])
      const threads = yield* withForge(fake, (forge) => forge.findThreads(ref))
      expect(threads).toEqual([
        { id: "aa04", note: 10, fingerprint: parseFingerprint(threadBody("First")), body: threadBody("First"), resolved: false, position: null },
        {
          id: "aa01",
          note: 20,
          fingerprint: parseFingerprint(threadBody("Second")),
          body: threadBody("Second"),
          resolved: true,
          position: { path: "src/a.ts", line: 12, head: sha("c") }
        }
      ])
      expect(fake.sent.slice(1)).toEqual([
        { method: "GET", path: `${MR}/discussions`, query: { per_page: "100", page: "1" } },
        { method: "GET", path: `${MR}/discussions`, query: { per_page: "100", page: "2" } }
      ])
    }))

  /** A note as the discussions API lists it, with the fields `discussions` reads. */
  const comment = (id: number, author: number, username: string, body: string, extra: Record<string, unknown> = {}) => ({
    ...note(id, author, body),
    author: { id: author, username },
    created_at: `2026-09-0${(id % 9) + 1}T10:00:00.000Z`,
    ...extra
  })
  const at = (id: number) => `2026-09-0${(id % 9) + 1}T10:00:00.000Z`
  const onLine = { position: { base_sha: sha("a"), start_sha: sha("b"), head_sha: sha("c"), position_type: "text", old_path: "src/cart.ts", new_path: "src/cart.ts", old_line: null, new_line: 88 } }
  const skipping = configOf({ ...baseConfig, skipAuthors: ["ci-bot"] })

  it.effect("discussions leaves out system, internal and skipped notes, Heron's report and its blocker notes, across pages", () =>
    Effect.gen(function*() {
      const fake = fakeGitLab([
        { body: { id: 1001, username: "heron-bot" } },
        page([
          discussion("cc01", [comment(1, 1001, "heron-bot", `${marker(7)}\nthe old report`)]),
          discussion("cc02", [comment(2, 555, "jdoe", `${marker(7)}\na person quoting a marker`)]),
          discussion("cc03", [
            comment(3, 1001, "heron-bot", threadBody("Total is wrong"), { ...onLine, type: "DiffNote", resolvable: true, resolved: true }),
            comment(4, 555, "jdoe", "Fixed in the next commit.", { type: "DiffNote", resolvable: true, resolved: true }),
            comment(5, 1001, "heron-bot", "No longer a blocker at `cccccccc`.", { type: "DiffNote", resolvable: true, resolved: true })
          ]),
          discussion("cc04", [comment(6, 1001, "heron-bot", "added 2 commits", { system: true })]),
          discussion("cc05", [comment(7, 556, "lead", "Security detail for members only.", { internal: true })]),
          discussion("cc06", [comment(8, 556, "lead", "Older API name for the same flag.", { confidential: true })])
        ], "2"),
        page([
          discussion("cc07", [comment(9, 700, "ci-bot", "Coverage went down 0.1%.")]),
          discussion("cc08", [
            comment(10, 555, "jdoe", "Should this round down?", { ...onLine, type: "DiffNote", resolvable: true, resolved: false }),
            comment(11, 556, "lead", "Yes, see the spec.", { type: "DiffNote", resolvable: true, resolved: true }),
            comment(12, 700, "ci-bot", "Pipeline passed.", { type: "DiffNote", resolvable: true, resolved: true })
          ]),
          discussion("cc09", [comment(13, 1001, "heron-bot", "An ordinary bot comment.")])
        ], "")
      ])
      const threads = yield* Effect.gen(function*() {
        const forge = yield* GitLabForge.make(skipping, Redacted.make(TOKEN))
        return yield* forge.discussions({ kind: "merge_request", ref })
      }).pipe(Effect.provide(Layer.merge(fake.layer, NodeServices.layer)))
      expect(threads).toEqual([
        { id: "cc02", resolved: false, path: null, line: null, notes: [{ author: "jdoe", createdAt: at(2), body: `${marker(7)}\na person quoting a marker` }] },
        { id: "cc03", resolved: true, path: "src/cart.ts", line: 88, notes: [{ author: "jdoe", createdAt: at(4), body: "Fixed in the next commit." }] },
        {
          id: "cc08",
          resolved: false,
          path: "src/cart.ts",
          line: 88,
          notes: [{ author: "jdoe", createdAt: at(10), body: "Should this round down?" }, { author: "lead", createdAt: at(11), body: "Yes, see the spec." }]
        },
        { id: "cc09", resolved: false, path: null, line: null, notes: [{ author: "heron-bot", createdAt: at(13), body: "An ordinary bot comment." }] }
      ])
      expect(fake.sent.slice(1)).toEqual([
        { method: "GET", path: `${MR}/discussions`, query: { per_page: "100", page: "1" } },
        { method: "GET", path: `${MR}/discussions`, query: { per_page: "100", page: "2" } }
      ])
    }))

  it.effect("discussions reads an issue in its own project and never calls an issue thread resolved", () =>
    Effect.gen(function*() {
      const fake = fakeGitLab([
        { body: { id: 1001, username: "heron-bot" } },
        page([discussion("dd01", [comment(20, 555, "jdoe", "Steps to reproduce: add two items.")])], "")
      ])
      const threads = yield* withForge(fake, (forge) => forge.discussions({ kind: "issue", project: "acme/storefront", iid: 12 }))
      expect(threads).toEqual([
        { id: "dd01", resolved: false, path: null, line: null, notes: [{ author: "jdoe", createdAt: at(20), body: "Steps to reproduce: add two items." }] }
      ])
      expect(fake.sent[1]).toEqual({ method: "GET", path: "/api/v4/projects/acme%2Fstorefront/issues/12/discussions", query: { per_page: "100", page: "1" } })
    }))

  it.effect("createThread posts a text position on the diff, with the old line only for an unchanged line", () =>
    Effect.gen(function*() {
      const fake = fakeGitLab([
        { status: 201, body: discussion("bb01", [diffNote(30, 1001, "x", false)]) },
        { status: 201, body: discussion("bb02", [diffNote(31, 1001, "y", false)]) }
      ])
      const revision = { base: sha("a"), start: sha("b"), head: sha("c") }
      const ids = yield* withForge(fake, (forge) =>
        Effect.all([
          forge.createThread(ref, revision, { oldPath: "src/old.ts", newPath: "src/new.ts", newLine: 4, oldLine: null }, "x"),
          forge.createThread(ref, revision, { oldPath: "src/a.ts", newPath: "src/a.ts", newLine: 9, oldLine: 7 }, "y")
        ]))
      const position = { position_type: "text", base_sha: sha("a"), start_sha: sha("b"), head_sha: sha("c") }
      expect(ids).toEqual(["bb01", "bb02"])
      expect(fake.sent).toEqual([
        { method: "POST", path: `${MR}/discussions`, query: {}, body: { body: "x", position: { ...position, old_path: "src/old.ts", new_path: "src/new.ts", new_line: 4 } } },
        { method: "POST", path: `${MR}/discussions`, query: {}, body: { body: "y", position: { ...position, old_path: "src/a.ts", new_path: "src/a.ts", new_line: 9, old_line: 7 } } }
      ])
    }))

  it.effect("updateThreadNote puts the first note's body, replyToThread posts a note, resolveThread puts the state", () =>
    Effect.gen(function*() {
      const fake = fakeGitLab([
        { body: diffNote(30, 1001, "v2", false) },
        { status: 201, body: diffNote(31, 1001, "No longer a blocker at `cccccccc`.", false) },
        { body: discussion("bb01", [diffNote(30, 1001, "v2", true)]) },
        { body: discussion("bb01", [diffNote(30, 1001, "v2", false)]) }
      ])
      const id = "bb01" as DiscussionId
      yield* withForge(fake, (forge) =>
        Effect.all([
          forge.updateThreadNote(ref, id, 30 as NoteId, "v2"),
          forge.replyToThread(ref, id, "No longer a blocker at `cccccccc`."),
          forge.resolveThread(ref, id, true),
          forge.resolveThread(ref, id, false)
        ]))
      expect(fake.sent).toEqual([
        { method: "PUT", path: `${MR}/discussions/bb01/notes/30`, query: {}, body: { body: "v2" } },
        { method: "POST", path: `${MR}/discussions/bb01/notes`, query: {}, body: { body: "No longer a blocker at `cccccccc`." } },
        { method: "PUT", path: `${MR}/discussions/bb01`, query: { resolved: "true" } },
        { method: "PUT", path: `${MR}/discussions/bb01`, query: { resolved: "false" } }
      ])
    }))

  const REPO = "/api/v4/projects/group%2Fapp/repository"

  it.effect("delta returns the changes between two heads when the first is an ancestor of the second", () =>
    Effect.gen(function*() {
      const fake = fakeGitLab([
        { body: { id: sha("a") } },
        { body: { compare_timeout: false, diffs: [diff("src/a.ts"), diff("src/new.ts", { new_file: true })] } }
      ])
      const changes = yield* withForge(fake, (forge) => forge.delta(ref, sha("a"), sha("c")))
      expect(changes?.map((c) => `${c.status} ${c.path}`)).toEqual(["modified src/a.ts", "added src/new.ts"])
      expect(fake.sent).toEqual([
        { method: "GET", path: `${REPO}/merge_base`, query: { "refs[]": [sha("a"), sha("c")] } },
        { method: "GET", path: `${REPO}/compare`, query: { from: sha("a"), to: sha("c"), straight: "true" } }
      ])
    }))

  it.effect("delta returns null after a force push, without comparing", () =>
    Effect.gen(function*() {
      const fake = fakeGitLab([{ body: { id: sha("e") } }])
      expect(yield* withForge(fake, (forge) => forge.delta(ref, sha("a"), sha("c")))).toBeNull()
      expect(fake.remaining()).toBe(0)
    }))

  for (const [name, compare] of [
    ["a compare that timed out", { compare_timeout: true, diffs: [diff("src/a.ts")] }],
    ["a collapsed file", { compare_timeout: false, diffs: [diff("src/a.ts", { collapsed: true })] }],
    ["a too-large file", { compare_timeout: false, diffs: [diff("src/a.ts", { too_large: true })] }]
  ] as const) {
    it.effect(`delta returns null for ${name}`, () =>
      Effect.gen(function*() {
        const fake = fakeGitLab([{ body: { id: sha("a") } }, { body: compare }])
        expect(yield* withForge(fake, (forge) => forge.delta(ref, sha("a"), sha("c")))).toBeNull()
      }))
  }

  it.effect("findReport refuses a token that belongs to another user", () =>
    Effect.gen(function*() {
      const fake = fakeGitLab([{ body: { id: 77 } }])
      const error = yield* Effect.flip(withForge(fake, (forge) => forge.findReport(ref)))
      expect(error.message).toBe("identity: the token belongs to user 77, the config names bot user 1001")
    }))

  it.effect("createNote posts the body and returns the new id; updateNote puts it", () =>
    Effect.gen(function*() {
      const fake = fakeGitLab([{ status: 201, body: note(88, 1001, "report") }, { body: note(88, 1001, "report v2") }])
      const id = yield* withForge(fake, (forge) =>
        Effect.flatMap(forge.createNote(ref, "report"), (id) => Effect.as(forge.updateNote(ref, id, "report v2"), id)))
      expect(id).toBe(88)
      expect(fake.sent).toEqual([
        { method: "POST", path: `${MR}/notes`, query: {}, body: { body: "report" } },
        { method: "PUT", path: `${MR}/notes/88`, query: {}, body: { body: "report v2" } }
      ])
    }))

  const labels = "/api/v4/projects/group%2Fapp/labels"
  const labelQuery = { include_ancestor_groups: "true", per_page: "100" }

  it.effect("updateLabels refuses to add a label the project and its groups do not define", () =>
    Effect.gen(function*() {
      const fake = fakeGitLab([
        page([{ name: "review::passed" }], "2"),
        page([{ name: "review::blocked" }], "")
      ])
      const error = yield* Effect.flip(withForge(fake, (forge) =>
        forge.updateLabels(ref, { add: ["review::passed", "review::typo"], remove: [] })))
      expect(error.message).toBe("updateLabels: labels do not exist in the project or its groups: review::typo")
      expect(fake.sent).toEqual([
        { method: "GET", path: labels, query: { ...labelQuery, page: "1" } },
        { method: "GET", path: labels, query: { ...labelQuery, page: "2" } }
      ])
    }))

  it.effect("updateLabels adds and removes in one update, and removes without listing labels", () =>
    Effect.gen(function*() {
      const fake = fakeGitLab([
        page([{ name: "review::passed" }, { name: "review::done" }], ""),
        { body: mergeRequest() },
        { body: mergeRequest() }
      ])
      yield* withForge(fake, (forge) =>
        Effect.andThen(
          forge.updateLabels(ref, { add: ["review::passed", "review::done"], remove: ["review::in progress"] }),
          forge.updateLabels(ref, { add: [], remove: ["review::in progress"] })
        ))
      expect(fake.sent).toEqual([
        { method: "GET", path: labels, query: { ...labelQuery, page: "1" } },
        { method: "PUT", path: MR, query: {}, body: { add_labels: "review::passed,review::done", remove_labels: "review::in progress" } },
        { method: "PUT", path: MR, query: {}, body: { remove_labels: "review::in progress" } }
      ])
    }))

  it.effect("a 429 is retried once after Retry-After", () =>
    Effect.gen(function*() {
      const fake = fakeGitLab([
        { status: 429, body: { message: "slow down" }, headers: { "retry-after": "3" } },
        { body: mergeRequest() }
      ])
      const fiber = yield* Effect.forkChild(withForge(fake, (forge) => forge.live(ref)))
      yield* TestClock.adjust("2 seconds")
      expect(fake.sent.length).toBe(1)
      yield* TestClock.adjust("1 second")
      expect(yield* Fiber.join(fiber)).toEqual({ head: sha("c"), labels: ["team::web"] })
      expect(fake.sent.length).toBe(2)
    }))

  it.effect("a second 429 fails with the status and never a second retry", () =>
    Effect.gen(function*() {
      const fake = fakeGitLab([
        { status: 429, body: { message: "slow down" }, headers: { "retry-after": "0" } },
        { status: 429, body: { message: "slow down" }, headers: { "retry-after": "0" } }
      ])
      const error = yield* Effect.flip(withForge(fake, (forge) => forge.live(ref)))
      expect(error.message).toBe(`live: GET /projects/group%2Fapp/merge_requests/7: HTTP 429: slow down`)
      expect(fake.remaining()).toBe(0)
    }))

  it.effect("a 5xx on POST is not retried, because the note may exist", () =>
    Effect.gen(function*() {
      const fake = fakeGitLab([{ status: 502, body: { message: "bad gateway" } }])
      const error = yield* Effect.flip(withForge(fake, (forge) => forge.createNote(ref, "report")))
      expect(error.message).toBe(`createNote: POST /projects/group%2Fapp/merge_requests/7/notes: HTTP 502: bad gateway`)
      expect(fake.sent.length).toBe(1)
    }))

  it.effect("an error that echoes the token does not carry it", () =>
    Effect.gen(function*() {
      const fake = fakeGitLab([{ status: 401, body: { message: `invalid token ${TOKEN}` } }])
      const error = yield* Effect.flip(withForge(fake, (forge) => forge.live(ref)))
      expect(error.message).toBe(`live: GET /projects/group%2Fapp/merge_requests/7: HTTP 401: invalid token [redacted]`)
    }))

  it.effect("the layer reads GITLAB_TOKEN from the environment and fails without it", () =>
    Effect.gen(function*() {
      const env = (vars: Record<string, string>) => ConfigProvider.fromEnv({ env: vars })
      const fake = fakeGitLab([{ body: mergeRequest() }])
      const live = Effect.gen(function*() {
        return yield* (yield* Forge).live(ref)
      }).pipe(
        Effect.provide(GitLabForge.layer(config)),
        Effect.provide(Layer.merge(fake.layer, NodeServices.layer))
      )
      expect(yield* live.pipe(Effect.provideService(ConfigProvider.ConfigProvider, env({ GITLAB_TOKEN: TOKEN })))).toEqual({
        head: sha("c"),
        labels: ["team::web"]
      })
      expect(fake.authorization).toEqual([`Bearer ${TOKEN}`])
      const missing = yield* Effect.flip(live.pipe(Effect.provideService(ConfigProvider.ConfigProvider, env({}))))
      expect(missing.message).toBe("configure: GITLAB_TOKEN is not set")
    }))

  it.effect("openMergeRequests lists the configured project's open merge requests updated in the window, across pages", () =>
    Effect.gen(function*() {
      const fake = fakeGitLab([page([{ iid: 7 }, { iid: 9 }], "2"), page([{ iid: 12 }], "")])
      expect(yield* withForge(fake, (forge) => forge.openMergeRequests("2026-09-30T09:00:00.000Z"))).toEqual([7, 9, 12])
      const query = { state: "opened", updated_after: "2026-09-30T09:00:00.000Z", order_by: "updated_at", sort: "asc", per_page: "100" }
      expect(fake.sent).toEqual([
        { method: "GET", path: "/api/v4/projects/group%2Fapp/merge_requests", query: { ...query, page: "1" } },
        { method: "GET", path: "/api/v4/projects/group%2Fapp/merge_requests", query: { ...query, page: "2" } }
      ])
    }))

  const award = (id: number, name: string, user: number) => ({ id, name, user: { id: user, username: `u${user}` }, awardable_type: "Note" })

  it.effect("commandNotes keeps new @heron notes by people outside internal threads, reads the bot's awards on each, and trusts only the bot's denials", () =>
    Effect.gen(function*() {
      const blocker = threadBody("Total is wrong")
      const fake = fakeGitLab([
        { body: { id: 1001, username: "heron-bot" } },
        page([
          discussion("ee01", [comment(50, 2001, "jdoe", "@heron review")]),
          discussion("ee02", [
            comment(51, 1001, "heron-bot", blocker, { ...onLine, type: "DiffNote", resolvable: true, resolved: false }),
            comment(52, 2001, "jdoe", "@heron dismiss the total is rounded later", { type: "DiffNote", resolvable: true, resolved: false })
          ]),
          discussion("ee03", [comment(53, 2001, "jdoe", "@heron review", { internal: true })]),
          discussion("ee04", [comment(54, 1001, "heron-bot", "@heron help"), comment(55, 1001, "heron-bot", renderDenied(3005))]),
          discussion("ee05", [comment(56, 2001, "jdoe", "@heron review", { created_at: "2026-08-01T10:00:00.000Z" })]),
          discussion("ee06", [comment(57, 555, "mallory", renderDenied(4000)), comment(58, 2001, "jdoe", "@heronbot hi")]),
          discussion("ee07", [comment(59, 2001, "jdoe", "@heron", { system: true })])
        ], ""),
        page([award(1, "thumbsup", 555)], ""),
        page([award(2, "eyes", 1001)], "")
      ])
      const listed = yield* withForge(fake, (forge) => forge.commandNotes(ref, "2026-09-01T00:00:00.000Z"))
      expect(listed).toEqual({
        notes: [
          {
            id: 50,
            discussion: "ee01",
            author: { id: 2001, username: "jdoe" },
            body: "@heron review",
            handled: false,
            blocker: null,
            thread: [{ author: "jdoe", createdAt: at(50), body: "@heron review" }]
          },
          {
            id: 52,
            discussion: "ee02",
            author: { id: 2001, username: "jdoe" },
            body: "@heron dismiss the total is rounded later",
            handled: true,
            blocker: parseFingerprint(blocker),
            thread: [{ author: "heron-bot", createdAt: at(51), body: blocker }, { author: "jdoe", createdAt: at(52), body: "@heron dismiss the total is rounded later" }]
          }
        ],
        denied: [3005]
      })
      expect(fake.sent.slice(1).map((r) => r.path)).toEqual([`${MR}/discussions`, `${MR}/notes/50/award_emoji`, `${MR}/notes/52/award_emoji`])
    }))

  const claimOf = (replies: ReadonlyArray<Reply>) =>
    Effect.gen(function*() {
      const fake = fakeGitLab([{ body: { id: 1001, username: "heron-bot" } }, ...replies])
      const result = yield* Effect.result(withForge(fake, (forge) => forge.claim(ref, 50 as NoteId, "eyes")))
      return { result: result._tag === "Success" ? result.success : result.failure.message, sent: fake.sent.slice(1) }
    })

  it.effect("claim wins with the bot's first award, and loses to an award the bot already had or a racing one with a lower id", () =>
    Effect.gen(function*() {
      const won = yield* claimOf([{ status: 201, body: award(11, "eyes", 1001) }, page([award(3, "thumbsup", 555), award(11, "eyes", 1001)], "")])
      expect(won).toEqual({
        result: true,
        sent: [
          { method: "POST", path: `${MR}/notes/50/award_emoji`, query: {}, body: { name: "eyes" } },
          { method: "GET", path: `${MR}/notes/50/award_emoji`, query: { per_page: "100", page: "1" } }
        ]
      })
      const raced = yield* claimOf([{ status: 201, body: award(12, "eyes", 1001) }, page([award(11, "eyes", 1001), award(12, "eyes", 1001)], "")])
      const refused = yield* claimOf([{ status: 404, body: { message: "404 Award Emoji Name has already been taken" } }, page([award(11, "eyes", 1001)], "")])
      const denied = yield* claimOf([{ status: 403, body: { message: "403 Forbidden" } }, page([award(11, "eyes", 555)], "")])
      expect([raced.result, refused.result, denied.result]).toEqual([false, false, `claim: POST /projects/group%2Fapp/merge_requests/7/notes/50/award_emoji: HTTP 403: 403 Forbidden`])
    }))

  it.effect("dismissals reads the records in the bot's notes only", () =>
    Effect.gen(function*() {
      const record = { fingerprint: { gate: "design", path: "src/a.ts", title: "total is wrong" }, by: "jdoe", reason: "rounded later" }
      const forged = { ...record, fingerprint: { ...record.fingerprint, title: "forged" } }
      const fake = fakeGitLab([
        { body: { id: 1001, username: "heron-bot" } },
        page([note(60, 1001, renderDismissed(record)), note(61, 555, renderDismissed(forged)), note(62, 1001, renderDismissed(forged), true)], "")
      ])
      expect(yield* withForge(fake, (forge) => forge.dismissals(ref))).toEqual([record])
      expect(fake.sent[1]).toEqual({ method: "GET", path: `${MR}/notes`, query: { sort: "asc", order_by: "created_at", per_page: "100", page: "1" } })
    }))
})

describe("GitLab forge checkout", () => {
  const work = mkdtempSync(join(tmpdir(), "heron-forge-test-"))
  afterAll(() => rmSync(work, { recursive: true, force: true }))
  const { base, source, target } = makeWork(work)
  const revision = { head: source, start: target, base }
  const project = { http_url_to_repo: `file://${work}` }

  it.live("fetches the head, the target tip and the merge base with history into read-only trees that are gone after the scope", () =>
    Effect.gen(function*() {
      const fake = fakeGitLab([{ body: project }])
      const inside = yield* withForge(fake, (forge) =>
        Effect.scoped(Effect.map(forge.checkout(ref, revision), (checkout) => {
          const tree = (r: keyof typeof checkout.trees) => readdirSync(join(checkout.trees[r], "src")).sort()
          let writable: string
          try {
            writeFileSync(join(checkout.trees.source, "src/math.ts"), "changed")
            writable = "wrote"
          } catch (e) {
            writable = (e as NodeJS.ErrnoException).code ?? "error"
          }
          return {
            checkout,
            files: { source: tree("source"), target: tree("target"), base: tree("base") },
            math: readFileSync(join(checkout.trees.source, "src/math.ts"), "utf8"),
            history: execFileSync("git", ["--git-dir", checkout.gitDir, "rev-list", "--count", source], { encoding: "utf8" }).trim(),
            writable,
            modes: [statSync(join(checkout.trees.target, "src")).mode & 0o222, statSync(join(checkout.trees.target, "src/math.ts")).mode & 0o222],
            config: readFileSync(join(checkout.gitDir, "config"), "utf8")
          }
        })))
      expect(fake.sent).toEqual([{ method: "GET", path: "/api/v4/projects/group%2Fapp", query: {} }])
      expect(inside.checkout.commits).toEqual({ source, target, base })
      expect(inside.files).toEqual({
        source: ["app.ts", "broken.ts", "math.ts"],
        target: ["app.ts", "math.ts", "target-only.ts"],
        base: ["app.ts", "math.ts"]
      })
      expect(inside.math).toBe(sourceChanges["src/math.ts"])
      expect([inside.history, inside.writable, inside.modes]).toEqual(["2", "EACCES", [0, 0]])
      expect(inside.config).not.toContain(TOKEN)
      expect(existsSync(inside.checkout.gitDir)).toBe(false)
      expect(existsSync(inside.checkout.trees.source)).toBe(false)
    }))

  it.live("writes a symbolic link in the repository as a plain file, so no tree path leads outside", () =>
    Effect.gen(function*() {
      const linked = mkdtempSync(join(tmpdir(), "heron-forge-link-"))
      const commits = makeWork(linked)
      symlinkSync("/etc/passwd", join(linked, "passwd"))
      execFileSync("git", ["-C", linked, "-c", "user.name=t", "-c", "user.email=t@example.invalid", "add", "passwd"])
      execFileSync("git", ["-C", linked, "-c", "user.name=t", "-c", "user.email=t@example.invalid", "commit", "-q", "-m", "link"])
      const head = execFileSync("git", ["-C", linked, "rev-parse", "HEAD"], { encoding: "utf8" }).trim() as typeof source
      const seen = yield* withForge(fakeGitLab([{ body: { http_url_to_repo: `file://${linked}` } }]), (forge) =>
        Effect.scoped(Effect.map(forge.checkout(ref, { head, start: commits.target, base: commits.base }), (c) => {
          const path = join(c.trees.source, "passwd")
          return [lstatSync(path).isSymbolicLink(), readFileSync(path, "utf8")]
        }))).pipe(Effect.ensuring(Effect.sync(() => rmSync(linked, { recursive: true, force: true }))))
      expect(seen).toEqual([false, "/etc/passwd"])
    }))

  it.live("runs git with an allowlisted environment and no operator git config", () =>
    Effect.gen(function*() {
      const realGit = execFileSync("sh", ["-c", "command -v git"], { encoding: "utf8" }).trim()
      const bin = join(work, "..", `${basename(work)}-bin`)
      const seen = join(bin, "calls.jsonl")
      mkdirSync(bin, { recursive: true })
      writeFileSync(join(bin, "git"), `#!/bin/sh\n"${process.execPath}" -e 'require("fs").appendFileSync(process.argv[1], JSON.stringify({ args: process.argv.slice(2), env: process.env }) + "\\n")' "${seen}" "$@"\nexec "${realGit}" "$@"\n`)
      chmodSync(join(bin, "git"), 0o755)
      const ambient = [
        "HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "no_proxy", "all_proxy",
        "GIT_SSL_CAINFO", "GIT_SSL_CAPATH", "SSL_CERT_FILE", "SSL_CERT_DIR", "CURL_CA_BUNDLE"
      ]
      const pinned: Record<string, string | undefined> = {
        ...Object.fromEntries(ambient.map((name) => [name, undefined])),
        PATH: `${bin}:${process.env["PATH"]}`,
        NO_PROXY: "127.0.0.1,localhost",
        HERON_TEST_SECRET: "must-not-leak"
      }
      const saved = Object.fromEntries(Object.keys(pinned).map((name) => [name, process.env[name]]))
      const apply = (vars: Record<string, string | undefined>) =>
        Object.entries(vars).forEach(([name, value]) => value === undefined ? delete process.env[name] : (process.env[name] = value))
      apply(pinned)
      const restore = Effect.sync(() => {
        apply(saved)
        rmSync(bin, { recursive: true, force: true })
      })
      const calls = yield* withForge(fakeGitLab([{ body: project }]), (forge) => Effect.scoped(forge.checkout(ref, revision))).pipe(
        Effect.map(() =>
          readFileSync(seen, "utf8").trim().split("\n").map((l) => JSON.parse(l) as { args: Array<string>; env: Record<string, string> })
        ),
        Effect.ensuring(restore)
      )
      const shell = ["PWD", "OLDPWD", "SHLVL", "_"]
      const env = calls.find((c) => c.args.includes("fetch"))!.env
      const keys = Object.keys(env).filter((k) => !shell.includes(k)).sort()
      // Building the trees needs no credential, so those git runs never see one.
      const tree = calls.find((c) => c.args.includes("checkout-index"))!.env
      expect(Object.keys(tree).filter((k) => !shell.includes(k)).sort()).toEqual([
        "GIT_CONFIG_GLOBAL", "GIT_CONFIG_NOSYSTEM", "GIT_INDEX_FILE", "GIT_TERMINAL_PROMPT", "HOME", "NO_PROXY", "PATH"
      ])
      expect([keys, env["NO_PROXY"], env["HOME"], env["GIT_CONFIG_GLOBAL"], env["GIT_CONFIG_NOSYSTEM"]]).toEqual([
        [
          "GIT_CONFIG_COUNT", "GIT_CONFIG_GLOBAL", "GIT_CONFIG_KEY_0", "GIT_CONFIG_KEY_1", "GIT_CONFIG_NOSYSTEM", "GIT_CONFIG_VALUE_0",
          "GIT_CONFIG_VALUE_1", "GIT_TERMINAL_PROMPT", "HOME", "NO_PROXY", "PATH"
        ],
        "127.0.0.1,localhost",
        "/nonexistent",
        "/dev/null",
        "1"
      ])
    }))

  it.live("fails on a head the repository does not have and still removes the directory", () =>
    Effect.gen(function*() {
      const fake = fakeGitLab([{ body: project }])
      const before = leftovers()
      const error = yield* Effect.flip(withForge(fake, (forge) => Effect.scoped(forge.checkout(ref, { ...revision, head: sha("9") }))))
      expect(error.message).toMatch(/^checkout: git fetch exited 128: /)
      expect(leftovers()).toEqual(before)
    }))
})

const leftovers = () => readdirSync(tmpdir()).filter((name) => name.startsWith("heron-source-")).sort()
