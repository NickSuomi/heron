import { Clock, Data, Duration, Effect, Schema, Semaphore } from "effect"
import type { Config } from "./config.ts"
import {
  type Branch,
  type Finding,
  type MrRef,
  type MrSnapshot,
  type Outcome,
  outputJsonSchema,
  type Review,
  type ReviewPlan,
  reviewOutput,
  type SessionId,
  type SessionRecord,
  type Slot,
  synthesisOutput,
  type UserId
} from "./domain.ts"
import { admits, applySynthesis, assignIds, classify, labelTransition, planFor, publication, verdictOf } from "./policy.ts"
import { Forge, Harness, type SourceCheckout } from "./ports.ts"
import { findingsText, instructionsFor, packetText } from "./prompt.ts"
import { renderReport } from "./report.ts"

export class NotAdmitted extends Schema.TaggedError<NotAdmitted>()("NotAdmitted", {
  triggeredBy: Schema.NullOr(Schema.Number)
}) {
  override get message() {
    return this.triggeredBy === null
      ? "no triggering user given (--triggered-by or GITLAB_USER_ID) and admission.allowedTriggerUserIds is set"
      : `user ${this.triggeredBy} is not in admission.allowedTriggerUserIds`
  }
}

class SessionFailed extends Data.TaggedError("SessionFailed")<{ readonly session: SessionId; readonly reason: string }> {}

export interface ReviewRequest {
  readonly ref: MrRef
  readonly triggeredBy: UserId | null
  readonly publish: boolean
}

export type NoteAction =
  | { readonly kind: "dry-run" }
  | { readonly kind: "created" | "updated" | "skipped"; readonly note: number }

export interface ReviewResult {
  readonly review: Review
  readonly body: string
  readonly note: NoteAction
}

interface BranchResult {
  readonly summary: string
  readonly findings: ReadonlyArray<Finding>
  readonly limitations: ReadonlyArray<string>
}

const execute = Effect.fn("execute")(function*(config: Config, plan: ReviewPlan, snapshot: MrSnapshot, source: SourceCheckout) {
  const harness = yield* Harness
  const permits = new Map<string, Semaphore.Semaphore>()
  for (const [key, h] of Object.entries(config.harnesses)) permits.set(key, yield* Semaphore.make(h.concurrency))
  const sessions: Array<SessionRecord> = []
  const packet = packetText(snapshot)

  const run = <S extends Schema.ConstraintDecoder<unknown>>(slot: Slot, schema: S, prompt: string, access: SourceCheckout | null) =>
    Effect.gen(function*() {
      const started = yield* Clock.currentTimeMillis
      const result = yield* harness.run({
        slot,
        instructions: instructionsFor(slot, config.policy),
        prompt,
        source: access,
        outputSchema: outputJsonSchema(schema),
        maxTurns: config.limits.maxTurns,
        timeout: Duration.seconds(config.limits.sessionTimeoutSeconds)
      }).pipe(
        Effect.timeoutOrElse({
          duration: Duration.seconds(config.limits.sessionTimeoutSeconds),
          orElse: () => Effect.fail(new SessionFailed({ session: slot.id, reason: "timed out" }))
        }),
        Effect.catchTag("HarnessError", (e) => Effect.fail(new SessionFailed({ session: slot.id, reason: `${e.kind}: ${e.detail}` })))
      )
      sessions.push({
        slot,
        reportedModel: result.reportedModel,
        vendorSessionId: result.vendorSessionId,
        usage: result.usage,
        toolCalls: result.toolCalls,
        durationMs: (yield* Clock.currentTimeMillis) - started
      })
      return yield* Schema.decodeUnknownEffect(schema, { onExcessProperty: "error" })(result.output).pipe(
        Effect.mapError((e) => new SessionFailed({ session: slot.id, reason: `output did not match its schema: ${e.message}` }))
      )
    }).pipe(permits.get(slot.profile.harness)!.withPermits(1))

  const synthesize = (inputs: ReadonlyArray<Finding>, out: Parameters<typeof applySynthesis>[1], slot: Slot) =>
    Effect.fromResult(applySynthesis(inputs, out, slot.id)).pipe(
      Effect.mapError((e) =>
        new SessionFailed({
          session: slot.id,
          reason: `decisions do not cover the findings exactly once (missing ${e.missing.join(", ") || "none"}; duplicated ${e.duplicated.join(", ") || "none"}; unknown ${e.unknown.join(", ") || "none"})`
        })
      )
    )

  const runBranch = (branch: Branch) =>
    Effect.gen(function*() {
      const outputs = yield* Effect.forEach(branch.gates, (slot) =>
        run(slot, reviewOutput(slot.gates), packet, source).pipe(Effect.map((out) => ({ slot, out }))), { concurrency: "unbounded" })
      const inputs = outputs.flatMap(({ out, slot }) => assignIds(slot.id, out.findings))
      const sup = branch.supervisor
      const out = yield* run(sup, synthesisOutput(sup.gates, "supervisor"), `${packet}\n\n${findingsText("Gate findings", inputs)}`, source)
      return {
        summary: out.summary,
        findings: yield* synthesize(inputs, out, sup),
        limitations: [...outputs.flatMap(({ out }) => out.limitations), ...out.limitations]
      } satisfies BranchResult
    })

  const complete = Effect.gen(function*() {
    switch (plan.shape) {
      case "single": {
        const out = yield* run(plan.reviewer, reviewOutput(plan.reviewer.gates), packet, source)
        return { summary: out.summary, findings: assignIds(plan.reviewer.id, out.findings), limitations: out.limitations }
      }
      case "gated":
        return yield* runBranch(plan.branch)
      case "dual": {
        const [b1, b2] = yield* Effect.all([runBranch(plan.branches[0]), runBranch(plan.branches[1])], { concurrency: "unbounded" })
        const inputs = [...b1.findings, ...b2.findings]
        const judge = plan.judge
        const prompt = [packet, `## Branch 1 summary\n\n${b1.summary}`, `## Branch 2 summary\n\n${b2.summary}`, findingsText("Branch findings", inputs)].join("\n\n")
        const out = yield* run(judge, synthesisOutput(judge.gates, "judge"), prompt, null)
        return {
          summary: out.summary,
          findings: yield* synthesize(inputs, out, judge),
          limitations: [...new Set([...b1.limitations, ...b2.limitations, ...out.limitations])]
        }
      }
    }
  })
  const outcome: Outcome = yield* complete.pipe(
    Effect.map((r): Outcome => ({ kind: "complete", ...r })),
    Effect.catchTag("SessionFailed", (e) => Effect.succeed<Outcome>({ kind: "incomplete", session: e.session, reason: e.reason }))
  )
  return { sessions, outcome }
})

