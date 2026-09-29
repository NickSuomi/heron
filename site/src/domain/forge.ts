import { Option, Schema } from "effect"

import { eventsOf, type Review } from "./review"

// The mock GitLab at gitlab.heron.local, beyond what the review itself holds: who is signed in during this session,
// when heron-bot created and last edited its note, and the label changes its activity lists. The review engine
// stays the source of the labels and of whether the note exists; this records when its events happened.

/** A label change heron-bot made, as GitLab lists it in the merge request's activity. */
export const LabelChange = Schema.Struct({ added: Schema.Array(Schema.String), removed: Schema.Array(Schema.String), at: Schema.Number })
export type LabelChange = typeof LabelChange.Type

export const ReportNote = Schema.Struct({ createdAt: Schema.Number, maybeEditedAt: Schema.Option(Schema.Number) })
export type ReportNote = typeof ReportNote.Type

export const Forge = Schema.Struct({
  maybeUser: Schema.Option(Schema.String),
  maybeNote: Schema.Option(ReportNote),
  labelChanges: Schema.Array(LabelChange),
})
export type Forge = typeof Forge.Type

export const emptyForge: Forge = { maybeUser: Option.none(), maybeNote: Option.none(), labelChanges: [] }

/** Any username signs in; nothing leaves the page. A blank one signs in as "visitor". */
export const signIn = (forge: Forge, username: string): Forge => ({ ...forge, maybeUser: Option.some(username.trim() === "" ? "visitor" : username.trim()) })

export const signOut = (forge: Forge): Forge => ({ ...forge, maybeUser: Option.none() })

/** The events `after` emitted since `before`: all of them on a new run, the new tail on the same run. */
const freshEvents = (before: Review, after: Review) =>
  after._tag === "Idle"
    ? []
    : before._tag !== "Idle" && before.run === after.run
      ? after.events.slice(eventsOf(before).length)
      : after.events

/** Records the review's forge events at `now`: PostedNote creates or edits the note, ChangedLabels adds to the activity. */
export const observe = (forge: Forge, before: Review, after: Review, now: number): Forge =>
  freshEvents(before, after).reduce<Forge>((next, event) => {
    if (event._tag === "ChangedLabels")
      return event.added.length + event.removed.length === 0
        ? next
        : { ...next, labelChanges: [...next.labelChanges, { added: event.added, removed: event.removed, at: now }] }
    if (event._tag === "PostedNote")
      return {
        ...next,
        maybeNote: Option.match(next.maybeNote, {
          onNone: () => Option.some({ createdAt: now, maybeEditedAt: Option.none() }),
          onSome: (note) => Option.some({ ...note, maybeEditedAt: event.action === "updated" ? Option.some(now) : note.maybeEditedAt }),
        }),
      }
    return next
  }, forge)

/** "just now", "5 minutes ago": GitLab's relative time, as its note headers show it. */
export const timeAgo = (at: number, now: number): string => {
  const seconds = Math.max(0, Math.round((now - at) / 1000))
  if (seconds < 60) return "just now"
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return minutes === 1 ? "1 minute ago" : `${minutes} minutes ago`
  const hours = Math.floor(minutes / 60)
  return hours === 1 ? "1 hour ago" : `${hours} hours ago`
}
