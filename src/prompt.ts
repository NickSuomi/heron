import type { Finding, MrSnapshot, Role, Slot } from "./domain.ts"

const roleText: Readonly<Record<Role, string>> = {
  reviewer: "You review one GitLab merge request against every gate below. Return findings only; Heron derives the verdict from them. A blocker is a defect the author must fix before merging; anything else is advisory. Anchor each finding to a file and line at the reviewed head when one exists.",
  gate: "You review one GitLab merge request against the single gate below. Return findings only; Heron derives the verdict from them. A blocker is a defect the author must fix before merging; anything else is advisory. Anchor each finding to a file and line at the reviewed head when one exists.",
  supervisor: "You supervise one review branch. Rule on every finding id below exactly once: keep a finding only if it is a real defect at the reviewed head, and say why. Add findings the gates missed under `added`.",
  judge: "You judge two independent review branches of the same merge request. Rule on every finding id below exactly once: keep a finding only if it is a real defect at the reviewed head, and say why. You have no repository access; rely on the diff and the branch findings."
}

/** The merge request author reads the report in about 20 seconds; these rules keep the model's text that short. */
const outputRules = [
  "## Output rules",
  "The merge request author reads your output in the review note. Write for that person.",
  "- The summary is at most two plain sentences. Say what the change does and what must change before it merges. Heron shows only the first two sentences.",
  "- A finding title is at most 12 words and names the defect.",
  "- A finding body is at most two sentences. Say what is wrong and name the fix.",
  "- Each limitation is one sentence naming something you could not check.",
  "- Do not describe your process, the gates, or other reviewers' findings.",
  "- Put code, paths and identifiers in backticks. Heron shows `- ` lists and backticks; it shows headings, bold, links, tables and HTML as plain text."
].join("\n")

const rulingRule = "- Each decision's `reason` is one sentence on why the finding is or is not a real defect. Put your reasoning there, not in the summary."

export const instructionsFor = (slot: Slot, policy: ReadonlyArray<string>): string =>
  [
    roleText[slot.role],
    ...slot.gates.map((g) => `## Gate: ${g.name}\n\n${g.instructions.trim()}`),
    ...policy,
    slot.role === "supervisor" || slot.role === "judge" ? `${outputRules}\n${rulingRule}` : outputRules
  ].join("\n\n")

export const packetText = (s: MrSnapshot): string =>
  [
    `# Merge request !${s.ref.iid}: ${s.title}`,
    `Author: ${s.author}. Branch \`${s.sourceBranch}\` into \`${s.targetBranch}\`. Head \`${s.revision.head}\`, base \`${s.revision.base}\`.`,
    "## Description",
    s.description.trim() === "" ? "(none)" : s.description,
    "## Changes",
    ...s.changes.map((c) =>
      `### ${c.status} \`${c.path}\`${c.oldPath !== null && c.oldPath !== c.path ? ` (from \`${c.oldPath}\`)` : ""}\n\n\`\`\`diff\n${c.diff}\n\`\`\``
    )
  ].join("\n\n")

export const findingsText = (title: string, findings: ReadonlyArray<Finding>): string =>
  `## ${title}\n\n\`\`\`json\n${
    JSON.stringify(findings.map(({ body, gate, id, location, severity, title }) => ({ id, gate, severity, location, title, body })), null, 2)
  }\n\`\`\``
