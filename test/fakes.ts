import { Effect, Layer, Result } from "effect"
import { type Config, decodeConfigFile, resolveConfig } from "../src/config.ts"
import type { Change, LabelTransition, MrSnapshot, NoteId, Sha, Usage } from "../src/domain.ts"
import { Forge, ForgeError, Harness, HarnessError, type HarnessRequest } from "../src/ports.ts"
import { parseMarker } from "../src/report.ts"

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
  changes
})

export interface ForgeState {
  head: Sha
  changes: ReadonlyArray<Change>
  labels: Array<string>
  notes: Map<number, string>
  nextNote: number
  labelWrites: Array<LabelTransition>
  calls: number
}

export const fakeForge = (
  init: { head: Sha; changes: ReadonlyArray<Change>; labels?: Array<string>; notes?: Map<number, string>; failCreateNote?: boolean }
) => {
  const state: ForgeState = {
    head: init.head,
    changes: init.changes,
    labels: init.labels ?? [],
    notes: init.notes ?? new Map(),
    nextNote: 100,
    labelWrites: [],
    calls: 0
  }
  const call = <A>(f: () => A) => Effect.sync(() => (state.calls++, f()))
  const layer = Layer.succeed(Forge)({
    snapshot: () => call(() => ({ ...snapshotAt(state.head, state.changes), labels: [...state.labels] })),
    live: () => call(() => ({ head: state.head, labels: [...state.labels] })),
    findReport: () =>
      call(() => {
        for (const id of [...state.notes.keys()].sort((a, b) => a - b)) {
          const marker = parseMarker(state.notes.get(id)!)
          if (marker !== null) return { id: id as NoteId, marker }
        }
        return null
      }),
    createNote: (_, body) =>
      init.failCreateNote === true
        ? Effect.fail(new ForgeError({ operation: "createNote", detail: "HTTP 500" }))
        : call(() => (state.notes.set(state.nextNote, body), state.nextNote++ as NoteId)),
    updateNote: (_, note, body) => call(() => void state.notes.set(note, body)),
    updateLabels: (_, t) =>
      call(() => {
        state.labelWrites.push(t)
        state.labels = [...state.labels.filter((l) => !t.remove.includes(l)), ...t.add.filter((l) => !state.labels.includes(l))]
      }),
    checkout: (_, head) => call(() => ({ gitDir: "/nonexistent/fake.git", commit: head }))
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
export const fakeHarness = (answers: Readonly<Record<string, Script>>, options: { delay?: number; onRun?: (r: HarnessRequest) => void } = {}) => {
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
        if (options.delay !== undefined) yield* Effect.sleep(options.delay)
        inFlight.set(key, inFlight.get(key)! - 1)
        const answer = answers[request.slot.id]
        if (answer === undefined) return yield* new HarnessError({ kind: "vendor", detail: `no scripted answer for ${request.slot.id}` })
        const output = answer(request)
        if (output instanceof HarnessError) return yield* output
        return { output, reportedModel: request.slot.profile.model, vendorSessionId: `v-${request.slot.id}`, usage, toolCalls: 2 }
      })
  })
  return { layer, seen, peak }
}

/** Keep every decision on every finding id listed in the prompt's JSON block. */
export const keepAll = (extra: Record<string, unknown> = {}): Script => (request) => {
  const block = /```json\n([\s\S]*?)\n```/.exec(request.prompt)
  const ids = block === null ? [] : (JSON.parse(block[1]!) as Array<{ id: string }>).map((f) => f.id)
  return { summary: "Synthesized.", decisions: ids.map((id) => ({ id, keep: true, reason: "real" })), limitations: [], ...extra }
}
