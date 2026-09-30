import { Effect, Layer, Result } from "effect"
import { type Config, decodeConfigFile, resolveConfig } from "../src/config.ts"
import type {
  Change,
  Comment,
  CommentThread,
  DiffAnchor,
  DiscussionId,
  Fingerprint,
  LabelTransition,
  LimitReading,
  LinkedIssue,
  MrSnapshot,
  NoteId,
  Sha,
  Usage,
  UserId
} from "../src/domain.ts"
import { Forge, ForgeError, Harness, HarnessError, type HarnessRequest } from "../src/ports.ts"
import { parseDenied, parseDismissal, parseFingerprint, parseMarker, parsePrior } from "../src/report.ts"

export const sha = (c: string) => c.repeat(40) as Sha

export const baseConfig = {
  forge: { kind: "gitlab", url: "https://gitlab.example.com", project: "group/app", botUserId: 1001 },
  admission: { allowedTriggerUserIds: [2001] },
  labels: { inProgress: "review::in progress", pass: "review::passed", changesRequested: "review::changes requested", blocked: "review::blocked" },
  backend: "alpha",
  harnesses: { alpha: { kind: "claude-cli", concurrency: 2 }, beta: { kind: "codex-cli", concurrency: 1 } },
  profiles: {
    quick: { model: "model-q", effort: "low" },
    deep: { model: "model-d", effort: "high" },
    other: { harness: "beta", model: "model-o", effort: "medium" }
  },
  gates: { design: { instructions: "design.md" }, correctness: { instructions: "correctness.md" } },
  lanes: [
    { name: "light", shape: "single", gates: ["correctness"], reviewer: "quick" },
    { name: "standard", shape: "gated", gates: ["design", "correctness"], gate: "quick", supervisor: "deep" },
    {
      name: "critical",
      shape: "dual",
      gates: ["design", "correctness"],
      branches: [{ gate: "quick", supervisor: "deep" }, { gate: "other", supervisor: "other" }],
      judge: "deep"
    }
  ],
  defaultLane: "standard",
  rules: [
    { id: "docs-only", lane: "light", when: "all", paths: ["**/*.md", "docs/**"] },
    { id: "auth", lane: "critical", when: "any", paths: ["src/auth/**"] }
  ]
}

export const texts = new Map([["design.md", "Check the design."], ["correctness.md", "Check correctness."]])

export const configOf = (raw: unknown = baseConfig, env: Record<string, string> = {}, files = texts): Config => {
  const result = Result.flatMap(decodeConfigFile(raw, env), (file) => resolveConfig(file, files))
  if (Result.isFailure(result)) throw new Error(result.failure.message)
  return result.success
}

export const change = (path: string, status: Change["status"] = "modified", oldPath: string | null = null): Change => ({
  path,
  oldPath,
  status,
  diff: `@@ -1 +1 @@\n-old\n+new`
})

/** A change whose diff adds lines 1 to `added` of `path`, as a new file. */
export const addedFile = (path: string, added = 5): Change => ({
  path,
  oldPath: null,
  status: "added",
  diff: `@@ -0,0 +1,${added} @@\n${Array.from({ length: added }, (_, i) => `+line ${i + 1}`).join("\n")}\n`
})

export const snapshotAt = (head: Sha, changes: ReadonlyArray<Change>): MrSnapshot => ({
  ref: { project: "group/app", iid: 7 },
  title: "Add a feature",
  description: "Adds it.",
  author: "someone",
  sourceBranch: "feature",
  targetBranch: "main",
  webUrl: "https://gitlab.example.com/group/app/-/merge_requests/7",
  projectWebUrl: "https://gitlab.example.com/group/app",
  labels: [],
  revision: { base: sha("b"), start: sha("b"), head },
  changes,
  issues: [],
  pipeline: null
})

/** A discussion on the merge request: the first note, the replies after it, and where it sits on the diff. */
export interface FakeThread {
  readonly id: DiscussionId
  readonly note: NoteId
  body: string
  resolved: boolean
  /** False for a discussion a person started. */
  readonly byBot: boolean
  /** Where GitLab shows the thread now; a test moves it the way GitLab's position tracing does after a push. */
  anchor: DiffAnchor | null
  head: Sha | null
  readonly replies: Array<string>
}

