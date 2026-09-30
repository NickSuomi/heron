import { Schema } from "effect"
import { type Finding, type Marker, PriorReview, type Review, type RulingKind, Sha, type SubscriptionUse, type Verdict } from "./domain.ts"
import { EARLIER, gateStatuses, slotsOf } from "./policy.ts"

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
 * A finished review writes what the next run needs as the note's last line: base64url JSON in an HTML comment. The
 * alphabet has no `>`, so the payload cannot close the comment or start markdown. Model text can reach the note source
 * unescaped only inside a code span, which never holds a line break and never comes last, so only Heron writes that line.
 */
const printPrior = (p: PriorReview): string => `<!-- heron:prior v1 ${Buffer.from(JSON.stringify(p)).toString("base64url")} -->`

const priorPattern = /\n<!-- heron:prior v1 ([A-Za-z0-9_-]+) -->\n$/
const decodePrior = Schema.decodeUnknownOption(Schema.fromJsonString(PriorReview), { onExcessProperty: "error" })

export const parsePrior = (body: string): PriorReview | null => {
  const m = priorPattern.exec(body)
  if (m === null) return null
  const decoded = decodePrior(Buffer.from(m[1]!, "base64url").toString("utf8"))
  return decoded._tag === "Some" ? decoded.value : null
}

/*
 * Model- and vendor-written text never reaches the note as markdown. Heron reads it into a small structure of its own
 * (paragraphs, bullet items from lines that start with `- ` or `* `, and backtick code spans within one line), drops
 * `**` emphasis markers, and writes the structure back out using only markdown that Heron builds.
 *
 * Plain text: every ASCII punctuation character is backslash-escaped, so no code span, fence, emphasis, link, image,
 * heading, list, quote, table, HTML or entity can open and no line can start with the `/` of a quick action. Each escaped
 * character is also followed by a word joiner (U+2060), which renders as nothing but breaks every sigil-based GitLab
 * reference, mention and autolink pattern, cross-project forms included (a bare commit hash has no sigil and may still
 * link); the joiner goes after the escaped character because a backslash escapes only the character right after it.
 *
 * Code spans: CommonMark shows code-span content literally, and GitLab's reference filters skip text inside `code`
 * elements, so the content is written unescaped. Heron's fence is one backtick longer than any run in the content, so the
 * content cannot close it. A paragraph line that would start with a fence gets a leading joiner, so the note does not
 * depend on CommonMark refusing a fence whose info string holds a backtick. The escaped text around a span ends in a
 * joiner, so no backslash can escape Heron's opening fence.
 */
