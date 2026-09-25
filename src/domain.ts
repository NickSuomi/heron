import { Schema } from "effect"
import type { NonEmptyReadonlyArray } from "effect/Array"

export const Sha = Schema.String.check(Schema.isPattern(/^[0-9a-f]{40}$/)).pipe(Schema.brand("Sha"))
export type Sha = typeof Sha.Type
export const GateName = Schema.String.check(Schema.isPattern(/^[a-z][a-z0-9_-]*$/)).pipe(Schema.brand("GateName"))
export type GateName = typeof GateName.Type
export const LaneName = Schema.String.check(Schema.isPattern(/^[a-z][a-z0-9_-]*$/)).pipe(Schema.brand("LaneName"))
export type LaneName = typeof LaneName.Type
export const ProfileName = Schema.String.check(Schema.isPattern(/^[a-z][a-z0-9_-]*$/)).pipe(Schema.brand("ProfileName"))
export type ProfileName = typeof ProfileName.Type
export const HarnessKey = Schema.String.check(Schema.isPattern(/^[a-z][a-z0-9_-]*$/)).pipe(Schema.brand("HarnessKey"))
export type HarnessKey = typeof HarnessKey.Type
export const UserId = Schema.Int.check(Schema.isGreaterThan(0)).pipe(Schema.brand("UserId"))
export type UserId = typeof UserId.Type
export const NoteId = Schema.Int.check(Schema.isGreaterThan(0)).pipe(Schema.brand("NoteId"))
export type NoteId = typeof NoteId.Type

export type SessionId = string & { readonly SessionId: unique symbol }
export const sessionId = (parts: ReadonlyArray<string>): SessionId => parts.join(".") as SessionId
export type FindingId = `${SessionId}#${number}`

export interface MrRef {
  readonly project: string
  readonly iid: number
}

export interface Change {
  readonly path: string
  readonly oldPath: string | null
  readonly status: "added" | "modified" | "deleted" | "renamed"
  readonly diff: string
}

/** Everything a review reads from the forge, captured once at one head. */
export interface MrSnapshot {
  readonly ref: MrRef
  readonly title: string
  readonly description: string
  readonly author: string
  readonly sourceBranch: string
  readonly targetBranch: string
  readonly webUrl: string
  readonly projectWebUrl: string
  readonly labels: ReadonlyArray<string>
  readonly revision: { readonly base: Sha; readonly start: Sha; readonly head: Sha }
  readonly changes: ReadonlyArray<Change>
}

export interface Profile {
  readonly name: ProfileName
  readonly harness: HarnessKey
  readonly model: string
  readonly effort: string
}

export interface Gate {
  readonly name: GateName
  readonly instructions: string
}

export interface BranchSpec {
  readonly gate: Profile
  readonly supervisor: Profile
}

export type Lane =
  | { readonly name: LaneName; readonly shape: "single"; readonly gates: NonEmptyReadonlyArray<Gate>; readonly reviewer: Profile }
  | { readonly name: LaneName; readonly shape: "gated"; readonly gates: NonEmptyReadonlyArray<Gate>; readonly branch: BranchSpec }
  | {
    readonly name: LaneName
    readonly shape: "dual"
    readonly gates: NonEmptyReadonlyArray<Gate>
    readonly branches: readonly [BranchSpec, BranchSpec]
    readonly judge: Profile
  }

export interface Classification {
  readonly lane: Lane
  readonly matched: ReadonlyArray<{ readonly rule: string; readonly paths: ReadonlyArray<string> }>
}

export type Role = "reviewer" | "gate" | "supervisor" | "judge"

export interface Slot {
  readonly id: SessionId
  readonly role: Role
  readonly profile: Profile
  /** The gates this session is responsible for; one for a gate session, all of them otherwise. */
  readonly gates: NonEmptyReadonlyArray<Gate>
}

export interface Branch {
  readonly gates: NonEmptyReadonlyArray<Slot>
  readonly supervisor: Slot
}

export type ReviewPlan =
  | { readonly shape: "single"; readonly reviewer: Slot }
  | { readonly shape: "gated"; readonly branch: Branch }
  | { readonly shape: "dual"; readonly branches: readonly [Branch, Branch]; readonly judge: Slot }

export const Severity = Schema.Literals(["blocker", "advisory"])
export type Severity = typeof Severity.Type

export interface ModelFinding {
  readonly gate: string
  readonly severity: Severity
  readonly location: { readonly path: string; readonly line: number } | null
  readonly title: string
  readonly body: string
}

