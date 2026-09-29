import { Option } from "effect"
import { describe, expect, it } from "vitest"

import { advance, cliResult, describeEvent, eventsOf, isReportNotePosted, labelsOf, Review, start } from "./review"

// Clock values are milliseconds; the first tick after `start` pins the run to t0.
const t0 = 1_000_000
const runTo = (review: Review, ms: number): Review => advance(advance(review, t0), t0 + ms)

describe("the shared review", () => {
  it("starts running with the merge request's labels and no events", () => {
    const review = start(Review.Idle(), "DryRun")
    expect(review._tag).toBe("Running")
    expect(labelsOf(review)).toEqual(["frontend"])
    expect(eventsOf(advance(review, t0))).toEqual([])
  })

  it("loads the config, takes the snapshot and picks the lane before any session", () => {
    const review = runTo(start(Review.Idle(), "DryRun"), 1250)
    expect(eventsOf(review).map(describeEvent)).toEqual([
      "config    loaded, digest fc7316b64819",
      "snapshot  acme/storefront !42 at 9abe74a0, 3 changed files",
      "lane      standard (gated), no rule matched; 4 sessions",
    ])
  })

  it("runs two gates at once, the third when a permit frees, then the supervisor", () => {
    const review = runTo(start(Review.Idle(), "DryRun"), 6200)
    expect(eventsOf(review).slice(3).map(describeEvent)).toEqual([
      "start     gate.design       <fast model id>, effort low",
      "start     gate.correctness  <fast model id>, effort low",
      "done      gate.design       2 findings, 61.3 s",
      "start     gate.security     <fast model id>, effort low",
      "done      gate.correctness  2 findings, 88.7 s",
      "done      gate.security     1 finding, 52.4 s",
      "start     supervisor        <strong model id>, effort high",
    ])
    expect(review._tag).toBe("Running")
  })

  it("ends a dry run Done with the verdict, the report on stdout and the merge request untouched", () => {
    const review = runTo(start(Review.Idle(), "DryRun"), 9424)
    expect(review._tag === "Done" && review.verdict).toBe("CHANGES REQUESTED")
    expect(labelsOf(review)).toEqual(["frontend"])
    expect(isReportNotePosted(review)).toBe(false)
    expect(Option.getOrThrow(cliResult(review)).split("\n")[1]).toBe("## Heron review: CHANGES REQUESTED")
  })

  it("is still running one tick before its last event", () => {
    expect(runTo(start(Review.Idle(), "DryRun"), 9423)._tag).toBe("Running")
  })

  it("marks a posted run in progress, then posts the note and swaps in the verdict label", () => {
    const review = start(Review.Idle(), "Post")
    expect(labelsOf(runTo(review, 1400))).toEqual(["frontend", "review::in progress"])
    const done = runTo(review, 10_024)
    expect(done._tag).toBe("Done")
    expect(labelsOf(done)).toEqual(["frontend", "review::changes requested"])
    expect(isReportNotePosted(done)).toBe(true)
    expect(eventsOf(done).slice(-3).map(describeEvent)).toEqual([
      "note      created note 1742",
      "labels    -review::in progress, +review::changes requested",
      "verdict   CHANGES REQUESTED",
    ])
    expect(cliResult(done)).toEqual(Option.some("CHANGES REQUESTED: note 1742 created"))
  })

  it("updates the same note on a second posted run and leaves the verdict label in place", () => {
    const first = runTo(start(Review.Idle(), "Post"), 10_024)
    const second = runTo(start(first, "Post"), 10_024)
    expect(second._tag === "Done" && second.run).toBe(2)
    expect(labelsOf(second)).toEqual(["frontend", "review::changes requested"])
    expect(cliResult(second)).toEqual(Option.some("CHANGES REQUESTED: note 1742 updated"))
  })

  it("keeps the posted note and labels through a later dry run", () => {
    const posted = runTo(start(Review.Idle(), "Post"), 10_024)
    const dry = runTo(start(posted, "DryRun"), 9424)
    expect(isReportNotePosted(dry)).toBe(true)
    expect(labelsOf(dry)).toEqual(["frontend", "review::changes requested"])
  })

  it("ignores a second start while a run is going", () => {
    const running = runTo(start(Review.Idle(), "DryRun"), 2000)
    expect(start(running, "Post")).toBe(running)
  })
})