export interface ForgeState {
  head: Sha
  base: Sha
  start: Sha
  changes: ReadonlyArray<Change>
  issues: ReadonlyArray<LinkedIssue>
  labels: Array<string>
  notes: Map<number, string>
  nextNote: number
  labelWrites: Array<LabelTransition>
  /** The changes from one head to another, null when the first is not an ancestor of the second, or the forge's failure. */
  delta: (from: Sha, to: Sha) => ReadonlyArray<Change> | null | ForgeError
  deltaCalls: Array<readonly [Sha, Sha]>
  calls: number
  threads: Array<FakeThread>
  /** The threads `discussions` lists, by `!` for the merge request or `project#iid` for an issue; a string is the forge's failure. */
  comments: Record<string, ReadonlyArray<CommentThread> | string>
  /** Thread operations that fail with HTTP 500. */
  failing: Set<"findThreads" | "createThread" | "updateThreadNote" | "replyToThread" | "resolveThread" | "commandNotes" | "claim">
  /** What `openMergeRequests` lists. */
  openIids: ReadonlyArray<number>
  /** Notes that start with `@heron`, on the merge request `iid`, with the emoji awarded to each. */
  commandNotes: Array<FakeNote>
  /** Every reply the bot posted, in order, with the merge request it went to. */
  posted: Array<{ readonly iid: number; readonly discussion: DiscussionId; readonly body: string }>
  /** Discussions without a Heron fingerprint that the bot resolved. */
  resolvedDiscussions: Array<DiscussionId>
  /** Wait this long in each reply, so a test can watch how many run at once. */
  replyDelay: number
  replying: { now: number; peak: number; perIid: Map<number, number>; peakPerIid: Map<number, number> }
}

export const BOT = 1001

/** A note that starts with `@heron`, as the forge lists it for `heron poll`. */
export interface FakeNote {
  readonly iid: number
  readonly id: NoteId
  readonly discussion: DiscussionId
  readonly author: { readonly id: UserId; readonly username: string }
  readonly body: string
  readonly blocker: Fingerprint | null
  readonly thread: ReadonlyArray<Comment>
  readonly awards: Array<{ readonly id: number; readonly name: string; readonly user: number }>
}

/** A command note by `user`, in its own discussion unless `discussion` names one, as the first note of that discussion. */
export const commandNote = (
  id: number,
  body: string,
  options: { user?: number; username?: string; iid?: number; discussion?: string; blocker?: Fingerprint | null } = {}
): FakeNote => ({
  iid: options.iid ?? 7,
  id: id as NoteId,
  discussion: (options.discussion ?? `c${id}`) as DiscussionId,
  author: { id: (options.user ?? 2001) as UserId, username: options.username ?? "jdoe" },
  body,
  blocker: options.blocker ?? null,
  thread: [{ author: options.username ?? "jdoe", createdAt: "2026-09-30T10:00:00.000Z", body }],
  awards: []
})

