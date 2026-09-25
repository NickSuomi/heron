import { Schema } from "effect"
import { type Finding, type Marker, type Review, Sha, type Verdict } from "./domain.ts"
import { gateStatuses, slotsOf } from "./policy.ts"

const slugs: Readonly<Record<Verdict, string>> = {
  "PASS": "pass",
  "CHANGES REQUESTED": "changes-requested",
  "BLOCKED": "blocked",
  "SUPERSEDED": "superseded"
}
const verdictOfSlug = new Map(Object.entries(slugs).map(([v, s]) => [s, v as Verdict]))

export const printMarker = (m: Marker): string =>
  `<!-- heron:v1 mr=${m.iid} head=${m.head} config=${m.configDigest} verdict=${slugs[m.verdict]} -->`

const markerPattern = /<!-- heron:v1 mr=(\d+) head=([0-9a-f]{40}) config=([0-9a-f]{64}) verdict=([a-z-]+) -->/
const isSha = Schema.is(Sha)

export const parseMarker = (body: string): Marker | null => {
  const m = markerPattern.exec(body)
  if (m === null) return null
  const [, iid, head, configDigest, slug] = m
  const verdict = verdictOfSlug.get(slug!)
  return verdict === undefined || !isSha(head) ? null : { iid: Number(iid), head, configDigest: configDigest!, verdict }
}

/*
 * Model- and vendor-written text is plain text, never markdown. Every ASCII punctuation character is backslash-escaped,
 * so no code span, fence, emphasis, link, image, heading, list, quote, table, HTML or entity can open and no line can
 * start with the `/` of a quick action. Each escaped character is also followed by a word joiner (U+2060), which renders
 * as nothing but breaks every GitLab reference, mention and autolink pattern, cross-project forms included; the joiner
 * goes after the escaped character because a backslash escapes only the character right after it. Single newlines
 * become two-space hard breaks and blank lines stay paragraph breaks; indentation is dropped so no line becomes a code
 * block. The cost: quoted code and URLs show as literal text, and copied text carries the invisible joiners.
 */
const plainLine = (line: string): string => line.replace(/[!-/:-@[-`{-~]/g, (c) => `\\${c}\u2060`)

const plain = (s: string): string =>
  s.replace(/\r\n?/g, "\n").split(/\n[ \t]*\n\s*/)
    .map((p) => p.split("\n").map((l) => l.trim()).filter((l) => l !== "").map(plainLine).join("  \n"))
    .filter((p) => p !== "")
    .join("\n\n")

/** Text that renders mid-line, where a line break would end the construct around it. */
const inline = (s: string): string => plain(s.replace(/\s+/g, " "))

const short = (sha: string) => sha.slice(0, 8)

const location = (review: Review, f: Finding): string => {
  if (f.location === null) return ""
  const { path, line } = f.location
  const segment = (p: string) => encodeURIComponent(p).replace(/\(/g, "%28").replace(/\)/g, "%29")
  const url = `${review.snapshot.projectWebUrl}/-/blob/${review.snapshot.revision.head}/${path.split("/").map(segment).join("/")}#L${line}`
  return ` ([${inline(`${path}:${line}`)}](${url}))`
}

const findingLine = (review: Review, f: Finding): string =>
  `- **${f.severity === "blocker" ? "Blocker" : "Advisory"}** \`${f.gate}\` ${inline(f.title)}${location(review, f)}\n\n  ${plain(f.body).replace(/\n/g, "\n  ")}`

const num = (n: number | null) => n === null ? "n/a" : String(n)

const details = (title: string, body: ReadonlyArray<string>): string =>
  `<details>\n<summary>${title}</summary>\n\n${body.join("\n")}\n\n</details>`

export const renderReport = (review: Review): string => {
  const { snapshot, outcome, verdict } = review
  const head = snapshot.revision.head
  const lane = review.classification.lane
  const lines: Array<string> = [
    printMarker({ iid: snapshot.ref.iid, head, configDigest: review.configDigest, verdict }),
    `## Heron review: ${verdict}`,
    "",
    `Reviewed head \`${short(head)}\` in lane \`${lane.name}\`.`
  ]
  if (review.liveHead !== null) {
    lines.push("", `The source branch moved to \`${short(review.liveHead)}\` during the review. These results describe \`${short(head)}\` only.`)
  }
  if (outcome.kind === "incomplete") {
    lines.push("", `The review could not finish: session \`${outcome.session}\` failed. ${inline(outcome.reason)}`)
  } else {
    lines.push("", plain(outcome.summary))
    const blockers = outcome.findings.filter((f) => f.severity === "blocker")
    const advisories = outcome.findings.filter((f) => f.severity === "advisory")
    if (outcome.findings.length > 0) {
      lines.push("", "### Findings", "", ...[...blockers, ...advisories].map((f) => findingLine(review, f)))
    }
    if (outcome.limitations.length > 0) {
      lines.push("", "### Not checked", "", ...outcome.limitations.map((l) => `- ${plain(l).replace(/\n/g, "\n  ")}`))
    }
  }
  const matched = review.classification.matched
  lines.push(
    "",
    details("REVIEW CHECKS", [
      "| Gate | Status |",
      "| --- | --- |",
      ...gateStatuses(lane.gates, outcome).map(([g, s]) => `| ${g} | ${s} |`),
      "",
      matched.length === 0
        ? `No classification rule matched; the default lane \`${lane.name}\` applied.`
        : `Rules matched: ${matched.map((m) => `\`${m.rule}\` (${m.paths.length} path${m.paths.length === 1 ? "" : "s"})`).join(", ")}.`,
      `Plan: ${review.plan.shape}, ${slotsOf(review.plan).length} sessions. Config digest \`${review.configDigest.slice(0, 12)}\`.`
    ]),
    "",
    details("AGENT PROVENANCE", [
      "| Session | Role | Backend | Model | Effort | Tokens in / out | Tool calls | Duration | Vendor cost | Result |",
      "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
      ...review.sessions.map((s) =>
        `| ${s.slot.id} | ${s.slot.role} | ${inline(s.slot.profile.harness)} | ${inline(s.reportedModel ?? s.slot.profile.model)} | ${inline(s.slot.profile.effort)} | ${num(s.usage.inputTokens)} / ${num(s.usage.outputTokens)} | ${num(s.toolCalls)} | ${(s.durationMs / 1000).toFixed(1)} s | ${s.usage.costUsd === null ? "n/a" : `$${s.usage.costUsd.toFixed(4)}`} | ${s.failure === null ? "ok" : inline(s.failure)} |`
      )
    ])
  )
  return lines.join("\n") + "\n"
}
