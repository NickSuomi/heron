import { execFileSync } from "node:child_process"
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { basename, join } from "node:path"
import { NodeServices } from "@effect/platform-node"
import { afterAll, describe, expect, it } from "@effect/vitest"
import { ConfigProvider, Effect, Fiber, Layer, Redacted } from "effect"
import { TestClock } from "effect/testing"
import { HttpClient, HttpClientResponse } from "effect/unstable/http"
import { GitLabForge } from "../src/forge/gitlab.ts"
import { Forge } from "../src/ports.ts"
import { printMarker } from "../src/report.ts"
import { configOf, sha } from "./fakes.ts"

const TOKEN = "glpat-test-secret-0123456789"
const config = configOf()
const ref = { project: "group/app", iid: 7 }
const MR = "/api/v4/projects/group%2Fapp/merge_requests/7"

interface Sent {
  readonly method: string
  readonly path: string
  readonly query: Record<string, string>
  readonly body?: unknown
}
interface Reply {
  readonly status?: number
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
        query: Object.fromEntries(url.searchParams),
        ...(body === undefined ? {} : { body })
      })
      authorization.push(request.headers["authorization"])
      const reply = queue.shift()
      if (reply === undefined) throw new Error(`unexpected request ${request.method} ${url.pathname}`)
      return HttpClientResponse.fromWeb(
        request,
        new Response(JSON.stringify(reply.body), { status: reply.status ?? 200, headers: reply.headers ?? {} })
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
        { body: [version()] }
      ])
      const snapshot = yield* withForge(fake, (forge) => forge.snapshot(ref))
      expect(fake.sent).toEqual([
        { method: "GET", path: MR, query: {} },
        { method: "GET", path: `${MR}/diffs`, query: { per_page: "100", page: "1" } },
        { method: "GET", path: `${MR}/diffs`, query: { per_page: "100", page: "2" } },
        { method: "GET", path: `${MR}/versions`, query: { per_page: "1" } }
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
        ]
      })
    }))

  const incomplete: ReadonlyArray<readonly [string, Record<string, unknown>, Record<string, unknown>, Record<string, unknown>, string]> = [
    ["an overflowing version", {}, { state: "overflow" }, {}, "GitLab truncated the diff (version state overflow)"],
    ["a capped change count", { changes_count: "1000+" }, {}, {}, "GitLab caps the diff at 1000+ files"],
    ["a collapsed file", { changes_count: "1" }, {}, { collapsed: true }, "GitLab collapsed the diff of src/a.ts"],
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
      expect(first).toEqual({ id: 12, marker: { iid: 7, head: sha("c"), configDigest: "d".repeat(64), verdict: "PASS" } })
      expect(second).toBeNull()
      expect(fake.sent).toEqual([
        { method: "GET", path: "/api/v4/user", query: {} },
        { method: "GET", path: `${MR}/notes`, query: { ...notes, page: "1" } },
        { method: "GET", path: `${MR}/notes`, query: { ...notes, page: "2" } },
        { method: "GET", path: `${MR}/notes`, query: { ...notes, page: "1" } }
      ])
    }))

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
})

describe("GitLab forge checkout", () => {
  const work = mkdtempSync(join(tmpdir(), "heron-forge-test-"))
  afterAll(() => rmSync(work, { recursive: true, force: true }))
  const git = (...args: Array<string>) =>
    execFileSync("git", ["-c", "user.name=Test", "-c", "user.email=test@example.invalid", "-C", work, ...args], { encoding: "utf8" }).trim()
  git("init", "--quiet")
  writeFileSync(join(work, "a.txt"), "first\n")
  git("add", "a.txt")
  git("commit", "--quiet", "-m", "first")
  const head = git("rev-parse", "HEAD") as ReturnType<typeof sha>
  const project = { http_url_to_repo: `file://${work}` }

  it.live("fetches exactly the head into a private repository that is gone after the scope", () =>
    Effect.gen(function*() {
      const fake = fakeGitLab([{ body: project }])
      const inside = yield* withForge(fake, (forge) =>
        Effect.scoped(Effect.map(forge.checkout(ref, head), (checkout) => ({
          checkout,
          type: execFileSync("git", ["--git-dir", checkout.gitDir, "cat-file", "-t", head], { encoding: "utf8" }).trim(),
          config: readFileSync(join(checkout.gitDir, "config"), "utf8")
        }))))
      expect(fake.sent).toEqual([{ method: "GET", path: "/api/v4/projects/group%2Fapp", query: {} }])
      expect(inside.checkout.commit).toBe(head)
      expect(inside.type).toBe("commit")
      expect(inside.config).not.toContain(TOKEN)
      expect(existsSync(inside.checkout.gitDir)).toBe(false)
    }))

  it.live("runs git with an allowlisted environment and no operator git config", () =>
    Effect.gen(function*() {
      const realGit = execFileSync("sh", ["-c", "command -v git"], { encoding: "utf8" }).trim()
      const bin = join(work, "..", `${basename(work)}-bin`)
      const seen = join(bin, "env.json")
      mkdirSync(bin, { recursive: true })
      writeFileSync(join(bin, "git"), `#!/bin/sh\n"${process.execPath}" -e 'require("fs").writeFileSync(process.argv[1], JSON.stringify(process.env))' "${seen}"\nexec "${realGit}" "$@"\n`)
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
      const env = yield* withForge(fakeGitLab([{ body: project }]), (forge) => Effect.scoped(forge.checkout(ref, head))).pipe(
        Effect.map(() => JSON.parse(readFileSync(seen, "utf8")) as Record<string, string>),
        Effect.ensuring(restore)
      )
      const keys = Object.keys(env).filter((k) => !["PWD", "OLDPWD", "SHLVL", "_"].includes(k)).sort()
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
      const error = yield* Effect.flip(withForge(fake, (forge) => Effect.scoped(forge.checkout(ref, sha("9")))))
      expect(error.message).toMatch(/^checkout: git fetch exited 128: /)
      expect(leftovers()).toEqual(before)
    }))
})

const leftovers = () => readdirSync(tmpdir()).filter((name) => name.startsWith("heron-source-")).sort()
