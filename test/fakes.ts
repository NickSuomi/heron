import { Effect, Layer, Result } from "effect"
import { type Config, decodeConfigFile, resolveConfig } from "../src/config.ts"
import type { Change, DiffAnchor, DiscussionId, LabelTransition, LimitReading, LimitWindow, MrSnapshot, NoteId, Sha, Usage } from "../src/domain.ts"
import { Forge, ForgeError, Harness, HarnessError, type HarnessRequest } from "../src/ports.ts"
import { parseFingerprint, parseMarker, parsePrior } from "../src/report.ts"

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
  readonly anchor: DiffAnchor | null
  readonly head: Sha | null
  readonly replies: Array<string>
}

export interface ForgeState {
  head: Sha
  base: Sha
  start: Sha
  changes: ReadonlyArray<Change>
  labels: Array<string>
  notes: Map<number, string>
  nextNote: number
  labelWrites: Array<LabelTransition>
  /** The changes from one head to another, null when the first is not an ancestor of the second, or the forge's failure. */
  delta: (from: Sha, to: Sha) => ReadonlyArray<Change> | null | ForgeError
  deltaCalls: Array<readonly [Sha, Sha]>
  calls: number
  threads: Array<FakeThread>
  /** Thread operations that fail with HTTP 500. */
  failing: Set<"findThreads" | "createThread" | "updateThreadNote" | "replyToThread" | "resolveThread">
}

export const fakeForge = (
  init: { head: Sha; changes: ReadonlyArray<Change>; labels?: Array<string>; notes?: Map<number, string>; failCreateNote?: boolean }
) => {
  const state: ForgeState = {
    head: init.head,
    base: sha("b"),
    start: sha("b"),
    changes: init.changes,
    labels: init.labels ?? [],
    notes: init.notes ?? new Map(),
    nextNote: 100,
    labelWrites: [],
    delta: () => null,
    deltaCalls: [],
    calls: 0,
    threads: [],
    failing: new Set()
  }
  const call = <A>(f: () => A) => Effect.sync(() => (state.calls++, f()))
  const threadCall = <A>(operation: ForgeState["failing"] extends Set<infer O> ? O : never, f: () => A) =>
    state.failing.has(operation) ? Effect.fail(new ForgeError({ operation, detail: "HTTP 500" })) : call(f)
  const thread = (id: DiscussionId) => state.threads.find((t) => t.id === id)!
  const layer = Layer.succeed(Forge)({
    snapshot: () =>
      call(() => ({
        ...snapshotAt(state.head, state.changes),
        revision: { base: state.base, start: state.start, head: state.head },
        labels: [...state.labels]
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
          return fingerprint === null ? [] : [{ id: t.id, note: t.note, fingerprint, body: t.body, resolved: t.resolved }]
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
    replyToThread: (_, id, body) => threadCall("replyToThread", () => void thread(id).replies.push(body)),
    resolveThread: (_, id, resolved) => threadCall("resolveThread", () => void (thread(id).resolved = resolved)),
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
        const output = answer(request)
        if (output instanceof HarnessError) return yield* output
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
  return { summary: "Synthesized.", decisions: ids.map((id) => ({ id, ruling: "keep", reason: "real" })), limitations: [], ...extra }
}
