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
 * Model- and vendor-written text made inert inside a GitLab note, modelled as CommonMark sees it: fenced blocks, and
 * lines of prose with inline code spans in them. Code is left as written so URLs, generics and shell variables survive.
 *
 * Every line, code included, loses a leading `/`: GitLab runs a line that starts with `/` as a quick action under the
 * bot's identity, and its extractor may disagree with this fence parsing, so safety wins over a visible backslash.
 * Prose also gets `<` as `&lt;` (no HTML tag or comment can open), a backslash before a heading (`#`, or a setext
 * `===` / `---` underline) so the model cannot fake report sections, and a word joiner (U+2060) after a reference or
 * mention sigil where GitLab would parse one: after a boundary, before a word character, `"` or `[`. The joiner renders
 * as nothing but breaks the pattern on every GitLab version, unlike a backslash escape. Sigils inside words and URLs
 * stay. Where this model and GitLab could disagree, the parse errs towards prose: code spans never cross lines and a
 * backslash-escaped backtick run never opens one.
 */
const sigil = /(?<![\p{L}\p{N}_/.:?=&%#+~-])([@#!~%&$])(?=[\p{L}\p{N}_"[])/gu
const prose = (s: string): string => s.replace(sigil, "$1\u2060").replace(/</g, "&lt;")
const noQuickAction = (line: string): string => line.replace(/^([\s>*+\-\d.)]*)\//, "$1\\/")
const noHeading = (line: string): string => line.replace(/^( *)(#|=+[ \t]*$|-+[ \t]*$)/, "$1\\$2")

/** One line outside fences: code spans (a backtick run closed by the next run of the same length) kept, the rest prose. */
const proseLine = (line: string): string => {
  const parts: Array<string> = []
  const runs = /`+/g
  let from = 0
  for (let run = runs.exec(line); run !== null; run = runs.exec(line)) {
    if (/(^|[^\\])(\\\\)*\\$/.test(line.slice(from, run.index))) continue
    const closer = new RegExp(`(?<!\`)\`{${run[0].length}}(?!\`)`, "g")
    closer.lastIndex = run.index + run[0].length
    const close = closer.exec(line)
    if (close === null) continue
    parts.push(prose(line.slice(from, run.index)), line.slice(run.index, closer.lastIndex))
    from = runs.lastIndex = closer.lastIndex
  }
  return noQuickAction(noHeading(parts.join("") + prose(line.slice(from))))
}

const fenceOpen = /^ {0,3}(`{3,}(?=[^`]*$)|~{3,})/
const closesFence = (fence: string, line: string): boolean =>
  new RegExp(`^ {0,3}${fence[0] === "`" ? "`" : "~"}{${fence.length},}[ \\t]*$`).test(line)

/** Text that renders where a block starts; a fence it leaves open is closed so it cannot swallow the rest of the note. */
const inertBlock = (s: string): string => {
  const out: Array<string> = []
  let fence: string | null = null
  for (const line of s.replace(/\r\n?/g, "\n").split("\n")) {
    if (fence === null) {
      fence = fenceOpen.exec(line)?.[1] ?? null
      out.push(fence === null ? proseLine(line) : noQuickAction(line))
    } else {
      if (closesFence(fence, line)) fence = null
      out.push(noQuickAction(line))
    }
  }
  return (fence === null ? out : [...out, fence]).join("\n")
}

/** Text that renders mid-line, where no block can start: one prose line. */
const inertInline = (s: string): string => proseLine(s.replace(/[\r\n]+/g, " "))

/** A code span whose fence is longer than any backtick run inside it. */
const code = (s: string): string => {
  const text = s.replace(/[\r\n]+/g, " ")
  const fence = "`".repeat(Math.max(0, ...(text.match(/`+/g) ?? []).map((r) => r.length)) + 1)
  const pad = text.startsWith("`") || text.endsWith("`") ? " " : ""
  return `${fence}${pad}${text}${pad}${fence}`
}

const cell = (s: string) => inertInline(s).replace(/\|/g, "\\|")
const short = (sha: string) => sha.slice(0, 8)

const location = (review: Review, f: Finding): string => {
  if (f.location === null) return ""
  const { path, line } = f.location
  const segment = (p: string) => encodeURIComponent(p).replace(/\(/g, "%28").replace(/\)/g, "%29")
  const url = `${review.snapshot.projectWebUrl}/-/blob/${review.snapshot.revision.head}/${path.split("/").map(segment).join("/")}#L${line}`
  return ` ([${code(`${path}:${line}`)}](${url}))`
}

const findingLine = (review: Review, f: Finding): string =>
  `- **${f.severity === "blocker" ? "Blocker" : "Advisory"}** \`${f.gate}\` ${inertInline(f.title)}${location(review, f)}\n\n  ${inertBlock(f.body).replace(/\n/g, "\n  ")}`

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
    lines.push("", `The review could not finish: session \`${outcome.session}\` failed. ${inertInline(outcome.reason)}`)
  } else {
    lines.push("", inertBlock(outcome.summary))
    const blockers = outcome.findings.filter((f) => f.severity === "blocker")
    const advisories = outcome.findings.filter((f) => f.severity === "advisory")
    if (outcome.findings.length > 0) {
      lines.push("", "### Findings", "", ...[...blockers, ...advisories].map((f) => findingLine(review, f)))
    }
    if (outcome.limitations.length > 0) {
      lines.push("", "### Not checked", "", ...outcome.limitations.map((l) => `- ${inertBlock(l).replace(/\n/g, "\n  ")}`))
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