export const fakeForge = (
  init: { head: Sha; changes: ReadonlyArray<Change>; labels?: Array<string>; notes?: Map<number, string>; failCreateNote?: boolean }
) => {
  const state: ForgeState = {
    head: init.head,
    base: sha("b"),
    start: sha("b"),
    changes: init.changes,
    issues: [],
    labels: init.labels ?? [],
    notes: init.notes ?? new Map(),
    nextNote: 100,
    labelWrites: [],
    delta: () => null,
    deltaCalls: [],
    calls: 0,
    threads: [],
    comments: {},
    failing: new Set(),
    openIids: [7],
    commandNotes: [],
    posted: [],
    resolvedDiscussions: [],
    replyDelay: 0,
    replying: { now: 0, peak: 0, perIid: new Map(), peakPerIid: new Map() }
  }
  let nextAward = 1
  const call = <A>(f: () => A) => Effect.sync(() => (state.calls++, f()))
  const threadCall = <A>(operation: ForgeState["failing"] extends Set<infer O> ? O : never, f: () => A) =>
    state.failing.has(operation) ? Effect.fail(new ForgeError({ operation, detail: "HTTP 500" })) : call(f)
  const thread = (id: DiscussionId) => state.threads.find((t) => t.id === id)!
  const layer = Layer.succeed(Forge)({
    snapshot: () =>
      call(() => ({
        ...snapshotAt(state.head, state.changes),
        revision: { base: state.base, start: state.start, head: state.head },
        labels: [...state.labels],
        issues: state.issues
      })),
    live: () => call(() => ({ head: state.head, labels: [...state.labels] })),
    findReport: () =>
      call(() => {
        for (const id of [...state.notes.keys()].sort((a, b) => a - b)) {
          const body = state.notes.get(id)!
          const marker = parseMarker(body)
          if (marker !== null) return { id: id as NoteId, marker, prior: parsePrior(body) }
        }
        return null
      }),
    createNote: (_, body) =>
      init.failCreateNote === true
        ? Effect.fail(new ForgeError({ operation: "createNote", detail: "HTTP 500" }))
        : call(() => (state.notes.set(state.nextNote, body), state.nextNote++ as NoteId)),
    updateNote: (_, note, body) => call(() => void state.notes.set(note, body)),
    findThreads: () =>
      threadCall("findThreads", () =>
        state.threads.flatMap((t) => {
          const fingerprint = t.byBot ? parseFingerprint(t.body) : null
          const position = t.anchor === null || t.head === null ? null : { path: t.anchor.newPath, line: t.anchor.newLine, head: t.head }
          return fingerprint === null ? [] : [{ id: t.id, note: t.note, fingerprint, body: t.body, resolved: t.resolved, position }]
        })),
    createThread: (_, revision, anchor, body) =>
      threadCall("createThread", () => {
        const note = state.nextNote++ as NoteId
        const id = `d${note}` as DiscussionId
        state.threads.push({ id, note, body, resolved: false, byBot: true, anchor, head: revision.head, replies: [] })
        return id
      }),
    updateThreadNote: (_, id, note, body) =>
      threadCall("updateThreadNote", () => {
        if (thread(id).note !== note) throw new Error(`note ${note} is not the first note of ${id}`)
        thread(id).body = body
      }),
    discussions: (n) =>
      Effect.suspend(() => {
        const listed = state.comments[n.kind === "merge_request" ? "!" : `${n.project}#${n.iid}`] ?? []
        return typeof listed === "string" ? Effect.fail(new ForgeError({ operation: "discussions", detail: listed })) : Effect.succeed(listed)
      }),
    replyToThread: (ref, id, body) =>
      Effect.gen(function*() {
        const r = state.replying
        r.now++
        r.peak = Math.max(r.peak, r.now)
        r.perIid.set(ref.iid, (r.perIid.get(ref.iid) ?? 0) + 1)
        r.peakPerIid.set(ref.iid, Math.max(r.peakPerIid.get(ref.iid) ?? 0, r.perIid.get(ref.iid)!))
        if (state.replyDelay > 0) yield* Effect.sleep(state.replyDelay)
        r.now--
        r.perIid.set(ref.iid, r.perIid.get(ref.iid)! - 1)
        return yield* threadCall("replyToThread", () => {
          state.threads.find((t) => t.id === id)?.replies.push(body)
          state.posted.push({ iid: ref.iid, discussion: id, body })
        })
      }),
    resolveThread: (_, id, resolved) =>
      threadCall("resolveThread", () => {
        const t = state.threads.find((x) => x.id === id)
        if (t === undefined) state.resolvedDiscussions.push(id)
        else t.resolved = resolved
      }),
    openMergeRequests: () => call(() => state.openIids),
    // Yields after reading, so polls run side by side both read the notes before either claims one.
    commandNotes: (ref) =>
      Effect.tap(threadCall("commandNotes", () => ({
        notes: state.commandNotes.filter((n) => n.iid === ref.iid).map(({ author, awards, blocker, body, discussion, id, thread }) => ({
          id,
          discussion,
          author,
          body,
          handled: awards.some((a) => a.user === BOT),
          blocker,
          thread
        })),
        denied: state.posted.filter((p) => p.iid === ref.iid).flatMap((p) => {
          const user = parseDenied(p.body)
          return user === null ? [] : [user as UserId]
        })
      })), () => Effect.yieldNow),
    // As GitLab does: a second award of the same emoji by the same user is refused.
    claim: (_, note, emoji) =>
      threadCall("claim", () => {
        const n = state.commandNotes.find((x) => x.id === note)!
        if (n.awards.some((a) => a.user === BOT && a.name === emoji)) return false
        n.awards.push({ id: nextAward++, name: emoji, user: BOT })
        return true
      }),
    dismissals: () =>
      call(() =>
        state.posted.flatMap((p) => {
          const d = parseDismissal(p.body)
          return d === null ? [] : [d]
        })
      ),
    delta: (_, from, to) =>
      Effect.flatMap(call(() => (state.deltaCalls.push([from, to]), state.delta(from, to))), (d) => d instanceof ForgeError ? Effect.fail(d) : Effect.succeed(d)),
    updateLabels: (_, t) =>
      call(() => {
        state.labelWrites.push(t)
        state.labels = [...state.labels.filter((l) => !t.remove.includes(l)), ...t.add.filter((l) => !state.labels.includes(l))]
      }),
    checkout: (_, revision) =>
      call(() => ({
        gitDir: "/nonexistent/fake.git",
        commits: { source: revision.head, target: revision.start, base: revision.base },
        trees: { source: "/nonexistent/source", target: "/nonexistent/target", base: "/nonexistent/base" }
      }))
  })
  return { state, layer }
}

