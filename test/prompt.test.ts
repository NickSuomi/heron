import { describe, expect, it } from "vitest"
import { packetText } from "../src/prompt.ts"
import { change, sha, snapshotAt } from "./fakes.ts"

describe("packetText", () => {
  it("names the three commits and carries the linked issues and each failed job's log", () => {
    const snapshot = {
      ...snapshotAt(sha("c"), [change("src/app.ts")]),
      revision: { base: sha("a"), start: sha("b"), head: sha("c") },
      issues: [
        { reference: "group/app#12", relation: "closes" as const, title: "Totals are wrong", description: "Sum is off by one.", state: "opened", webUrl: "https://x/12" },
        { reference: "group/app#14", relation: "related" as const, title: "Follow-up", description: "", state: "closed", webUrl: "https://x/14" }
      ],
      pipeline: {
        id: 900,
        status: "failed",
        webUrl: "https://x/pipelines/900",
        failedJobs: [{ name: "unit", stage: "test", webUrl: "https://x/jobs/7001", logTail: "```\nFAIL adds" }]
      }
    }
    const sections = packetText(snapshot, null).split("\n\n")
    expect(sections.slice(1, 13)).toEqual([
      "Author: someone. Branch `feature` into `main`.",
      `Commits: source (head) \`${sha("c")}\`, target (\`main\` tip) \`${sha("b")}\`, base (merge base) \`${sha("a")}\`.`,
      "## Description",
      "Adds it.",
      "## Linked issues",
      "### Closes group/app#12: Totals are wrong (opened)",
      "Sum is off by one.",
      "### Related to group/app#14: Follow-up (closed)",
      "(no description)",
      "## Head pipeline",
      "Pipeline 900 is `failed`: https://x/pipelines/900. Failed jobs: `unit`.",
      "### Failed job `unit` (stage `test`)"
    ])
    // The log holds a fence of its own, so the packet's fence is longer and the log cannot close it.
    expect(sections.slice(13, 15)).toEqual(["https://x/jobs/7001", "````text\n```\nFAIL adds\n````"])
  })

  it("says so when there is no linked issue and no pipeline", () => {
    const sections = packetText(snapshotAt(sha("c"), []), null).split("\n\n")
    expect(sections.slice(5, 9)).toEqual(["## Linked issues", "(none)", "## Head pipeline", "(none)"])
  })
})