/** The one review pipeline; the CLI and the watcher both call it. */
export const reviewOnce = Effect.fn("reviewOnce")(function*(config: Config, request: ReviewRequest) {
  if (!admits(config.allowedTriggerUserIds, request.triggeredBy)) {
    return yield* new NotAdmitted({ triggeredBy: request.triggeredBy })
  }
  const forge = yield* Forge
  const { ref } = request
  const snapshot = yield* forge.snapshot(ref)
  const classification = classify(config, snapshot.changes)
  const plan = planFor(classification.lane)
  const head = snapshot.revision.head
  const base = { snapshot, classification, plan, configDigest: config.digest }

  const reviewed = Effect.scoped(Effect.flatMap(forge.checkout(ref, head), (source) => execute(config, plan, snapshot, source)))
  if (!request.publish) {
    const { outcome, sessions } = yield* reviewed
    const review: Review = { ...base, sessions, outcome, verdict: verdictOf(outcome), liveHead: null }
    return { review, body: renderReport(review), note: { kind: "dry-run" } } satisfies ReviewResult
  }

  const labels = config.labels
  const before = yield* forge.live(ref)
  const start = labelTransition(labels, { kind: "running" }, before.labels)
  if (start.add.length > 0) yield* forge.updateLabels(ref, start)
  const clearRunning = labels.inProgress === null ? Effect.void : forge.updateLabels(ref, { add: [], remove: [labels.inProgress] }).pipe(Effect.ignore)

  return yield* Effect.gen(function*() {
    const { outcome, sessions } = yield* reviewed
    const live = yield* forge.live(ref)
    const moved = live.head !== head
    const review: Review = { ...base, sessions, outcome, verdict: moved ? "SUPERSEDED" : verdictOf(outcome), liveHead: moved ? live.head : null }
    const body = renderReport(review)
    const existing = yield* forge.findReport(ref)
    const plan = publication(existing, review.verdict, live.head)
    const note: NoteAction = plan.kind === "create"
      ? { kind: "created", note: yield* forge.createNote(ref, body) }
      : plan.kind === "update"
      ? yield* forge.updateNote(ref, plan.note, body).pipe(Effect.as({ kind: "updated", note: plan.note } as const))
      : { kind: "skipped", note: plan.note }
    const end = plan.kind === "skip"
      ? { add: [], remove: labels.inProgress !== null && live.labels.includes(labels.inProgress) ? [labels.inProgress] : [] }
      : labelTransition(labels, { kind: "done", verdict: review.verdict }, live.labels)
    if (end.add.length + end.remove.length > 0) yield* forge.updateLabels(ref, end)
    return { review, body, note } satisfies ReviewResult
  }).pipe(Effect.onError(() => clearRunning))
})
