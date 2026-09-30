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

export interface LinkedIssue {
  /** GitLab's full reference, for example `group/app#12`. */
  readonly reference: string
  readonly relation: "closes" | "related"
  readonly title: string
  readonly description: string
  readonly state: string
  readonly webUrl: string
}

export interface FailedJob {
  readonly name: string
  readonly stage: string
  readonly webUrl: string
  /** The last lines of the job log, with ANSI codes and known secrets removed. */
  readonly logTail: string
}

/** The merge request's head pipeline as GitLab reported it when the snapshot was taken. */
export interface PipelineContext {
  readonly id: number
  readonly status: string
  readonly webUrl: string
  readonly failedJobs: ReadonlyArray<FailedJob>
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
  /** `head` is the source branch commit, `start` the target branch tip the diff was taken against, `base` their merge base. */
  readonly revision: { readonly base: Sha; readonly start: Sha; readonly head: Sha }
  readonly changes: ReadonlyArray<Change>
  readonly issues: ReadonlyArray<LinkedIssue>
  readonly pipeline: PipelineContext | null
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
  /** The session that reported it, or `earlier` for a finding an earlier review kept. */
  readonly origin: SessionId
}

export type LocatedFinding = Finding & { readonly location: NonNullable<Finding["location"]> }

const Line = Schema.Int.check(Schema.isGreaterThanOrEqualTo(1))

const described = (description: string) => Schema.String.annotate({ description })
const summary = described("At most two plain sentences on what the change does. Say nothing about what to fix or do before merging: Heron writes that line from the findings.")
const limitations = Schema.Array(described("One sentence naming something in the repository or the merge request you could not check."))

const modelFinding = (gates: NonEmptyReadonlyArray<Gate>) =>
  Schema.Struct({
    gate: Schema.Literals(gates.map((g) => g.name)),
    severity: Severity,
    location: Schema.NullOr(Schema.Struct({ path: Schema.String, line: Line })),
    title: described("At most 12 words naming the defect."),
    body: described("At most two sentences: what is wrong and the fix.")
  })

export const reviewOutput = (gates: NonEmptyReadonlyArray<Gate>) =>
  Schema.Struct({
    summary,
    findings: Schema.Array(modelFinding(gates)),
    limitations
  })
export type ReviewOutput = {
  readonly summary: string
  readonly findings: ReadonlyArray<ModelFinding>
  readonly limitations: ReadonlyArray<string>
}

/** A ruling can lower a finding to advisory but never raise one to blocker: a blocker needs a finding that claims it. */
export const RulingKind = Schema.Literals(["keep", "keep as advisory", "drop"])
export type RulingKind = typeof RulingKind.Type

const Decision = Schema.Struct({
  id: Schema.String,
  ruling: RulingKind.annotate({ description: "`keep` a real defect at its severity, `keep as advisory` a real defect that does not block, `drop` one that is not real." }),
  reason: described("One sentence on why the finding is or is not a real defect at the reviewed head, and for `keep as advisory` why it does not block.")
})

/** A supervisor may add findings the gates missed; the judge only rules on what the branches produced. */
export const synthesisOutput = (gates: NonEmptyReadonlyArray<Gate>, role: "supervisor" | "judge") =>
  role === "supervisor"
    ? Schema.Struct({
      summary,
      decisions: Schema.Array(Decision),
      added: Schema.Array(modelFinding(gates)),
      limitations
    })
    : Schema.Struct({
      summary,
      decisions: Schema.Array(Decision),
      limitations
    })
export interface SynthesisOutput {
  readonly summary: string
  readonly decisions: ReadonlyArray<{ readonly id: string; readonly ruling: RulingKind; readonly reason: string }>
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
  /** Why the session failed (a harness error kind, `invalid-output`, or `interrupted` when a sibling's failure stopped it); null when it succeeded. */
  readonly failure: string | null
}

/** A supervisor's or judge's ruling on one finding it was given. */
export interface Ruling {
  readonly by: SessionId
  /** The finding as it was given, with the severity its session claimed. */
  readonly finding: Finding
  readonly ruling: RulingKind
  readonly reason: string
}

