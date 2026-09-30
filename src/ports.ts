import { Context, type Duration, type Effect, Schema, type Scope } from "effect"
import type {
  Change,
  CommandNotes,
  CommentThread,
  DiffAnchor,
  Discussions,
  DiscussionId,
  Dismissal,
  JsonSchema,
  LabelTransition,
  LimitReading,
  Marker,
  MrRef,
  MrSnapshot,
  NoteId,
  PriorReview,
  Sha,
  Slot,
  Thread,
  Usage
} from "./domain.ts"

export class ForgeError extends Schema.TaggedError<ForgeError>()("ForgeError", {
  operation: Schema.String,
  detail: Schema.String
}) {
  override get message() {
    return `${this.operation}: ${this.detail}`
  }
}

/** The forge could not give a complete diff; a partial snapshot never reaches a model. */
export class IncompleteSnapshot extends Schema.TaggedError<IncompleteSnapshot>()("IncompleteSnapshot", {
  reason: Schema.String
}) {
  override get message() {
    return `the merge request diff is incomplete: ${this.reason}`
  }
}

export interface ReportNote {
  readonly id: NoteId
  readonly marker: Marker
  /** Null when the note records no finished review, for example after a BLOCKED one. */
  readonly prior: PriorReview | null
}

/** The three commits a review can read: the merge request head, the target branch tip, and their merge base. */
export const TREE_REFS = ["source", "target", "base"] as const
export type TreeRef = typeof TREE_REFS[number]

/**
 * A local bare repository holding the three commits with their history, and one read-only working tree per commit.
 * Harnesses read source from here, never from the forge.
 */
export interface SourceCheckout {
  readonly gitDir: string
  readonly commits: Readonly<Record<TreeRef, Sha>>
  readonly trees: Readonly<Record<TreeRef, string>>
}

/** What a discussion list belongs to: the merge request under review, or an issue by its project path and iid. */
export type Noteable =
  | { readonly kind: "merge_request"; readonly ref: MrRef }
  | { readonly kind: "issue"; readonly project: string; readonly iid: number }

export interface ForgeShape {
  readonly snapshot: (ref: MrRef) => Effect.Effect<MrSnapshot, ForgeError | IncompleteSnapshot>
  readonly live: (ref: MrRef) => Effect.Effect<{ readonly head: Sha; readonly labels: ReadonlyArray<string> }, ForgeError>
  /** The configured bot's note that carries a Heron marker; the lowest note id when there are several. */
  readonly findReport: (ref: MrRef) => Effect.Effect<ReportNote | null, ForgeError>
  readonly createNote: (ref: MrRef, body: string) => Effect.Effect<NoteId, ForgeError>
  readonly updateNote: (ref: MrRef, note: NoteId, body: string) => Effect.Effect<void, ForgeError>
  readonly updateLabels: (ref: MrRef, transition: LabelTransition) => Effect.Effect<void, ForgeError>
  /** The discussions whose first note the configured bot wrote with a fingerprint, lowest first note id first. */
  readonly findThreads: (ref: MrRef) => Effect.Effect<ReadonlyArray<Thread>, ForgeError>
  /** Starts a discussion on one line of the merge request diff at `revision`. */
  readonly createThread: (ref: MrRef, revision: MrSnapshot["revision"], anchor: DiffAnchor, body: string) => Effect.Effect<DiscussionId, ForgeError>
  readonly updateThreadNote: (ref: MrRef, thread: DiscussionId, note: NoteId, body: string) => Effect.Effect<void, ForgeError>
  readonly replyToThread: (ref: MrRef, thread: DiscussionId, body: string) => Effect.Effect<void, ForgeError>
  readonly resolveThread: (ref: MrRef, thread: DiscussionId, resolved: boolean) => Effect.Effect<void, ForgeError>
  /**
   * Every discussion on `noteable`, without system notes, internal notes, Heron's own report and blocker notes, and notes by
   * `skipAuthors`. A thread left with no note is dropped.
   */
  readonly discussions: (noteable: Noteable) => Effect.Effect<ReadonlyArray<CommentThread>, ForgeError>
  /** The changes from `from` to `to`; null when `from` is not an ancestor of `to` or the forge cannot give the whole diff. */
  readonly delta: (ref: MrRef, from: Sha, to: Sha) => Effect.Effect<ReadonlyArray<Change> | null, ForgeError>
  readonly checkout: (ref: MrRef, revision: MrSnapshot["revision"]) => Effect.Effect<SourceCheckout, ForgeError, Scope.Scope>
  /** The iids of the configured project's open merge requests updated at or after `updatedAfter`, an ISO 8601 time. */
  readonly openMergeRequests: (updatedAfter: string) => Effect.Effect<ReadonlyArray<number>, ForgeError>
  /**
   * The notes created at or after `createdAfter` whose first line starts with `@heron`, by anyone but the configured bot,
   * outside internal notes, with whether the bot has awarded each an emoji; and the users the bot's replies say it denied.
   */
  readonly commandNotes: (ref: MrRef, createdAfter: string) => Effect.Effect<CommandNotes, ForgeError>
  /**
   * Awards `emoji` to a note as the bot. True only when this call's award is the bot's first `emoji` on the note, so of two
   * polls racing on one note exactly one wins; false when the bot had awarded it already.
   */
  readonly claim: (ref: MrRef, note: NoteId, emoji: string) => Effect.Effect<boolean, ForgeError>
  /** The dismissals recorded in the configured bot's notes on the merge request, oldest first. */
  readonly dismissals: (ref: MrRef) => Effect.Effect<ReadonlyArray<Dismissal>, ForgeError>
}

export class Forge extends Context.Service<Forge, ForgeShape>()("heron/Forge") {}

export interface HarnessRequest {
  /** Carries the harness key, model and effort to run with. */
  readonly slot: Slot
  readonly instructions: string
  readonly prompt: string
  readonly source: SourceCheckout
  /** The comment threads `read_discussions` serves, read by the parent once per review; the session never reaches the forge. */
  readonly discussions: Discussions
  readonly outputSchema: JsonSchema
  /** Null means no turn limit; an operator opt-in only. */
  readonly maxTurns: number | null
  /** Null means no wall-clock limit; an operator opt-in only. */
  readonly timeout: Duration.Duration | null
}

export interface HarnessResult {
  /** Decoded by the core against the slot's output schema; never trusted as typed. */
  readonly output: unknown
  readonly reportedModel: string | null
  readonly vendorSessionId: string | null
  readonly usage: Usage
  readonly toolCalls: number
  /** A usage-limit warning the vendor gave during the session, such as a window nearly used up. */
  readonly limitWarning?: string
}

export class HarnessError extends Schema.TaggedError<HarnessError>()("HarnessError", {
  kind: Schema.Literals(["auth", "quota", "no-output", "tool-violation", "model-mismatch", "timeout", "vendor"]),
  /** Sanitized: never contains environment or token text. */
  detail: Schema.String
}) {
  override get message() {
    return `${this.kind}: ${this.detail}`
  }
}

export interface HarnessShape {
  readonly run: (request: HarnessRequest) => Effect.Effect<HarnessResult, HarnessError>
  /** The subscription's usage windows now, or why they could not be read. Absent when no harness runs on a subscription. */
  readonly limits?: Effect.Effect<LimitReading>
}

export class Harness extends Context.Service<Harness, HarnessShape>()("heron/Harness") {}