const usage: Usage = { inputTokens: 1200, cachedInputTokens: null, outputTokens: 300, reasoningTokens: null, costUsd: 0.0125 }

export type Script = (request: HarnessRequest) => unknown

export const reviewOut = (findings: ReadonlyArray<unknown> = [], summary = "Looks fine.") => ({ summary, findings, limitations: [] })
export const finding = (gate: string, severity: "blocker" | "advisory", title = `${severity} in ${gate}`) => ({
  gate,
  severity,
  location: { path: "src/app.ts", line: 3 },
  title,
  body: "Explanation."
})

/** A gate's findings must name a suggestion; a scripted finding that leaves it out proposes none. */
const withSuggestionKeys = (output: unknown): unknown => {
  const o = output as { findings?: ReadonlyArray<Record<string, unknown>> }
  return Array.isArray(o.findings) ? { ...o, findings: o.findings.map((f) => ({ suggestion: null, ...f })) } : output
}

/** Answers by session id; a thrown HarnessError becomes the session's failure. */
export const fakeHarness = (
  answers: Readonly<Record<string, Script>>,
  options: {
    delay?: number
    slow?: Readonly<Record<string, number>>
    onRun?: (r: HarnessRequest) => void
    /** Successive subscription readings; each `limits` call takes the next. */
    limits?: ReadonlyArray<LimitReading>
    /** A usage-limit warning each session reports. */
    limitWarning?: string
  } = {}
) => {
  const readings = [...(options.limits ?? [])]
  const seen: Array<HarnessRequest> = []
  const inFlight = new Map<string, number>()
  const peak = new Map<string, number>()
  const layer = Layer.succeed(Harness)({
    run: (request) =>
      Effect.gen(function*() {
        seen.push(request)
        options.onRun?.(request)
        const key = request.slot.profile.harness
        inFlight.set(key, (inFlight.get(key) ?? 0) + 1)
        peak.set(key, Math.max(peak.get(key) ?? 0, inFlight.get(key)!))
        const delay = options.slow?.[request.slot.id] ?? options.delay
        if (delay !== undefined) yield* Effect.sleep(delay)
        inFlight.set(key, inFlight.get(key)! - 1)
        const answer = answers[request.slot.id]
        if (answer === undefined) return yield* new HarnessError({ kind: "vendor", detail: `no scripted answer for ${request.slot.id}` })
        const answered = answer(request)
        if (answered instanceof HarnessError) return yield* answered
        const output = request.slot.role === "gate" ? withSuggestionKeys(answered) : answered
        return {
          output,
          reportedModel: request.slot.profile.model,
          vendorSessionId: `v-${request.slot.id}`,
          usage,
          toolCalls: 2,
          ...(options.limitWarning === undefined ? {} : { limitWarning: options.limitWarning })
        }
      }),
    ...(options.limits === undefined ? {} : { limits: Effect.sync((): LimitReading => readings.shift() ?? { failure: "no scripted reading" }) })
  })
  return { layer, seen, peak }
}

/** Every finding id listed in the prompt's JSON blocks. */
export const promptIds = (request: HarnessRequest): ReadonlyArray<string> =>
  [...request.prompt.matchAll(/```json\n([\s\S]*?)\n```/g)].flatMap((m) => (JSON.parse(m[1]!) as Array<{ id: string }>).map((f) => f.id))

/** Keep every decision on every finding id listed in the prompt's JSON blocks. */
export const keepAll = (extra: Record<string, unknown> = {}): Script => (request) => {
  const ids = promptIds(request)
  return { summary: "Synthesized.", decisions: ids.map((id) => ({ id, ruling: "keep", reason: "real", line: null, confirmSuggestion: false })), limitations: [], ...extra }
}
