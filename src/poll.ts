import { Clock, Duration, Effect, Option, Schema } from "effect"
import type { Config } from "./config.ts"
import { answerOutput, type Command, type CommandNote, type MemoryWrite, type MrRef, type NoteId, outputJsonSchema, type UserId } from "./domain.ts"
import { answererOf, classify, dismissedMemory, learnedMemory, planCommands, type PlannedCommand, planFor } from "./policy.ts"
import { Forge, Harness, Memory } from "./ports.ts"
import { instructionsFor, questionText } from "./prompt.ts"
import {
  DISMISS_REASON,
  DISMISS_WHERE,
  HELP,
  LEARN_RULE,
  NO_MEMORY,
  renderAnswer,
  renderConfiguration,
  renderDenied,
  renderDismissed,
  renderFailed,
  renderResolveDone,
  renderResolvedThread,
  renderReviewed,
  renderStored
} from "./report.ts"
import { MEMORY_TIMEOUT, readDiscussions, reviewOnce } from "./review.ts"

export class PollRefused extends Schema.TaggedError<PollRefused>()("PollRefused", {}) {
  override get message() {
    return "heron poll needs admission.allowedTriggerUserIds: without it anyone who can comment could run Heron"
  }
}

/** The bot's emoji on a note it took; a note with any emoji from the bot is handled. */
export const CLAIM_EMOJI = "eyes"
/** The emoji on a later note from a user Heron already told once that they may not command it. */
export const DENIED_EMOJI = "no_entry_sign"

export interface PollRequest {
  readonly sinceMinutes: number
  /** List the planned actions only: no emoji, no reply, no review, no model session. */
  readonly dryRun: boolean
}

/** One action of a poll; `note` is null for a merge request whose notes could not be read. */
export interface PollLine {
  readonly iid: number
  readonly note: NoteId | null
  readonly command: string
  readonly result: string
  readonly failed: boolean
}

export const pollLineText = (l: PollLine): string => `!${l.iid}${l.note === null ? "" : ` note ${l.note}`} ${l.command}: ${l.result}`

const commandName = (planned: PlannedCommand): string => planned.kind === "deny" ? "denied" : planned.command.kind

interface Done {
  /** Posted in the command's discussion. */
  readonly reply: string
  readonly result: string
  readonly failed: boolean
}

const reason = (e: { readonly message: string }): string => e.message

/** The one model session that answers a question, with the review's packet, tools and discussions, and the lane's last profile. */
const answer = (config: Config, ref: MrRef, note: CommandNote, question: string) =>
  Effect.gen(function*() {
    const forge = yield* Forge
    const harness = yield* Harness
    const snapshot = yield* forge.snapshot(ref)
    const slot = answererOf(planFor(classify(config, snapshot.changes).lane))
    const discussions = yield* readDiscussions(snapshot)
    const result = yield* Effect.scoped(Effect.flatMap(forge.checkout(ref, snapshot.revision), (source) =>
      harness.run({
        slot,
        instructions: instructionsFor(slot, config.policy, false),
        prompt: questionText(snapshot, note.thread, question),
        source,
        discussions,
        outputSchema: outputJsonSchema(answerOutput),
        maxTurns: config.limits.maxTurns,
        timeout: config.limits.sessionTimeoutSeconds === null ? null : Duration.seconds(config.limits.sessionTimeoutSeconds)
      })))
    const out = yield* Schema.decodeUnknownEffect(answerOutput, { onExcessProperty: "error" })(result.output).pipe(
      Effect.mapError((e) => new Error(`the answer did not match its schema: ${e.message}`))
    )
    return { reply: renderAnswer(snapshot.revision.head, out.answer), result: `answered at ${snapshot.revision.head.slice(0, 8)}`, failed: false } satisfies Done
  })

