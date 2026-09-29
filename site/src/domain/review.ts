import { Array, Option, pipe, Schema } from "effect"
import { defineTaggedUnion } from "foldkit/schema"
import { labelNames } from "virtual:heron-build"

import { mr42 } from "../data/mr42"

/** Heron's four verdicts, as `src/domain.ts` spells them. */
export const Verdict = Schema.Literals(["PASS", "CHANGES REQUESTED", "BLOCKED", "SUPERSEDED"])
export type Verdict = typeof Verdict.Type

/** `--dry-run` prints the report and posts nothing; a real run posts one note and sets one label. */
export const Delivery = Schema.Literals(["DryRun", "Post"])
export type Delivery = typeof Delivery.Type

/** What the review has done so far. Every app that shows progress renders these. */
export const ReviewEvent = defineTaggedUnion({
  LoadedConfig: { digest: Schema.String },
  TookSnapshot: { head: Schema.String, fileCount: Schema.Number },
  Classified: { lane: Schema.String, shape: Schema.String, sessionCount: Schema.Number },
  StartedSession: { session: Schema.String, model: Schema.String, effort: Schema.String },
  FinishedSession: { session: Schema.String, result: Schema.String, durationMs: Schema.Number },
  ChangedLabels: { added: Schema.Array(Schema.String), removed: Schema.Array(Schema.String), labels: Schema.Array(Schema.String) },
  PostedNote: { noteId: Schema.Number, action: Schema.Literals(["created", "updated"]) },
  Finished: { verdict: Verdict },
})
export type ReviewEvent = typeof ReviewEvent.Type

/**
 * The one review of the fictional merge request acme/storefront !42 that every app shares. `run` counts the
 * reviews started since boot. `labels` and `isReportNotePosted` are the mock merge request's live state: a dry
 * run leaves them alone, a posted run changes them while it runs.
 */
export const Review = defineTaggedUnion({
  Idle: {},
  Running: {
    mergeRequestIid: Schema.Number,
    delivery: Delivery,
    run: Schema.Number,
    /** Set by the first tick, so the simulation starts on the clock that drives it. */
    maybeStartedAt: Schema.Option(Schema.Number),
    events: Schema.Array(ReviewEvent),
    labelsBefore: Schema.Array(Schema.String),
    wasReportNotePosted: Schema.Boolean,
    labels: Schema.Array(Schema.String),
    isReportNotePosted: Schema.Boolean,
  },
  Done: {
    mergeRequestIid: Schema.Number,
    delivery: Delivery,
    run: Schema.Number,
    verdict: Verdict,
    events: Schema.Array(ReviewEvent),
    labels: Schema.Array(Schema.String),
    isReportNotePosted: Schema.Boolean,
    startedAt: Schema.Number,
    finishedAt: Schema.Number,
  },
})
export type Review = typeof Review.Type

export const exampleMergeRequestIid = mr42.iid

/** Labels the mock merge request carries before Heron has run. */
export const initialLabels: ReadonlyArray<string> = mr42.labels

/** The simulation plays a review this many times faster than the session durations in the data. */
export const speedUp = 25

type Timed = Readonly<{ atMs: number; event: ReviewEvent }>

const managed = [labelNames.inProgress, labelNames.pass, labelNames.changesRequested, labelNames.blocked].filter(
  (label): label is string => label !== null,
)

export const verdictLabel = (verdict: Verdict): string | null =>
  ({ PASS: labelNames.pass, "CHANGES REQUESTED": labelNames.changesRequested, BLOCKED: labelNames.blocked, SUPERSEDED: null })[verdict]

const changeLabels = (labels: ReadonlyArray<string>, add: ReadonlyArray<string>, remove: ReadonlyArray<string>): ReviewEvent =>
  ReviewEvent.ChangedLabels({
    added: add.filter((label) => !labels.includes(label)),
    removed: remove.filter((label) => labels.includes(label)),
    labels: [...labels.filter((label) => !remove.includes(label)), ...add.filter((label) => !labels.includes(label))],
  })

