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

/**
 * Model- and vendor-written text made inert inside a GitLab note. GitLab runs a line that starts with `/` as a quick
 * action under the bot's identity, so a `/` after nothing but indentation, list or quote markers gets a backslash
 * (Markdown renders `\/` as `/`). `<` becomes `&lt;` so no HTML tag or comment can open, even after a backslash the
 * model wrote. `@` gets a word joiner (U+2060), which renders as nothing but breaks the mention and notification
 * pattern on every GitLab version, unlike a backslash escape. Cost: these escapes show literally inside code the model
 * formats.
 */
/** GitLab turns `#12`, `!3`, `~label`, `%milestone`, `&epic`, `$snippet` and `![...]` into references or image loads. */
const inert = (s: string): string =>
  s.replace(/\r\n?/g, "\n").replace(/([#!~%&$])(?=[\w"[])/g, "$1\u2060").replace(/</g, "&lt;").replace(/@/g, "@\u2060").replace(/^([\s>*+\-\d.)]*)\//gm, "$1\\/")

/** A code span whose fence is longer than any backtick run inside it. */
const code = (s: string): string => {
  const text = s.replace(/[\r\n]+/g, " ")
  const fence = "`".repeat(Math.max(0, ...(text.match(/`+/g) ?? []).map((r) => r.length)) + 1)
  const pad = text.startsWith("`") || text.endsWith("`") ? " " : ""
  return `${fence}${pad}${text}${pad}${fence}`
}

const cell = (s: string) => inert(s).replace(/\|/g, "\\|").replace(/\n/g, " ")
const short = (sha: string) => sha.slice(0, 8)

const location = (review: Review, f: Finding): string => {
  if (f.location === null) return ""
  const { path, line } = f.location
  const segment = (p: string) => encodeURIComponent(p).replace(/\(/g, "%28").replace(/\)/g, "%29")
  const url = `${review.snapshot.projectWebUrl}/-/blob/${review.snapshot.revision.head}/${path.split("/").map(segment).join("/")}#L${line}`
  return ` ([${code(`${path}:${line}`)}](${url}))`
}

const findingLine = (review: Review, f: Finding): string =>
  `- **${f.severity === "blocker" ? "Blocker" : "Advisory"}** \`${f.gate}\` ${inert(f.title)}${location(review, f)}\n\n  ${inert(f.body).replace(/\n/g, "\n  ")}`

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
    lines.push("", `The review could not finish: session \`${outcome.session}\` failed. ${inert(outcome.reason)}`)
  } else {
    lines.push("", inert(outcome.summary))
    const blockers = outcome.findings.filter((f) => f.severity === "blocker")
    const advisories = outcome.findings.filter((f) => f.severity === "advisory")
    if (outcome.findings.length > 0) {
      lines.push("", "### Findings", "", ...[...blockers, ...advisories].map((f) => findingLine(review, f)))
    }
    if (outcome.limitations.length > 0) {
      lines.push("", "### Not checked", "", ...outcome.limitations.map((l) => `- ${inert(l)}`))
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
        `| ${s.slot.id} | ${s.slot.role} | ${cell(s.slot.profile.harness)} | ${cell(s.reportedModel ?? s.slot.profile.model)} | ${cell(s.slot.profile.effort)} | ${num(s.usage.inputTokens)} / ${num(s.usage.outputTokens)} | ${num(s.toolCalls)} | ${(s.durationMs / 1000).toFixed(1)} s | ${s.usage.costUsd === null ? "n/a" : `$${s.usage.costUsd.toFixed(4)}`} | ${s.failure ?? "ok"} |`
      )
    ])
  )
  return lines.join("\n") + "\n"
}
