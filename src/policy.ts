import { posix } from "node:path"
import { Result, Schema } from "effect"
import type { NonEmptyReadonlyArray } from "effect/Array"
import type { Config, Rule } from "./config.ts"
import {
  type Branch,
  type BranchSpec,
  type Change,
  type Classification,
  type Finding,
  type FindingId,
  type Gate,
  type GateName,
  type GateStatus,
  type LabelMap,
  type LabelTransition,
  type Lane,
  type Marker,
  type ModelFinding,
  type NoteId,
  type Outcome,
  type ReviewPlan,
  type SessionId,
  sessionId,
  type Sha,
  type Slot,
  type SynthesisOutput,
  type UserId,
  type Verdict
} from "./domain.ts"

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

export const assignIds = (origin: SessionId, findings: ReadonlyArray<ModelFinding>): ReadonlyArray<Finding> =>
  findings.map((f, i) => ({ ...f, id: `${origin}#${i + 1}` as FindingId, origin }))

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
  const kept = new Set(out.decisions.filter((d) => d.keep).map((d) => d.id))
  return Result.succeed([...inputs.filter((f) => kept.has(f.id)), ...assignIds(origin, out.added ?? [])])
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
