import { Context, type Duration, type Effect, Schema, type Scope } from "effect"
import type { JsonSchema, LabelTransition, Marker, MrRef, MrSnapshot, NoteId, Sha, Slot, Usage } from "./domain.ts"

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
}

/** A local git directory holding exactly `commit`; harnesses read source from here, never from the forge. */
export interface SourceCheckout {
  readonly gitDir: string
  readonly commit: Sha
}

export interface ForgeShape {
  readonly snapshot: (ref: MrRef) => Effect.Effect<MrSnapshot, ForgeError | IncompleteSnapshot>
  readonly live: (ref: MrRef) => Effect.Effect<{ readonly head: Sha; readonly labels: ReadonlyArray<string> }, ForgeError>
  /** The configured bot's note that carries a Heron marker; the lowest note id when there are several. */
  readonly findReport: (ref: MrRef) => Effect.Effect<ReportNote | null, ForgeError>
  readonly createNote: (ref: MrRef, body: string) => Effect.Effect<NoteId, ForgeError>
  readonly updateNote: (ref: MrRef, note: NoteId, body: string) => Effect.Effect<void, ForgeError>
  readonly updateLabels: (ref: MrRef, transition: LabelTransition) => Effect.Effect<void, ForgeError>
  readonly checkout: (ref: MrRef, head: Sha) => Effect.Effect<SourceCheckout, ForgeError, Scope.Scope>
}

export class Forge extends Context.Service<Forge, ForgeShape>()("heron/Forge") {}

export interface HarnessRequest {
  /** Carries the harness key, model and effort to run with. */
  readonly slot: Slot
  readonly instructions: string
  readonly prompt: string
  /** Null for the judge, which rules on findings without repository access. */
  readonly source: SourceCheckout | null
  readonly outputSchema: JsonSchema
  readonly maxTurns: number
  readonly timeout: Duration.Duration
}

export interface HarnessResult {
  /** Decoded by the core against the slot's output schema; never trusted as typed. */
  readonly output: unknown
  readonly reportedModel: string | null
  readonly vendorSessionId: string | null
  readonly usage: Usage
  readonly toolCalls: number
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
}

export class Harness extends Context.Service<Harness, HarnessShape>()("heron/Harness") {}
