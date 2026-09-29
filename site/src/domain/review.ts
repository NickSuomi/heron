import { Schema } from "effect"
import { defineTaggedUnion } from "foldkit/schema"

/** Heron's four verdicts, as `src/domain.ts` spells them. */
export const Verdict = Schema.Literals(["PASS", "CHANGES REQUESTED", "BLOCKED", "SUPERSEDED"])
export type Verdict = typeof Verdict.Type

/** `--dry-run` prints the report and posts nothing; a real run posts one note and sets one label. */
export const Delivery = Schema.Literals(["DryRun", "Post"])
export type Delivery = typeof Delivery.Type

/**
 * The one review of the fictional merge request acme/storefront !42 that every app shares.
 * Command Prompt and the editor start it; the browser shows its note and labels.
 */
export const Review = defineTaggedUnion({
  Idle: {},
  Running: { mergeRequestIid: Schema.Number, delivery: Delivery, startedAt: Schema.Number },
  Done: {
    mergeRequestIid: Schema.Number,
    verdict: Verdict,
    isReportNotePosted: Schema.Boolean,
    labels: Schema.Array(Schema.String),
    finishedAt: Schema.Number,
  },
})
export type Review = typeof Review.Type

export const exampleMergeRequestIid = 42

/** Labels the mock merge request carries before Heron has run. */
export const initialLabels: ReadonlyArray<string> = ["frontend"]

/** Label names from `heron.config.example.json`. */
export const verdictLabel = (verdict: Verdict): string =>
  ({
    PASS: "review::passed",
    "CHANGES REQUESTED": "review::changes requested",
    BLOCKED: "review::blocked",
    SUPERSEDED: "review::in progress",
  })[verdict]

/** The labels the mock merge request shows, before and after a review. */
export const labelsOf = (review: Review): ReadonlyArray<string> => (review._tag === "Done" ? review.labels : initialLabels)

export const start = (delivery: Delivery, now: number): Review =>
  Review.Running({ mergeRequestIid: exampleMergeRequestIid, delivery, startedAt: now })

/** A dry run leaves the labels alone; a posted run swaps every managed label for the verdict's. */
export const finish = (review: Review, verdict: Verdict, labels: ReadonlyArray<string>, now: number): Review =>
  review._tag !== "Running"
    ? review
    : Review.Done({
        mergeRequestIid: review.mergeRequestIid,
        verdict,
        isReportNotePosted: review.delivery === "Post",
        labels:
          review.delivery === "Post"
            ? [...labels.filter((label) => !label.startsWith("review::")), verdictLabel(verdict)]
            : labels,
        finishedAt: now,
      })
