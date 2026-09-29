import type { Finding, MrSnapshot, Role, Slot } from "./domain.ts"

const roleText: Readonly<Record<Role, string>> = {
  reviewer: "You review one GitLab merge request against every gate below. Return findings only; Heron derives the verdict from them. A blocker is a defect the author must fix before merging; anything else is advisory. Anchor each finding to a file and line at the reviewed head when one exists.",
  gate: "You review one GitLab merge request against the single gate below. Return findings only; Heron derives the verdict from them. A blocker is a defect the author must fix before merging; anything else is advisory. Anchor each finding to a file and line at the reviewed head when one exists.",
  supervisor: "You supervise one review branch. Rule on every finding id below exactly once: keep a finding only if it is a real defect at the reviewed head, and say why. Add findings the gates missed under `added`.",
  judge: "You judge two independent review branches of the same merge request. Rule on every finding id below exactly once: keep a finding only if it is a real defect at the reviewed head, and say why. Check a finding in the repository before you rule on it."
}

/** Every role reads the same way: the repository's rules first, then the change against its target. */
const readingRules = [
  "## How to read the repository",
  "- You can read the whole repository at three commits: `source` is the merge request head, `target` is the target branch tip, and `base` is their merge base. Every Heron tool takes `ref`.",
  "- Before you judge the change, read the repository's own guidance: `AGENTS.md`, `CLAUDE.md`, `CONTRIBUTING.md`, and the rules, conventions and architecture decision records under `docs/`, whichever exist. Hold the change to those rules.",
  "- Compare source with target when you judge a change. Read the changed code and its callers at both refs, and use `git_diff` from base to source for the change itself.",
  "- The packet lists the head pipeline's failed jobs with the end of each log. Cite a CI failure as evidence, with the job name.",
  "- Results are paged. When a result has a `next` offset, fetch the rest before you rely on it."
].join("\n")

/** The merge request author reads the report in about 20 seconds; these rules keep the model's text that short. */
const outputRules = [
  "## Output rules",
  "The merge request author reads your output in the review note. Write for that person.",
  "- The summary is at most two plain sentences. Say what the change does and what must change before it merges. Heron shows only the first two sentences.",
  "- A finding title is at most 12 words and names the defect.",
  "- A finding body is at most two sentences. Say what is wrong and name the fix.",
  "- Each limitation is one sentence naming something in the repository or the merge request you could not check. Never list that you could not run tests, the app, a browser or a device: the report says that once for every review.",
  "- Do not describe your process, the gates, or other reviewers' findings.",
  "- Put code, paths and identifiers in backticks. Heron shows `- ` lists and backticks; it shows headings, bold, links, tables and HTML as plain text."
].join("\n")

const rulingRule = "- Each decision's `reason` is one sentence on why the finding is or is not a real defect. Put your reasoning there, not in the summary."

export const instructionsFor = (slot: Slot, policy: ReadonlyArray<string>): string =>
  [
    roleText[slot.role],
    readingRules,
    ...slot.gates.map((g) => `## Gate: ${g.name}\n\n${g.instructions.trim()}`),
    ...policy,
    slot.role === "supervisor" || slot.role === "judge" ? `${outputRules}\n${rulingRule}` : outputRules
  ].join("\n\n")

/** A fence longer than any backtick run in `text`, so the text cannot close it. */
const fence = (text: string) => "`".repeat(Math.max(3, ...[...text.matchAll(/`+/g)].map((m) => m[0].length + 1)))

const issuesText = (s: MrSnapshot): ReadonlyArray<string> =>
  s.issues.length === 0
    ? ["## Linked issues", "(none)"]
    : [
      "## Linked issues",
      ...s.issues.map((i) =>
        `### ${i.relation === "closes" ? "Closes" : "Related to"} ${i.reference}: ${i.title} (${i.state})\n\n${i.description.trim() === "" ? "(no description)" : i.description}`
      )
    ]

const pipelineText = (s: MrSnapshot): ReadonlyArray<string> => {
  const p = s.pipeline
  if (p === null) return ["## Head pipeline", "(none)"]
  return [
    "## Head pipeline",
    `Pipeline ${p.id} is \`${p.status}\`: ${p.webUrl}. ${p.failedJobs.length === 0 ? "No job failed." : `Failed jobs: ${p.failedJobs.map((j) => `\`${j.name}\``).join(", ")}.`}`,
    ...p.failedJobs.map((j) => {
      const f = fence(j.logTail)
      return `### Failed job \`${j.name}\` (stage \`${j.stage}\`)\n\n${j.webUrl}\n\n${f}text\n${j.logTail}\n${f}`
    })
  ]
}

export const packetText = (s: MrSnapshot): string =>
  [
    `# Merge request !${s.ref.iid}: ${s.title}`,
    `Author: ${s.author}. Branch \`${s.sourceBranch}\` into \`${s.targetBranch}\`.`,
    `Commits: source (head) \`${s.revision.head}\`, target (\`${s.targetBranch}\` tip) \`${s.revision.start}\`, base (merge base) \`${s.revision.base}\`.`,
    "## Description",
    s.description.trim() === "" ? "(none)" : s.description,
    ...issuesText(s),
    ...pipelineText(s),
    "## Changes",
    ...s.changes.map((c) =>
      `### ${c.status} \`${c.path}\`${c.oldPath !== null && c.oldPath !== c.path ? ` (from \`${c.oldPath}\`)` : ""}\n\n\`\`\`diff\n${c.diff}\n\`\`\``
    )
  ].join("\n\n")

export const findingsText = (title: string, findings: ReadonlyArray<Finding>): string =>
  `## ${title}\n\n\`\`\`json\n${
    JSON.stringify(findings.map(({ body, gate, id, location, severity, title }) => ({ id, gate, severity, location, title, body })), null, 2)
  }\n\`\`\``