const sessionResult = (session: (typeof mr42.sessions)[number]): string =>
  session.role === "gate"
    ? `${session.findingCount} finding${session.findingCount === 1 ? "" : "s"}`
    : `${session.findingCount} findings after synthesis`

/**
 * Every event of one run and when it happens, in milliseconds from the start. Sessions keep the start times
 * and durations of the data, played `speedUp` times faster. A posted run marks the merge request in progress
 * first, then posts or updates the note and swaps the label for the verdict's, as `reviewOnce` does.
 */
export const timeline = (delivery: Delivery, labelsBefore: ReadonlyArray<string>, wasReportNotePosted: boolean): ReadonlyArray<Timed> => {
  const sessionsFrom = 1600
  const at = (ms: number) => sessionsFrom + Math.round(ms / speedUp)
  const sessionEvents = mr42.sessions.flatMap((session): ReadonlyArray<Timed> => [
    { atMs: at(session.startMs), event: ReviewEvent.StartedSession({ session: session.id, model: session.model, effort: session.effort }) },
    {
      atMs: at(session.startMs + session.durationMs),
      event: ReviewEvent.FinishedSession({ session: session.id, result: sessionResult(session), durationMs: session.durationMs }),
    },
  ])
  const end = Math.max(...sessionEvents.map((timed) => timed.atMs))
  const inProgress = labelNames.inProgress === null ? [] : [labelNames.inProgress]
  const running = changeLabels(labelsBefore, inProgress, [])
  const wanted = pipe(Option.fromNullOr(verdictLabel(mr42.verdict)), Option.toArray)
  const publish: ReadonlyArray<Timed> =
    delivery === "Post"
      ? [
          { atMs: end + 400, event: ReviewEvent.PostedNote({ noteId: mr42.noteId, action: wasReportNotePosted ? "updated" : "created" }) },
          {
            atMs: end + 700,
            event: changeLabels(running._tag === "ChangedLabels" ? running.labels : labelsBefore, wanted, managed.filter((label) => !wanted.includes(label))),
          },
        ]
      : []
  return [
    { atMs: 300, event: ReviewEvent.LoadedConfig({ digest: mr42.configDigest }) },
    { atMs: 800, event: ReviewEvent.TookSnapshot({ head: mr42.head, fileCount: mr42.files.length }) },
    { atMs: 1200, event: ReviewEvent.Classified({ lane: mr42.lane.name, shape: mr42.lane.shape, sessionCount: mr42.sessions.length }) },
    ...(delivery === "Post" ? [{ atMs: 1400, event: running }] : []),
    ...[...sessionEvents].sort((a, b) => a.atMs - b.atMs),
    ...publish,
    { atMs: end + (delivery === "Post" ? 1000 : 400), event: ReviewEvent.Finished({ verdict: mr42.verdict }) },
  ]
}

export const labelsOf = (review: Review): ReadonlyArray<string> => (review._tag === "Idle" ? initialLabels : review.labels)

export const isReportNotePosted = (review: Review): boolean => review._tag !== "Idle" && review.isReportNotePosted

export const eventsOf = (review: Review): ReadonlyArray<ReviewEvent> => (review._tag === "Idle" ? [] : review.events)

/** Starts a run unless one is already running; the merge request keeps its labels and note from earlier runs. */
export const start = (review: Review, delivery: Delivery): Review =>
  review._tag === "Running"
    ? review
    : Review.Running({
        mergeRequestIid: exampleMergeRequestIid,
        delivery,
        run: review._tag === "Done" ? review.run + 1 : 1,
        maybeStartedAt: Option.none(),
        events: [],
        labelsBefore: labelsOf(review),
        wasReportNotePosted: isReportNotePosted(review),
        labels: labelsOf(review),
        isReportNotePosted: isReportNotePosted(review),
      })

