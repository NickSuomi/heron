import type { Finding, MrSnapshot, Role, Slot } from "./domain.ts"

const roleText: Readonly<Record<Role, string>> = {
  reviewer: "You review one GitLab merge request against every gate below. Return findings only; Heron derives the verdict from them. A blocker is a defect the author must fix before merging; anything else is advisory. Anchor each finding to a file and line at the reviewed head when one exists.",
  gate: "You review one GitLab merge request against the single gate below. Return findings only; Heron derives the verdict from them. A blocker is a defect the author must fix before merging; anything else is advisory. Anchor each finding to a file and line at the reviewed head when one exists.",
  supervisor: "You supervise one review branch. Rule on every finding id below exactly once: keep a finding only if it is a real defect at the reviewed head, and say why. Add findings the gates missed under `added`.",
  judge: "You judge two independent review branches of the same merge request. Rule on every finding id below exactly once: keep a finding only if it is a real defect at the reviewed head, and say why. You have no repository access; rely on the diff and the branch findings."
}

export const instructionsFor = (slot: Slot, policy: ReadonlyArray<string>): string =>
  [roleText[slot.role], ...slot.gates.map((g) => `## Gate: ${g.name}\n\n${g.instructions.trim()}`), ...policy].join("\n\n")

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
