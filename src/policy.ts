import { posix } from "node:path"
import { Result, Schema } from "effect"
import type { NonEmptyReadonlyArray } from "effect/Array"
import type { Config, Rule } from "./config.ts"
import {
  type Branch,
  type BranchSpec,
  type Change,
  type Classification,
  type Command,
  type CommandNote,
  type DismissedFinding,
  type Dismissal,
  type Finding,
  type FindingId,
  type Fingerprint,
  type Gate,
  type GateName,
  type GateStatus,
  type LabelMap,
  type LabelTransition,
  type Lane,
  type LocatedFinding,
  type Marker,
  type ModelFinding,
  type MrSnapshot,
  type NoteId,
  type Outcome,
  type PriorReview,
  type ReviewPlan,
  type SessionId,
  sessionId,
  type Sha,
  type Slot,
  type SynthesisOutput,
  type Thread,
  type ThreadAction,
  type ThreadDraft,
  type UserId,
  type Verdict
} from "./domain.ts"
import { locationAfter } from "./diff.ts"

export const admits = (allowed: ReadonlyArray<UserId> | null, triggeredBy: UserId | null): boolean =>
  allowed === null || (triggeredBy !== null && allowed.includes(triggeredBy))

const changedPaths = (changes: ReadonlyArray<Change>): ReadonlyArray<string> => [
  ...new Set(changes.flatMap((c) => c.oldPath === null || c.oldPath === c.path ? [c.path] : [c.oldPath, c.path]))
]

const fires = (rule: Rule, paths: ReadonlyArray<string>): ReadonlyArray<string> | null => {
  const hits = paths.filter((p) => rule.paths.some((glob) => posix.matchesGlob(p, glob)))
  if (hits.length === 0) return null
  return rule.when === "any" || hits.length === paths.length ? hits : null
}

/** The strictest lane any rule selects wins; with no rule firing, the default lane applies. */
export const classify = (config: Pick<Config, "lanes" | "rules" | "defaultLane">, changes: ReadonlyArray<Change>): Classification => {
  const paths = changedPaths(changes)
  const matched = config.rules.flatMap((rule) => {
    const hits = fires(rule, paths)
    return hits === null ? [] : [{ rule, paths: hits }]
  })
  const rank = (lane: Lane) => config.lanes.indexOf(lane)
  const lane = matched.reduce<Lane | null>((best, m) => best === null || rank(m.rule.lane) > rank(best) ? m.rule.lane : best, null)
  return { lane: lane ?? config.defaultLane, matched: matched.map((m) => ({ rule: m.rule.id, paths: m.paths })) }
}

const branchOf = (spec: BranchSpec, gates: NonEmptyReadonlyArray<Gate>, prefix: ReadonlyArray<string>): Branch => {
  const gateSlot = (gate: Gate): Slot => ({
    id: sessionId([...prefix, "gate", gate.name]),
    role: "gate",
    profile: spec.gate,
    gates: [gate]
  })
  return {
    gates: [gateSlot(gates[0]), ...gates.slice(1).map(gateSlot)],
    supervisor: { id: sessionId([...prefix, "supervisor"]), role: "supervisor", profile: spec.supervisor, gates }
  }
}

export const planFor = (lane: Lane): ReviewPlan => {
  switch (lane.shape) {
    case "single":
      return { shape: "single", reviewer: { id: sessionId(["reviewer"]), role: "reviewer", profile: lane.reviewer, gates: lane.gates } }
    case "gated":
      return { shape: "gated", branch: branchOf(lane.branch, lane.gates, []) }
    case "dual":
      return {
        shape: "dual",
        branches: [branchOf(lane.branches[0], lane.gates, ["b1"]), branchOf(lane.branches[1], lane.gates, ["b2"])],
        judge: { id: sessionId(["judge"]), role: "judge", profile: lane.judge, gates: lane.gates }
      }
  }
}

export const slotsOf = (plan: ReviewPlan): ReadonlyArray<Slot> => {
  switch (plan.shape) {
    case "single":
      return [plan.reviewer]
    case "gated":
      return [...plan.branch.gates, plan.branch.supervisor]
    case "dual":
      return [...plan.branches.flatMap((b) => [...b.gates, b.supervisor]), plan.judge]
  }
}