export interface Finding extends ModelFinding {
  readonly id: FindingId
  readonly origin: SessionId
}

const Line = Schema.Int.check(Schema.isGreaterThanOrEqualTo(1))

const modelFinding = (gates: NonEmptyReadonlyArray<Gate>) =>
  Schema.Struct({
    gate: Schema.Literals(gates.map((g) => g.name)),
    severity: Severity,
    location: Schema.NullOr(Schema.Struct({ path: Schema.String, line: Line })),
    title: Schema.String,
    body: Schema.String
  })

export const reviewOutput = (gates: NonEmptyReadonlyArray<Gate>) =>
  Schema.Struct({
    summary: Schema.String,
    findings: Schema.Array(modelFinding(gates)),
    limitations: Schema.Array(Schema.String)
  })
export type ReviewOutput = {
  readonly summary: string
  readonly findings: ReadonlyArray<ModelFinding>
  readonly limitations: ReadonlyArray<string>
}

const Decision = Schema.Struct({ id: Schema.String, keep: Schema.Boolean, reason: Schema.String })

/** A supervisor may add findings the gates missed; the judge only rules on what the branches produced. */
export const synthesisOutput = (gates: NonEmptyReadonlyArray<Gate>, role: "supervisor" | "judge") =>
  role === "supervisor"
    ? Schema.Struct({
      summary: Schema.String,
      decisions: Schema.Array(Decision),
      added: Schema.Array(modelFinding(gates)),
      limitations: Schema.Array(Schema.String)
    })
    : Schema.Struct({
      summary: Schema.String,
      decisions: Schema.Array(Decision),
      limitations: Schema.Array(Schema.String)
    })
export interface SynthesisOutput {
  readonly summary: string
  readonly decisions: ReadonlyArray<{ readonly id: string; readonly keep: boolean; readonly reason: string }>
  readonly added?: ReadonlyArray<ModelFinding>
  readonly limitations: ReadonlyArray<string>
}

export type JsonSchema = { readonly [key: string]: unknown }

/** The JSON Schema a harness hands to the model as its structured-output contract. */
export const outputJsonSchema = (schema: Schema.Constraint): JsonSchema => {
  const document = Schema.toJsonSchemaDocument(schema, { onExcessProperty: "error" })
  return Object.keys(document.definitions).length === 0
    ? document.schema
    : { ...document.schema, $defs: document.definitions }
}

export interface Usage {
  readonly inputTokens: number | null
  readonly cachedInputTokens: number | null
  readonly outputTokens: number | null
  readonly reasoningTokens: number | null
  /** As reported by the vendor, which may call it an estimate; null when the vendor reports none. */
  readonly costUsd: number | null
}

export interface SessionRecord {
  readonly slot: Slot
  readonly reportedModel: string | null
  readonly vendorSessionId: string | null
  readonly usage: Usage
  /** Null when the session failed before reporting any. */
  readonly toolCalls: number | null
  readonly durationMs: number
  /** Why the session failed (a harness error kind, or `invalid-output`); null when it succeeded. */
  readonly failure: string | null
}

/** What the sessions produced. A review that could not finish is never read as a pass. */
export type Outcome =
  | {
    readonly kind: "complete"
    readonly summary: string
    readonly findings: ReadonlyArray<Finding>
    readonly limitations: ReadonlyArray<string>
  }
  | { readonly kind: "incomplete"; readonly session: SessionId; readonly reason: string }

export type Verdict = "PASS" | "CHANGES REQUESTED" | "BLOCKED" | "SUPERSEDED"

export type GateStatus = "pass" | "changes requested" | "not assessed"

export interface Review {
  readonly snapshot: MrSnapshot
  readonly classification: Classification
  readonly plan: ReviewPlan
  readonly sessions: ReadonlyArray<SessionRecord>
  readonly outcome: Outcome
  readonly verdict: Verdict
  readonly configDigest: string
  /** Set only when the head moved after the snapshot. */
  readonly liveHead: Sha | null
}

export interface Marker {
  readonly iid: number
  readonly head: Sha
  readonly configDigest: string
  readonly verdict: Verdict
}

export interface LabelMap {
  readonly inProgress: string | null
  readonly pass: string | null
  readonly changesRequested: string | null
  readonly blocked: string | null
}

export interface LabelTransition {
  readonly add: ReadonlyArray<string>
  readonly remove: ReadonlyArray<string>
}