/** Moves a running review to `now`: emits every event that is due, and ends Done after the last one. */
export const advance = (review: Review, now: number): Review => {
  if (review._tag !== "Running") return review
  const startedAt = Option.getOrElse(review.maybeStartedAt, () => now)
  const all = timeline(review.delivery, review.labelsBefore, review.wasReportNotePosted)
  const events = all.filter((timed) => timed.atMs <= now - startedAt).map((timed) => timed.event)
  const labels = pipe(
    Array.findLast(events, (event) => event._tag === "ChangedLabels"),
    Option.match({ onNone: () => review.labelsBefore, onSome: (event) => (event._tag === "ChangedLabels" ? event.labels : review.labelsBefore) }),
  )
  const isPosted = review.wasReportNotePosted || events.some((event) => event._tag === "PostedNote")
  return events.length < all.length
    ? Review.Running({ ...review, maybeStartedAt: Option.some(startedAt), events, labels, isReportNotePosted: isPosted })
    : Review.Done({
        mergeRequestIid: review.mergeRequestIid,
        delivery: review.delivery,
        run: review.run,
        verdict: mr42.verdict,
        events,
        labels,
        isReportNotePosted: isPosted,
        startedAt,
        finishedAt: now,
      })
}

/** How far the current run is, from 0 to 1, by the events it has emitted. */
export const progressOf = (review: Review): number =>
  review._tag === "Idle"
    ? 0
    : review._tag === "Done"
      ? 1
      : review.events.length / timeline(review.delivery, review.labelsBefore, review.wasReportNotePosted).length

export type SessionStatus = "Waiting" | "Running" | "Finished"

/** Where one session of the plan stands in the current run. */
export const sessionStatus = (review: Review, session: string): SessionStatus => {
  const events = eventsOf(review)
  if (events.some((event) => event._tag === "FinishedSession" && event.session === session)) return "Finished"
  if (events.some((event) => event._tag === "StartedSession" && event.session === session)) return "Running"
  return review._tag === "Done" ? "Finished" : "Waiting"
}

const pad = (text: string, width: number) => text.padEnd(width, " ")

/** One line of progress, as the Command Prompt and the editor's Output window print it. */
export const describeEvent = (event: ReviewEvent): string =>
  ReviewEvent.match(event, {
    LoadedConfig: ({ digest }) => `config    loaded, digest ${digest.slice(0, 12)}`,
    TookSnapshot: ({ head, fileCount }) => `snapshot  ${mr42.project} !${mr42.iid} at ${head.slice(0, 8)}, ${fileCount} changed files`,
    Classified: ({ lane, shape, sessionCount }) => `lane      ${lane} (${shape}), no rule matched; ${sessionCount} sessions`,
    StartedSession: ({ session, model, effort }) => `start     ${pad(session, 18)}${model}, effort ${effort}`,
    FinishedSession: ({ session, result, durationMs }) => `done      ${pad(session, 18)}${result}, ${(durationMs / 1000).toFixed(1)} s`,
    ChangedLabels: ({ added, removed }) =>
      `labels    ${[...removed.map((label) => `-${label}`), ...added.map((label) => `+${label}`)].join(", ") || "unchanged"}`,
    PostedNote: ({ noteId, action }) => `note      ${action} note ${noteId}`,
    Finished: ({ verdict }) => `verdict   ${verdict}`,
  })

/** What `heron review` prints on stdout when the run ends: the report for a dry run, one line otherwise. */
export const cliResult = (review: Review): Option.Option<string> =>
  review._tag !== "Done"
    ? Option.none()
    : review.delivery === "DryRun"
      ? Option.some(mr42.note.replace(/\n$/, ""))
      : pipe(
          Array.findFirst(review.events, (event) => event._tag === "PostedNote"),
          Option.map((event) => `${review.verdict}: note ${event._tag === "PostedNote" ? `${event.noteId} ${event.action}` : ""}`),
        )