/** What the sessions produced. A review that could not finish is never read as a pass. */
export type Outcome =
  | {
    readonly kind: "complete"
    readonly summary: string
    readonly findings: ReadonlyArray<Finding>
    readonly rulings: ReadonlyArray<Ruling>
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
  readonly rereview: Rereview | null
  /** Null when no harness runs on a Claude subscription. */
  readonly subscription: SubscriptionUse | null
}

/** One usage window of a Claude subscription, in the whole percent Claude reports. */
export interface LimitWindow {
  readonly window: "five-hour" | "weekly"
  readonly percent: number
  readonly resetsAt: string | null
}

/** The subscription's windows before and after a review, and the usage-limit warnings Claude Code gave during it. */
export interface SubscriptionUse {
  /** Null when the reading failed. */
  readonly before: ReadonlyArray<LimitWindow> | null
  readonly after: ReadonlyArray<LimitWindow> | null
  readonly warnings: ReadonlyArray<string>
}

/** A re-review: since Heron's review at `from`, the source branch only gained commits and the target branch did not move. */
export interface Rereview {
  readonly from: Sha
  /** The changes from `from` to the head. */
  readonly changes: ReadonlyArray<Change>
  /** The findings the review at `from` kept, for the last session of the plan to rule on again. */
  readonly earlier: ReadonlyArray<Finding>
}

/** What a finished review records in its note, next to the marker, so the next run can review only newer commits. */
export const PriorReview = Schema.Struct({
  base: Sha,
  start: Sha,
  lane: Schema.String,
  findings: Schema.Array(Schema.Struct({
    gate: Schema.String,
    severity: Severity,
    location: Schema.NullOr(Schema.Struct({ path: Schema.String, line: Line })),
    title: Schema.String,
    body: Schema.String
  }))
})
export type PriorReview = typeof PriorReview.Type

export interface Marker {
  readonly iid: number
  readonly head: Sha
  readonly configDigest: string
  readonly verdict: Verdict
}

/** GitLab's id of a discussion on a merge request, a hex string. */
export const DiscussionId = Schema.String.check(Schema.isPattern(/^[0-9a-f]+$/)).pipe(Schema.brand("DiscussionId"))
export type DiscussionId = typeof DiscussionId.Type

/** What finds a blocker's thread again on a later run: the gate, the path, and the title in lower case with only letters and digits. */
export const Fingerprint = Schema.Struct({ gate: Schema.String, path: Schema.String, title: Schema.String })
export type Fingerprint = typeof Fingerprint.Type

/** A line of the merge request diff a discussion can sit on: an added line (`oldLine` null) or an unchanged line inside a hunk. */
export interface DiffAnchor {
  readonly oldPath: string
  readonly newPath: string
  readonly newLine: number
  readonly oldLine: number | null
}

/** A discussion whose first note the configured bot wrote with a fingerprint. */
export interface Thread {
  readonly id: DiscussionId
  /** The first note, which holds the fingerprint and the blocker. */
  readonly note: NoteId
  readonly fingerprint: Fingerprint
  readonly body: string
  readonly resolved: boolean
}

/** A blocker with a location, as a thread would show it, and where on the diff it could start one. */
export interface ThreadDraft {
  readonly finding: LocatedFinding
  readonly body: string
  readonly anchor: DiffAnchor | null
}

export type ThreadAction =
  | { readonly kind: "create"; readonly finding: LocatedFinding; readonly anchor: DiffAnchor; readonly body: string }
  | { readonly kind: "update"; readonly finding: LocatedFinding; readonly thread: Thread; readonly body: string }
  /** `body` is null when the first note already says what the review says. */
  | { readonly kind: "reopen"; readonly finding: LocatedFinding; readonly thread: Thread; readonly body: string | null }
  | { readonly kind: "resolve"; readonly thread: Thread }

export interface ThreadResult {
  readonly action: ThreadAction
  /** Why the forge refused the write; null when it succeeded or nothing was written. */
  readonly failure: string | null
}

/** What a review did to its blocker threads. `unlisted` holds why Heron could not read them, which leaves them alone. */
export interface ThreadReport {
  readonly results: ReadonlyArray<ThreadResult>
  readonly unlisted: string | null
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