/** Every open thread Heron started, each with a reply naming who asked. A thread the forge refuses is counted, not fatal. */
const resolveAll = (ref: MrRef, by: string) =>
  Effect.gen(function*() {
    const forge = yield* Forge
    const open = (yield* forge.findThreads(ref)).filter((t) => !t.resolved)
    const results = yield* Effect.forEach(open, (t) =>
      Effect.result(Effect.andThen(forge.replyToThread(ref, t.id, renderResolvedThread(by)), forge.resolveThread(ref, t.id, true))))
    const failed = results.filter((r) => r._tag === "Failure").length
    const resolved = results.length - failed
    return {
      reply: renderResolveDone(resolved, failed),
      result: `${resolved} resolved${failed === 0 ? "" : `, ${failed} failed`}`,
      failed: failed > 0
    } satisfies Done
  })

/**
 * Writes one memory an allowed user's command asked for, and says what it stored. Null when no team memory is configured.
 * A store that fails or is slow is a reply saying nothing was stored; the command it came with still counts.
 */
const remember = (write: (date: string) => MemoryWrite, kind: "rule" | "reason") =>
  Effect.gen(function*() {
    const memory = yield* Effect.serviceOption(Memory)
    if (Option.isNone(memory)) return null
    const store = memory.value
    const entry = write(new Date(yield* Clock.currentTimeMillis).toISOString())
    const failure = yield* store.retain(entry).pipe(
      Effect.as(null),
      Effect.timeoutOrElse({ duration: MEMORY_TIMEOUT, orElse: () => Effect.succeed(`no answer within ${Duration.format(MEMORY_TIMEOUT)}`) }),
      Effect.catch((e) => Effect.succeed(e.message))
    )
    return { reply: renderStored(kind, store.bank, entry.text, failure), failure }
  })

const run = (config: Config, ref: MrRef, note: CommandNote, command: Command) =>
  Effect.gen(function*() {
    const forge = yield* Forge
    switch (command.kind) {
      case "review":
      case "full review": {
        const r = yield* reviewOnce(config, { ref, triggeredBy: note.author.id, publish: true, full: command.kind === "full review" })
        const noteId = r.note.kind === "dry-run" ? null : r.note.note
        const failed = r.threads.results.filter((t) => t.failure !== null).length
        const threads = r.threads.unlisted !== null ? ", threads not listed" : failed > 0 ? `, ${failed} thread writes failed` : ""
        return {
          reply: renderReviewed(r.review.verdict, r.review.snapshot.revision.head, noteId === null ? null : `${r.review.snapshot.webUrl}#note_${noteId}`),
          result: `${r.review.verdict}, report note ${noteId} ${r.note.kind}${threads}`,
          failed: threads !== ""
        } satisfies Done
      }
      case "resolve":
        return yield* resolveAll(ref, note.author.username)
      case "dismiss": {
        if (note.blocker === null) return { reply: DISMISS_WHERE, result: "not in a Heron blocker thread", failed: false } satisfies Done
        if (command.reason === "") return { reply: DISMISS_REASON, result: "no reason given", failed: false } satisfies Done
        // The reply is the record later reviews read, so it goes first; resolving is the visible half.
        yield* forge.replyToThread(ref, note.discussion, renderDismissed({ fingerprint: note.blocker, by: note.author.username, reason: command.reason }))
        yield* forge.resolveThread(ref, note.discussion, true)
        const result = `dismissed ${note.blocker.gate} in ${note.blocker.path}`
        const blocker = note.blocker
        const stored = yield* remember((date) => dismissedMemory(ref, note, blocker, command.reason, date), "reason")
        if (stored === null) return { reply: "", result, failed: false } satisfies Done
        return {
          reply: stored.reply,
          result: `${result}, ${stored.failure === null ? "stored in memory" : `memory failed: ${stored.failure}`}`,
          failed: stored.failure !== null
        } satisfies Done
      }
      case "learn": {
        if (command.rule === "") return { reply: LEARN_RULE, result: "no rule given", failed: false } satisfies Done
        const stored = yield* remember((date) => learnedMemory(ref, note, command.rule, date), "rule")
        if (stored === null) return { reply: NO_MEMORY, result: "no team memory configured", failed: false } satisfies Done
        return {
          reply: stored.reply,
          result: stored.failure === null ? "stored in memory" : `memory failed: ${stored.failure}`,
          failed: stored.failure !== null
        } satisfies Done
      }
      case "help":
        return { reply: HELP, result: "replied", failed: false } satisfies Done
      case "configuration":
        return { reply: renderConfiguration(config), result: "replied", failed: false } satisfies Done
      case "question":
        return yield* answer(config, ref, note, command.text)
    }
  })