const plainLine = (line: string): string => line.replace(/[!-/:-@[-`{-~]/g, (c) => `\\${c}\u2060`)

/** Heron's code span. Newlines become spaces; padding keeps a leading or trailing backtick or space inside the span. */
const code = (text: string): string => {
  const flat = text.replace(/\s+/g, " ")
  const fence = "`".repeat(Math.max(0, ...[...flat.matchAll(/`+/g)].map((m) => m[0].length)) + 1)
  return /^[` ]|[` ]$/.test(flat) ? `${fence} ${flat} ${fence}` : `${fence}${flat}${fence}`
}

interface Span {
  readonly code: boolean
  readonly text: string
}
type Line = ReadonlyArray<Span>
/** A paragraph of lines, or a bullet list of one-line items. */
interface Block {
  readonly list: boolean
  readonly lines: ReadonlyArray<Line>
}

/** A backtick run, then content, then a run of exactly the same length, as CommonMark pairs them. */
const codeSpan = /(?<!`)(`+)(?!`)(.+?)(?<!`)\1(?!`)/g

const spansOf = (line: string): Line => {
  const out: Array<Span> = []
  const text = (t: string) => {
    const kept = t.replace(/\*\*+/g, "")
    if (kept !== "") out.push({ code: false, text: kept })
  }
  let from = 0
  for (const m of line.matchAll(codeSpan)) {
    const content = m[2]!.trim()
    if (content === "") continue
    text(line.slice(from, m.index))
    out.push({ code: true, text: content })
    from = m.index + m[0].length
  }
  text(line.slice(from))
  return out.some((s) => s.text.trim() !== "") ? out : []
}

const blocksOf = (s: string): ReadonlyArray<Block> =>
  s.replace(/\r\n?/g, "\n").split(/\n[ \t]*\n/).flatMap((paragraph) => {
    const out: Array<{ list: boolean; lines: Array<Line> }> = []
    for (const raw of paragraph.split("\n")) {
      const item = /^[-*][ \t]+(.*)$/.exec(raw.trim())
      const line = spansOf(item === null ? raw.trim() : item[1]!)
      if (line.length === 0) continue
      const last = out.at(-1)
      if (last?.list === (item !== null)) last.lines.push(line)
      else out.push({ list: item !== null, lines: [line] })
    }
    return out
  })

const lineText = (line: Line): string => line.map((s) => s.code ? code(s.text) : plainLine(s.text)).join("").trim()

/** A paragraph line; one that would start with a fence starts with a joiner instead. */
const paragraphLine = (line: Line): string => {
  const text = lineText(line)
  return text.startsWith("`") ? `\u2060${text}` : text
}

const markdown = (blocks: ReadonlyArray<Block>): string =>
  blocks.map((b) => b.list ? b.lines.map((l) => `- ${lineText(l)}`).join("\n") : b.lines.map(paragraphLine).join("  \n")).join("\n\n")

/** Model text that renders mid-line, where a line break would end the construct around it. */
const inline = (s: string): string => lineText(spansOf(s.replace(/\s+/g, " ").trim()))

/** Model text in a link label, where a code span could not hold a `]`. */
const cell = (s: string): string => plainLine(s.replace(/\s+/g, " ").trim())

/** Model text in a table cell. GFM splits a row on every unescaped `|`, code spans included, so those are escaped. */
const tableCell = (s: string): string =>
  spansOf(s.replace(/\s+/g, " ").trim()).map((span) => span.code ? code(span.text).replace(/\|/g, "\\|") : plainLine(span.text)).join("").trim()

/** One line from several, with a space between them and neighbouring text spans merged, so a sentence end is visible. */
const joined = (lines: ReadonlyArray<Line>): Line =>
  lines.flatMap((l, i) => i === 0 ? l : [{ code: false, text: " " }, ...l]).reduce<Array<Span>>((out, s) => {
    const last = out.at(-1)
    return last !== undefined && !last.code && !s.code ? [...out.slice(0, -1), { code: false, text: last.text + s.text }] : [...out, s]
  }, [])

const sentencesOf = (line: Line): ReadonlyArray<Line> => {
  const out: Array<Array<Span>> = [[]]
  for (const s of line) {
    const pieces = s.code ? [s.text] : s.text.split(/(?<=[.!?])\s+/)
    pieces.forEach((text, i) => {
      if (i > 0) out.push([])
      if (text !== "") out.at(-1)!.push({ code: s.code, text })
    })
  }
  return out.filter((l) => l.length > 0)
}

/** The note shows at most this many sentences of the summary; the rest goes under REVIEW CHECKS. */
const leadSentences = 2

const splitSummary = (summary: string): { readonly lead: Line; readonly rest: ReadonlyArray<Block> } => {
  const [first, ...more] = blocksOf(summary)
  if (first === undefined || first.list) return { lead: [], rest: first === undefined ? [] : [first, ...more] }
  const sentences = sentencesOf(joined(first.lines))
  const overflow = sentences.slice(leadSentences)
  return {
    lead: joined(sentences.slice(0, leadSentences)),
    rest: [...(overflow.length === 0 ? [] : [{ list: false, lines: [joined(overflow)] }]), ...more]
  }
}

const short = (sha: string) => sha.slice(0, 8)

const actionLine = (blockers: number, advisories: number): string =>
  blockers > 0
    ? `Before merge, fix ${blockers === 1 ? "the blocker" : `the ${blockers} blockers`} below.`
    : `Nothing blocks merging.${advisories === 0 ? "" : advisories === 1 ? " The advisory is optional." : ` The ${advisories} advisories are optional.`}`

const location = (review: Review, f: Finding): string => {
  if (f.location === null) return ""
  const { path, line } = f.location
  const segment = (p: string) => encodeURIComponent(p).replace(/\(/g, "%28").replace(/\)/g, "%29")
  const url = `${review.snapshot.projectWebUrl}/-/blob/${review.snapshot.revision.head}/${path.split("/").map(segment).join("/")}#L${line}`
  return ` ([${cell(`${path}:${line}`)}](${url}))`
}

const findingItem = (review: Review, f: Finding): string => {
  const body = markdown(blocksOf(f.body))
  return `- ${code(f.gate)} ${inline(f.title)}${location(review, f)}${body === "" ? "" : `  \n${body.replace(/^/gm, "  ")}`}`
}

const rulingText: Readonly<Record<RulingKind, string>> = { "keep": "kept", "keep as advisory": "kept as advisory", "drop": "dropped" }

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

const total = (xs: ReadonlyArray<number | null>): number | null =>
  xs.every((x) => x === null) ? null : xs.reduce<number>((a, x) => a + (x ?? 0), 0)

const tokens = (n: number | null) => n === null ? "n/a" : n.toLocaleString("en-US")

/**
 * The review's share of the subscription: the change in each usage window between the readings before and after it.
 * Claude reports whole percent, and every session on the account counts, so the report calls it an estimate.
 */
const subscriptionLines = (s: SubscriptionUse | null): ReadonlyArray<string> => {
  if (s === null) return []
  const { after, before } = s
  const share = before === null || after === null
    ? ["Subscription share unknown: the usage reading failed."]
    : [
      `Subscription: ${
        after.flatMap((a) => {
          const b = before.find((w) => w.window === a.window)
          if (b === undefined) return []
          const now = Math.round(a.percent)
          return b.resetsAt !== a.resetsAt
            ? [`the ${a.window} window reset during the review (now ${now}%)`]
            : [`+${Math.max(0, now - Math.round(b.percent))}% of the ${a.window} window (now ${now}%)`]
        }).join(", ") || "no usage window reported"
      }. An estimate: Claude reports whole percent, and other sessions on the account count too.`
    ]
  return [...share, ...s.warnings.map((w) => `Claude Code warned: ${inline(w)}.`)]
}

const details = (title: string, body: ReadonlyArray<string>): string =>
  `<details>\n<summary>${title}</summary>\n\n${body.join("\n")}\n\n</details>`

/** Said once in every report, so no session lists it as a limitation. */
export const SCOPE_LINE = "Heron reviews by reading the source and target branches. It does not run tests, the app, a browser or a device."

export const renderReport = (review: Review): string => {
  const { outcome, sessions, snapshot, verdict } = review
  const head = snapshot.revision.head
  const lane = review.classification.lane
  const where = `head ${code(short(head))} · lane ${code(lane.name)}`
  const moved = review.liveHead === null
    ? []
    : ["", `The source branch moved to ${code(short(review.liveHead))} during the review. These results describe ${code(short(head))} only.`]
  const range = review.rereview === null ? "" : `Re-review of ${code(`${short(review.rereview.from)}..${short(head)}`)}`
  const earlier = review.rereview?.earlier.length ?? 0
  const lines: Array<string> = [
    printMarker({ iid: snapshot.ref.iid, head, configDigest: review.configDigest, verdict }),
    `## Heron review: ${verdict}`,
    ""
  ]
  const checks: Array<string> = [
    "| Gate | Status |",
    "| --- | --- |",
    ...gateStatuses(lane.gates, outcome).map(([g, s]) => `| ${g} | ${s} |`)
  ]
  if (outcome.kind === "incomplete") {
    lines.push(where, ...moved, ...(range === "" ? [] : ["", `${range} with ${earlier} earlier findings to rule on.`]))
    lines.push("", `The review could not finish: session ${code(outcome.session)} failed. ${inline(outcome.reason)}`)
  } else {
    const blockers = outcome.findings.filter((f) => f.severity === "blocker")
    const advisories = outcome.findings.filter((f) => f.severity === "advisory")
    const { lead, rest } = splitSummary(outcome.summary)
    lines.push(`${count(blockers.length, "blocker", "blockers")} · ${count(advisories.length, "advisory", "advisories")} · ${where}`, ...moved)
    if (range !== "") lines.push("", `${range}: ${outcome.findings.filter((f) => f.origin === EARLIER).length} of ${earlier} earlier findings carried.`)
    if (lead.length > 0) lines.push("", paragraphLine(lead))
    // The one line a reader acts on comes from the kept findings, the same source as the verdict, so the two agree.
    if (verdict === "PASS" || verdict === "CHANGES REQUESTED") lines.push("", actionLine(blockers.length, advisories.length))
    if (blockers.length > 0) lines.push("", "### Blockers", "", ...blockers.map((f) => findingItem(review, f)))
    if (advisories.length > 0) {
      lines.push("", details(count(advisories.length, "advisory", "advisories"), advisories.map((f) => findingItem(review, f))))
    }
    if (outcome.rulings.length > 0) {
      checks.push(
        "",
        "| By | Finding | Ruling | Reason |",
        "| --- | --- | --- | --- |",
        ...outcome.rulings.map((r) =>
          `| ${code(r.by)} | ${code(r.finding.id)} ${tableCell(r.finding.title)} | ${rulingText[r.ruling]} | ${tableCell(r.reason)} |`
        )
      )
    }
    if (rest.length > 0) checks.push("", "Summary, continued:", "", markdown(rest))
    const limitations = [...new Set(outcome.limitations)]
    if (limitations.length > 0) checks.push("", "Not checked:", "", ...limitations.map((l) => `- ${inline(l)}`))
  }
  const matched = review.classification.matched
  checks.push(
    "",
    SCOPE_LINE,
    "",
    matched.length === 0
      ? `No classification rule matched; the default lane ${code(lane.name)} applied.`
      : `Rules matched: ${matched.map((m) => `${code(m.rule)} (${count(m.paths.length, "path", "paths")})`).join(", ")}.`,
    `Plan: ${review.plan.shape}, ${slotsOf(review.plan).length} sessions. Config digest ${code(review.configDigest.slice(0, 12))}.`
  )
  const costs = sessions.map((s) => s.usage.costUsd).filter((c) => c !== null)
  const cost = costs.length === 0
    ? "no vendor-reported cost"
    : `$${costs.reduce((a, c) => a + c, 0).toFixed(2)} vendor-reported cost${
      costs.length < sessions.length ? ` (${costs.length} of ${sessions.length} sessions reported one)` : ""
    }`
  lines.push(
    "",
    details("REVIEW CHECKS", checks),
    "",
    details("AGENT PROVENANCE", [
      "| Session | Model | Effort | Tokens in / out | Duration | Result |",
      "| --- | --- | --- | --- | --- | --- |",
      ...sessions.map((s) =>
        `| ${code(s.slot.id)} | ${cell(s.reportedModel ?? s.slot.profile.model)} (${cell(s.slot.profile.harness)}) | ${cell(s.slot.profile.effort)} | ${
          tokens(s.usage.inputTokens)
        } / ${tokens(s.usage.outputTokens)} | ${(s.durationMs / 1000).toFixed(1)} s | ${s.failure === null ? "ok" : cell(s.failure)} |`
      ),
      "",
      `Totals: ${tokens(total(sessions.map((s) => s.usage.inputTokens)))} / ${tokens(total(sessions.map((s) => s.usage.outputTokens)))} tokens in / out, ${
        tokens(total(sessions.map((s) => s.toolCalls)))
      } tool calls, ${cost}.`,
      ...subscriptionLines(review.subscription).flatMap((l) => ["", l])
    ])
  )
  if (outcome.kind === "complete") {
    const findings = outcome.findings.map(({ body, gate, location, severity, title }) => ({ gate, severity, location, title, body }))
    lines.push("", printPrior({ base: snapshot.revision.base, start: snapshot.revision.start, lane: lane.name, findings }))
  }
  return lines.join("\n") + "\n"
}