export const assignIds = (origin: SessionId, findings: ReadonlyArray<ModelFinding | Omit<Finding, "id" | "origin">>): ReadonlyArray<Finding> =>
  findings.map((f, i) => ({ ...f, location: f.location, suggestion: f.suggestion ?? null, id: `${origin}#${i + 1}` as FindingId, origin }))

/** The origin of the findings an earlier review kept; their ids are `earlier#n`. */
export const EARLIER = sessionId(["earlier"])

/**
 * The earlier head a re-review may start from, with the findings to rule on again, or null when only a full review is
 * safe. The note must record a finished review of another head under the same config digest and lane, taken against the
 * same target tip and merge base. Whether that head is an ancestor of the new one is the forge's to check.
 */
export const rereviewStart = (
  existing: { readonly marker: Marker; readonly prior: PriorReview | null } | null,
  current: { readonly digest: string; readonly lane: Lane; readonly revision: MrSnapshot["revision"] }
): { readonly from: Sha; readonly earlier: ReadonlyArray<Finding> } | null => {
  const prior = existing?.prior ?? null
  if (existing === null || prior === null) return null
  const { marker } = existing
  const safe = marker.head !== current.revision.head && marker.configDigest === current.digest && prior.lane === current.lane.name &&
    prior.base === current.revision.base && prior.start === current.revision.start
  return safe ? { from: marker.head, earlier: assignIds(EARLIER, prior.findings) } : null
}

/**
 * The earlier findings moved to the reviewed head through `delta`, the changes since the head they were read at. A
 * finding on a line the delta removed or rewrote keeps its path and loses its line, for the ruling session to place again.
 * A suggestion stays only when every line it replaces moved unchanged and together, and still needs a ruling to confirm it.
 */
export const carried = (earlier: ReadonlyArray<Finding>, delta: ReadonlyArray<Change>): ReadonlyArray<Finding> =>
  earlier.map((f) => {
    if (f.location === null) return f
    const { path, line } = f.location
    const location = locationAfter(delta, f.location)
    const intact = f.suggestion !== null && line !== null && location.line !== null &&
      Array.from({ length: f.suggestion.lines }, (_, i) => locationAfter(delta, { path, line: line + i }).line)
        .every((l, i) => l === location.line! + i)
    return { ...f, location, suggestion: intact ? f.suggestion : null }
  })

export class SynthesisIncomplete extends Schema.TaggedError<SynthesisIncomplete>()("SynthesisIncomplete", {
  session: Schema.String,
  missing: Schema.Array(Schema.String),
  duplicated: Schema.Array(Schema.String),
  unknown: Schema.Array(Schema.String)
}) {}

/** Decisions must rule on every input finding exactly once; anything else fails the review rather than guessing. */
export const applySynthesis = (
  inputs: ReadonlyArray<Finding>,
  out: SynthesisOutput,
  origin: SessionId
): Result.Result<ReadonlyArray<Finding>, SynthesisIncomplete> => {
  const ids = new Set<string>(inputs.map((f) => f.id))
  const seen = new Set<string>()
  const duplicated = new Set<string>()
  for (const d of out.decisions) (seen.has(d.id) ? duplicated : seen).add(d.id)
  const missing = [...ids].filter((id) => !seen.has(id))
  const unknown = [...seen].filter((id) => !ids.has(id))
  if (missing.length + duplicated.size + unknown.length > 0) {
    return Result.fail(new SynthesisIncomplete({ session: origin, missing, duplicated: [...duplicated], unknown }))
  }
  const decisions = new Map(out.decisions.map((d) => [d.id, d]))
  const kept = inputs.flatMap((f) => {
    const { confirmSuggestion, line, ruling } = decisions.get(f.id)!
    if (ruling === "drop") return []
    // A ruling places only a finding that has no line; it does not move one that has.
    const located = f.location !== null && f.location.line === null && line !== null ? { ...f, location: { ...f.location, line } } : f
    const placed = confirmSuggestion ? located : { ...located, suggestion: null }
    return ruling === "keep as advisory" ? [{ ...placed, severity: "advisory" as const }] : [placed]
  })
  return Result.succeed([...kept, ...assignIds(origin, out.added ?? [])])
}