/** Claim, act, reply. A claim another poll won means that poll acts; this one leaves the note alone. */
const handle = (config: Config, ref: MrRef, planned: PlannedCommand, dryRun: boolean) =>
  Effect.gen(function*() {
    const forge = yield* Forge
    const { note } = planned
    const line = (result: string, failed: boolean): PollLine => ({ iid: ref.iid, note: note.id, command: commandName(planned), result, failed })
    if (dryRun) return line(planned.kind === "deny" ? `planned, ${planned.reply ? "reply once" : "mark only"}` : "planned", false)
    const emoji = planned.kind === "deny" && !planned.reply ? DENIED_EMOJI : CLAIM_EMOJI
    const claimed = yield* Effect.result(forge.claim(ref, note.id, emoji))
    if (claimed._tag === "Failure") return line(`claim failed: ${reason(claimed.failure)}`, true)
    if (!claimed.success) return line("skipped, another poll took it", false)
    if (planned.kind === "deny") {
      if (!planned.reply) return line("marked", false)
      return yield* forge.replyToThread(ref, note.discussion, renderDenied(note.author.id)).pipe(
        Effect.match({ onFailure: (e) => line(`reply failed: ${reason(e)}`, true), onSuccess: () => line("replied once", false) })
      )
    }
    const done = yield* Effect.result(run(config, ref, note, planned.command))
    if (done._tag === "Failure") {
      // The note stays claimed, so no later poll repeats a command that may have half run; the thread says it failed.
      const why = reason(done.failure)
      yield* Effect.ignore(forge.replyToThread(ref, note.discussion, renderFailed(planned.command.kind, why)))
      return line(`failed: ${why}`, true)
    }
    const { failed, reply, result } = done.success
    if (reply === "") return line(result, failed)
    return yield* forge.replyToThread(ref, note.discussion, reply).pipe(
      Effect.match({ onFailure: (e) => line(`${result}, reply failed: ${reason(e)}`, true), onSuccess: () => line(result, failed) })
    )
  })

/** One merge request: its commands run in note order, one at a time. A list the forge refuses is one failed line. */
const pollMergeRequest = (config: Config, allowed: ReadonlyArray<UserId>, iid: number, since: string, dryRun: boolean) =>
  Effect.gen(function*() {
    const forge = yield* Forge
    const ref: MrRef = { project: config.forge.project, iid }
    const listed = yield* Effect.result(forge.commandNotes(ref, since))
    if (listed._tag === "Failure") return [{ iid, note: null, command: "list", result: `failed: ${reason(listed.failure)}`, failed: true }] satisfies ReadonlyArray<PollLine>
    return yield* Effect.forEach(planCommands(allowed, listed.success), (planned) => handle(config, ref, planned, dryRun))
  })

/**
 * Looks for new `@heron` commands on the configured project's merge requests updated in the window, and acts on each one
 * from an allowed user. Every action is claimed with an emoji first, so overlapping polls act once and a second poll over
 * the same notes does nothing. Each failure is a line; the poll goes on with the rest.
 */
export const pollOnce = Effect.fn("pollOnce")(function*(config: Config, request: PollRequest) {
  const allowed = config.allowedTriggerUserIds
  if (allowed === null) return yield* new PollRefused()
  const forge = yield* Forge
  const now = yield* Clock.currentTimeMillis
  const since = new Date(now - request.sinceMinutes * 60_000).toISOString()
  const iids = yield* forge.openMergeRequests(since)
  const lines = yield* Effect.forEach(iids, (iid) => pollMergeRequest(config, allowed, iid, since, request.dryRun), { concurrency: config.poll.concurrency })
  return lines.flat()
})
