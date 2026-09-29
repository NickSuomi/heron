import { Option } from "effect"
import { describe, expect, it } from "vitest"

import { emptyForge, type Forge, observe, signIn, signOut, timeAgo } from "./forge"
import { advance, labelsOf, Review, start } from "./review"

const t0 = 1_000_000

/** Ticks a run every 100 ms, as the subscription does, recording its forge events; returns the review and forge at the end. */
const play = (review: Review, forge: Forge, from: number): { review: Review; forge: Forge; at: number } => {
  let current = review
  let next = forge
  let at = from
  while (current._tag !== "Done" || at === from) {
    const ticked = advance(current, at)
    next = observe(next, current, ticked, at)
    current = ticked
    at += 100
  }
  return { review: current, forge: next, at }
}

describe("the mock GitLab's live state", () => {
  it("records nothing for a dry run", () => {
    const { review, forge } = play(start(Review.Idle(), "DryRun"), emptyForge, t0)
    expect(review._tag).toBe("Done")
    expect(forge).toEqual(emptyForge)
    expect(labelsOf(review)).toEqual(["frontend"])
  })

  it("creates heron-bot's note and lists the in-progress and verdict label changes of a posted run", () => {
    const { review, forge } = play(start(Review.Idle(), "Post"), emptyForge, t0)
    expect(labelsOf(review)).toEqual(["frontend", "review::changes requested"])
    expect(forge.labelChanges.map(({ added, removed }) => ({ added, removed }))).toEqual([
      { added: ["review::in progress"], removed: [] },
      { added: ["review::changes requested"], removed: ["review::in progress"] },
    ])
    const note = Option.getOrThrow(forge.maybeNote)
    expect(note.maybeEditedAt).toEqual(Option.none())
    expect(note.createdAt).toBeGreaterThan(forge.labelChanges[0]?.at ?? Infinity)
    expect(note.createdAt).toBeLessThan(forge.labelChanges[1]?.at ?? 0)
  })

  it("edits the same note on a second posted run and keeps when it was created", () => {
    const first = play(start(Review.Idle(), "Post"), emptyForge, t0)
    const second = play(start(first.review, "Post"), first.forge, first.at + 60_000)
    const created = Option.getOrThrow(first.forge.maybeNote).createdAt
    const note = Option.getOrThrow(second.forge.maybeNote)
    expect(note.createdAt).toBe(created)
    expect(Option.getOrThrow(note.maybeEditedAt)).toBeGreaterThan(created + 60_000)
    expect(second.forge.labelChanges.slice(2).map(({ added, removed }) => ({ added, removed }))).toEqual([
      { added: ["review::in progress"], removed: [] },
      { added: [], removed: ["review::in progress"] },
    ])
  })

  it("keeps the note when a dry run follows a posted one", () => {
    const first = play(start(Review.Idle(), "Post"), emptyForge, t0)
    const dry = play(start(first.review, "DryRun"), first.forge, first.at + 5_000)
    expect(dry.forge).toEqual(first.forge)
  })

  it("signs in with any name and out again", () => {
    expect(signIn(emptyForge, "  ada ").maybeUser).toEqual(Option.some("ada"))
    expect(signIn(emptyForge, "").maybeUser).toEqual(Option.some("visitor"))
    expect(signOut(signIn(emptyForge, "ada")).maybeUser).toEqual(Option.none())
  })

  it("says just now for the first minute, then counts minutes and hours", () => {
    expect(timeAgo(t0, t0 + 59_000)).toBe("just now")
    expect(timeAgo(t0, t0 + 61_000)).toBe("1 minute ago")
    expect(timeAgo(t0, t0 + 5 * 60_000)).toBe("5 minutes ago")
    expect(timeAgo(t0, t0 + 2 * 3_600_000)).toBe("2 hours ago")
  })
})