export const verdictOf = (outcome: Outcome): Exclude<Verdict, "SUPERSEDED"> =>
  outcome.kind === "incomplete"
    ? "BLOCKED"
    : outcome.findings.some((f) => f.severity === "blocker")
    ? "CHANGES REQUESTED"
    : "PASS"

export const gateStatuses = (gates: ReadonlyArray<Gate>, outcome: Outcome): ReadonlyArray<readonly [GateName, GateStatus]> =>
  gates.map((g) => [
    g.name,
    outcome.kind === "incomplete"
      ? "not assessed"
      : outcome.findings.some((f) => f.gate === g.name && f.severity === "blocker")
      ? "changes requested"
      : "pass"
  ])

export type LabelPhase = { readonly kind: "running" } | { readonly kind: "done"; readonly verdict: Verdict }

const verdictLabel = (map: LabelMap, verdict: Verdict): string | null => {
  switch (verdict) {
    case "PASS":
      return map.pass
    case "CHANGES REQUESTED":
      return map.changesRequested
    case "BLOCKED":
      return map.blocked
    case "SUPERSEDED":
      return null
  }
}

/** Computed from the live labels, so applying it twice changes nothing the second time. */
export const labelTransition = (map: LabelMap, phase: LabelPhase, live: ReadonlyArray<string>): LabelTransition => {
  const has = (l: string | null): l is string => l !== null && live.includes(l)
  if (phase.kind === "running") {
    return { add: map.inProgress === null || has(map.inProgress) ? [] : [map.inProgress], remove: [] }
  }
  const want = verdictLabel(map, phase.verdict)
  const managed = [map.inProgress, map.pass, map.changesRequested, map.blocked]
  return {
    add: want === null || has(want) ? [] : [want],
    remove: managed.filter((l): l is string => has(l) && l !== want)
  }
}

export type Publication =
  | { readonly kind: "create" }
  | { readonly kind: "update"; readonly note: NoteId }
  | { readonly kind: "skip"; readonly note: NoteId }

/** A superseded result must not overwrite a report that already covers the live head. */
export const publication = (
  existing: { readonly id: NoteId; readonly marker: Marker } | null,
  verdict: Verdict,
  liveHead: Sha
): Publication =>
  existing === null
    ? { kind: "create" }
    : verdict === "SUPERSEDED" && existing.marker.head === liveHead
    ? { kind: "skip", note: existing.id }
    : { kind: "update", note: existing.id }

/** A finding that gets a thread: a blocker with a location. Advisories and blockers without one stay in the note only. */
export const threadable = (f: Finding): f is LocatedFinding =>
  f.severity === "blocker" && f.location !== null

export const fingerprintOf = (f: LocatedFinding): Fingerprint => ({
  gate: f.gate,
  path: f.location.path,
  title: f.title.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim()
})

const keyOf = (f: Fingerprint): string => JSON.stringify([f.gate, f.path, f.title])

/**
 * One thread per blocker across runs. A kept blocker updates its thread, or reopens it when a person resolved it; a
 * blocker with no thread opens one only where the diff can hold it, which a carried finding whose line the newer commits
 * rewrote cannot. An open thread whose blocker is no longer kept is resolved.
 * A suggestion replaces lines counted from the line the thread sits on, so a thread shows one only while GitLab places it
 * on the finding's line at `head`; a new thread always starts there.
 * Computed from the threads as they are, so applying it twice changes nothing the second time.
 */
export const threadActions = (head: Sha, drafts: ReadonlyArray<ThreadDraft>, threads: ReadonlyArray<Thread>): ReadonlyArray<ThreadAction> => {
  const byKey = new Map<string, Thread>()
  for (const t of threads) if (!byKey.has(keyOf(t.fingerprint))) byKey.set(keyOf(t.fingerprint), t)
  const kept = new Set<string>()
  const actions: Array<ThreadAction> = []
  for (const draft of drafts) {
    const { finding } = draft
    const key = keyOf(fingerprintOf(finding))
    if (kept.has(key)) continue
    kept.add(key)
    const thread = byKey.get(key)
    if (thread === undefined) {
      if (draft.anchor !== null) actions.push({ kind: "create", finding, anchor: draft.anchor, body: draft.suggesting ?? draft.body })
      continue
    }
    const { position } = thread
    const onLine = position !== null && position.head === head && position.path === finding.location.path && position.line === finding.location.line
    const body = onLine && draft.suggesting !== null ? draft.suggesting : draft.body
    const changed = thread.body.trimEnd() !== body.trimEnd()
    if (thread.resolved) actions.push({ kind: "reopen", finding, thread, body: changed ? body : null })
    else if (changed) actions.push({ kind: "update", finding, thread, body })
  }
  for (const thread of threads) {
    if (!thread.resolved && !kept.has(keyOf(thread.fingerprint))) actions.push({ kind: "resolve", thread })
  }
  return actions
}

