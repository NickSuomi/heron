import { Clock, Data, Duration, Effect, Schema, Semaphore } from "effect"
import type { Config } from "./config.ts"
import {
  type Branch,
  type Finding,
  type MrRef,
  type MrSnapshot,
  type Outcome,
  outputJsonSchema,
  type Rereview,
  type Review,
  type ReviewPlan,
  reviewOutput,
  type Ruling,
  type SessionId,
  type SessionRecord,
  type Slot,
  synthesisOutput,
  type Usage,
  type UserId
} from "./domain.ts"
import { admits, applySynthesis, assignIds, classify, labelTransition, planFor, publication, rereviewStart, verdictOf } from "./policy.ts"
import { Forge, Harness, type HarnessResult, type SourceCheckout } from "./ports.ts"
import { earlierText, findingsText, instructionsFor, packetText } from "./prompt.ts"
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

const noUsage: Usage = { inputTokens: null, cachedInputTokens: null, outputTokens: null, reasoningTokens: null, costUsd: null }

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
  readonly rulings: ReadonlyArray<Ruling>
  readonly limitations: ReadonlyArray<string>
}

/** On a re-review the gates see only the new commits, and the last session of the plan rules on the earlier findings. */
const execute = Effect.fn("execute")(function*(
  config: Config,
  plan: ReviewPlan,
  snapshot: MrSnapshot,
  source: SourceCheckout,
  rereview: Rereview | null
) {
  const harness = yield* Harness
  const permits = new Map<string, Semaphore.Semaphore>()
  for (const [key, h] of Object.entries(config.harnesses)) permits.set(key, yield* Semaphore.make(h.concurrency))
  const sessions: Array<SessionRecord> = []
  const packet = packetText(snapshot, rereview)
  const earlier = rereview?.earlier ?? []
  const withEarlier = (prompt: string, adds: boolean) => rereview === null ? prompt : `${prompt}\n\n${earlierText(rereview, adds)}`

  const run = <S extends Schema.ConstraintDecoder<unknown>>(slot: Slot, schema: S, prompt: string) =>
    Effect.gen(function*() {
      const started = yield* Clock.currentTimeMillis
      const record = (result: HarnessResult | null, failure: string | null) =>
        Effect.map(Clock.currentTimeMillis, (now) => {
          sessions.push({
            slot,
            reportedModel: result?.reportedModel ?? null,
            vendorSessionId: result?.vendorSessionId ?? null,
            usage: result?.usage ?? noUsage,
            toolCalls: result?.toolCalls ?? null,
            durationMs: now - started,
            failure
          })
        })
      const result = yield* harness.run({
        slot,
        instructions: instructionsFor(slot, config.policy),
        prompt,
        source,
        outputSchema: outputJsonSchema(schema),
        maxTurns: config.limits.maxTurns,
        timeout: config.limits.sessionTimeoutSeconds === null ? null : Duration.seconds(config.limits.sessionTimeoutSeconds)
      }).pipe(
        Effect.tapError((e) => record(null, e.kind)),
        Effect.onInterrupt(() => record(null, "interrupted")),
        Effect.mapError((e) => new SessionFailed({ session: slot.id, reason: e.message }))
      )
      return yield* Schema.decodeUnknownEffect(schema, { onExcessProperty: "error" })(result.output).pipe(
        Effect.tapError(() => record(result, "invalid-output")),
        Effect.tap(() => record(result, null)),
        Effect.mapError((e) => new SessionFailed({ session: slot.id, reason: `output did not match its schema: ${e.message}` }))
      )
    }).pipe(permits.get(slot.profile.harness)!.withPermits(1))

  const rulingsOf = (inputs: ReadonlyArray<Finding>, out: Parameters<typeof applySynthesis>[1], slot: Slot): ReadonlyArray<Ruling> =>
    out.decisions.map((d) => ({ by: slot.id, finding: inputs.find((f) => f.id === d.id)!, ruling: d.ruling, reason: d.reason }))

  const synthesize = (inputs: ReadonlyArray<Finding>, out: Parameters<typeof applySynthesis>[1], slot: Slot) =>
    Effect.fromResult(applySynthesis(inputs, out, slot.id)).pipe(
      Effect.mapError((e) =>
        new SessionFailed({
          session: slot.id,
          reason: `decisions do not cover the findings exactly once (missing ${e.missing.join(", ") || "none"}; duplicated ${e.duplicated.join(", ") || "none"}; unknown ${e.unknown.join(", ") || "none"})`
        })
      )
    )

  const runBranch = (branch: Branch, last: boolean) =>
    Effect.gen(function*() {
      const outputs = yield* Effect.forEach(branch.gates, (slot) =>
        run(slot, reviewOutput(slot.gates), packet).pipe(Effect.map((out) => ({ slot, out }))), { concurrency: "unbounded" })
      const found = outputs.flatMap(({ out, slot }) => assignIds(slot.id, out.findings))
      const inputs = last ? [...found, ...earlier] : found
      const sup = branch.supervisor
      const gateFindings = `${packet}\n\n${findingsText("Gate findings", found)}`
      const out = yield* run(sup, synthesisOutput(sup.gates, "supervisor"), last ? withEarlier(gateFindings, false) : gateFindings)
      return {
        summary: out.summary,
        findings: yield* synthesize(inputs, out, sup),
        rulings: rulingsOf(inputs, out, sup),
        limitations: [...outputs.flatMap(({ out }) => out.limitations), ...out.limitations]
      } satisfies BranchResult
    })

  const complete = Effect.gen(function*() {
    switch (plan.shape) {
      case "single": {
        const reviewer = plan.reviewer
        if (rereview === null) {
          const out = yield* run(reviewer, reviewOutput(reviewer.gates), packet)
          return { summary: out.summary, findings: assignIds(reviewer.id, out.findings), rulings: [], limitations: out.limitations }
        }
        const out = yield* run(reviewer, synthesisOutput(reviewer.gates, "supervisor"), withEarlier(packet, true))
        return {
          summary: out.summary,
          findings: yield* synthesize(earlier, out, reviewer),
          rulings: rulingsOf(earlier, out, reviewer),
          limitations: out.limitations
        }
      }
      case "gated":
        return yield* runBranch(plan.branch, true)
      case "dual": {
        const [b1, b2] = yield* Effect.all([runBranch(plan.branches[0], false), runBranch(plan.branches[1], false)], { concurrency: "unbounded" })
        const found = [...b1.findings, ...b2.findings]
        const inputs = [...found, ...earlier]
        const judge = plan.judge
        const prompt = [packet, `## Branch 1 summary\n\n${b1.summary}`, `## Branch 2 summary\n\n${b2.summary}`, findingsText("Branch findings", found)].join("\n\n")
        const out = yield* run(judge, synthesisOutput(judge.gates, "judge"), withEarlier(prompt, false))
        return {
          summary: out.summary,
          findings: yield* synthesize(inputs, out, judge),
          rulings: [...b1.rulings, ...b2.rulings, ...rulingsOf(inputs, out, judge)],
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
  // A dry run reads the earlier note too, so it takes the same path as the published run would.
  const resumable = rereviewStart(yield* forge.findReport(ref), { digest: config.digest, lane: classification.lane, revision: snapshot.revision })
  // A forge that cannot compare the heads, for example because a force push removed the old one, means a full review.
  const rereview: Rereview | null = resumable === null ? null : yield* forge.delta(ref, resumable.from, head).pipe(
    Effect.map((changes) => changes === null ? null : { ...resumable, changes }),
    Effect.orElseSucceed(() => null)
  )
  const base = { snapshot, classification, plan, configDigest: config.digest, rereview }

  const reviewed = Effect.scoped(Effect.flatMap(forge.checkout(ref, snapshot.revision), (source) => execute(config, plan, snapshot, source, rereview)))
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