/** Dismissed findings leave the outcome before the verdict is taken, so a dismissed blocker never blocks again. */
export const dropDismissed = (
  outcome: Outcome,
  dismissals: ReadonlyArray<Dismissal>
): { readonly outcome: Outcome; readonly dismissed: ReadonlyArray<DismissedFinding> } => {
  if (outcome.kind === "incomplete" || dismissals.length === 0) return { outcome, dismissed: [] }
  const byKey = new Map<string, Dismissal>()
  for (const d of dismissals) if (!byKey.has(keyOf(d.fingerprint))) byKey.set(keyOf(d.fingerprint), d)
  const dismissed: Array<DismissedFinding> = []
  const findings = outcome.findings.filter((f) => {
    const dismissal = f.location === null ? undefined : byKey.get(keyOf(fingerprintOf(f as LocatedFinding)))
    if (dismissal === undefined) return true
    dismissed.push({ finding: f as LocatedFinding, dismissal })
    return false
  })
  return { outcome: { ...outcome, findings }, dismissed }
}

/** The last session of the plan, which reads the most: it answers a question with the same profile and gates. */
export const answererOf = (plan: ReviewPlan): Slot => {
  const last = slotsOf(plan).at(-1)!
  return { ...last, id: sessionId(["answerer"]), role: "answerer" }
}

/**
 * The command in a note's first line: `@heron`, whitespace, then a fixed verb in any case. The mention must open the note
 * and stand alone, so `@heronbot` is no command. Anything that is not a verb is a question, with the rest of the note.
 */
export const parseCommand = (body: string): Command | null => {
  const [first = "", ...rest] = body.replace(/\r\n?/g, "\n").split("\n")
  const m = /^@heron(?:[ \t]+(.*))?$/i.exec(first)
  if (m === null) return null
  const text = (m[1] ?? "").trim()
  const verb = text.toLowerCase().replace(/\s+/g, " ")
  switch (verb) {
    case "":
    case "help":
      return { kind: "help" }
    case "review":
    case "full review":
    case "resolve":
    case "configuration":
      return { kind: verb }
  }
  const dismiss = /^dismiss(?:\s+(.*))?$/i.exec(text)
  if (dismiss !== null) return { kind: "dismiss", reason: (dismiss[1] ?? "").trim() }
  return { kind: "question", text: [text, ...rest].join("\n").trim() }
}

export type PlannedCommand =
  | { readonly kind: "command"; readonly note: CommandNote; readonly command: Command }
  /** `reply` is true for the first note a user outside the allow list writes on the merge request, false after that. */
  | { readonly kind: "deny"; readonly note: CommandNote; readonly reply: boolean }

/**
 * The notes a poll acts on, in note order. A handled note is skipped. A user outside the allow list is told once per merge
 * request, which `denied` records from Heron's earlier replies; every later note of theirs is only marked.
 * Computed from the notes as they are, so a second poll over the same notes plans nothing.
 */
export const planCommands = (allowed: ReadonlyArray<UserId>, source: { readonly notes: ReadonlyArray<CommandNote>; readonly denied: ReadonlyArray<UserId> }): ReadonlyArray<PlannedCommand> => {
  const told = new Set<UserId>(source.denied)
  return [...source.notes].sort((a, b) => a.id - b.id).flatMap((note): ReadonlyArray<PlannedCommand> => {
    const command = parseCommand(note.body)
    if (note.handled || command === null) return []
    if (allowed.includes(note.author.id)) return [{ kind: "command", note, command }]
    const reply = !told.has(note.author.id)
    told.add(note.author.id)
    return [{ kind: "deny", note, reply }]
  })
}
