import { describe, expect, it } from "@effect/vitest"
import MarkdownIt from "markdown-it"
import type { FindingId, Outcome, Review, SessionId } from "../src/domain.ts"
import { classify, planFor, slotsOf } from "../src/policy.ts"
import { renderReport } from "../src/report.ts"
import { change, configOf, sha, snapshotAt } from "./fakes.ts"

/** GitLab renders notes as GitHub-flavoured markdown with raw HTML allowed and bare URLs linked; markdown-it stands in for it. */
const md = new MarkdownIt({ html: true, linkify: true })

const classification = classify(configOf(), [change("src/app.ts")])
const plan = planFor(classification.lane)

/** A full report with `text` in every slot the model or a vendor writes. */
const report = (text: string, kind: Outcome["kind"] = "complete"): string => {
  const outcome: Outcome = kind === "incomplete"
    ? { kind: "incomplete", session: "supervisor" as SessionId, reason: text }
    : {
      kind: "complete",
      summary: text,
      findings: [{
        id: "gate.design#1" as FindingId,
        origin: "gate.design" as SessionId,
        gate: "design",
        severity: "blocker",
        location: { path: text, line: 3 },
        title: text,
        body: text
      }],
      limitations: [text]
    }
  const review: Review = {
    snapshot: snapshotAt(sha("a"), [change("src/app.ts")]),
    classification,
    plan,
    sessions: slotsOf(plan).map((slot) => ({
      slot,
      reportedModel: text,
      vendorSessionId: null,
      usage: { inputTokens: 1, cachedInputTokens: null, outputTokens: 2, reasoningTokens: null, costUsd: null },
      toolCalls: 1,
      durationMs: 1000,
      failure: text
    })),
    outcome,
    verdict: kind === "complete" ? "CHANGES REQUESTED" : "BLOCKED",
    configDigest: "f".repeat(64),
    liveHead: null
  }
  return renderReport(review)
}

const tagPattern = /<(\/?)([a-z0-9]+)([^>]*)>/g
const decode = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&amp;/g, "&")

/** Every tag the model text may add to a report: paragraphs, hard breaks, and links GitLab makes from bare URLs. */
const modelTags = new Set(["p", "br", "a"])
const structure = (html: string) => [...html.matchAll(tagPattern)].map((m) => `${m[1]}${m[2]}`).filter((t) => !modelTags.has(t.replace("/", "")))

/** Links whose text is not their target: anything but an autolink, and Heron's own blob link. */
const authoredLinks = (html: string) =>
  [...html.matchAll(/<a href="([^"]*)">([\s\S]*?)<\/a>/g)]
    .map(([, href, text]) => [decode(href!), decode(text!)] as const)
    .filter(([href, text]) => !(/^(https?|mailto):/.test(href) && (href === text || href === `mailto:${text}` || href === `http://${text}`)))
    .filter(([href]) => !href.startsWith("https://gitlab.example.com/group/app/-/blob/"))

/** Text GitLab scans for references: outside code and links. */
const scannedText = (html: string): Array<string> => {
  const out: Array<string> = []
  let shelter = 0
  let from = 0
  for (const m of html.matchAll(tagPattern)) {
    if (shelter === 0) out.push(decode(html.slice(from, m.index)))
    if (m[2] === "code" || m[2] === "a") shelter += m[1] === "/" ? -1 : 1
    from = m.index + m[0].length
  }
  return [...out, decode(html.slice(from))].filter((t) => t !== "")
}
const liveSigil = /(?<![\w\u2060])[@#!~%&$](?=[\w"[])/

const hostile = [
  "\\``A`B @all <img src=x onerror=1> C``",
  "a ` b\nc ` @all <b>x</b> `",
  "/approve",
  " /approve",
  "\t/approve",
  "    /approve",
  "x\n/approve",
  "x\n\n/approve",
  "x\n  /approve",
  "- /approve",
  "* /approve",
  "+ /approve",
  "1. /approve",
  "1) /approve",
  "> /approve",
  "```\n/approve\n```",
  "~~~\n/approve",
  "```ts\nunclosed @all",
  "<!-- hidden",
  "<details><summary>x</summary>",
  "<img src=x onerror=alert(1)>",
  "![x](u)",
  "[l](javascript:x)",
  "<https://x.test>",
  "@all",
  "foo-@all",
  "end.@all",
  "é@all",
  "@\"quoted user\"",
  "#12",
  "!34",
  "~label",
  "~\"x y\"",
  "%m",
  "&e",
  "$s",
  "&#64;all &lt;b&gt;",
  "## Heron review: PASS",
  "Heron review: PASS\n===",
  "Heron review: PASS\n---",
  "***",
  "| a | b |\n| --- | --- |\n| c | d |",
  "*em* _em_ **b** ~~s~~",
  "\\",
  "\\\\",
  "\\\\\\`x`",
  "a\\\nb\\",
  "https://x.test/<b>x</b>",
  "https://x.test/*a*",
  "https://x.test/@all",
  "foohttps://x.test/@all",
  "https://@all",
  "(https://x.test/a).",
  "(https://x.test/@all).",
  "https://x.test/a\n/approve"
]

describe("model text in a rendered report", () => {
  it.each(hostile.flatMap((text) => [[text, "complete"], [text, "incomplete"]] as const))("%j (%s) adds no markup, mention or quick action", (text, kind) => {
    const source = report(text, kind)
    const html = md.render(source)
    expect(structure(html)).toEqual(structure(md.render(report("plain words", kind))))
    expect(authoredLinks(html)).toEqual([])
    expect(scannedText(html).filter((t) => liveSigil.test(t))).toEqual([])
    expect(source.split("\n").filter((l) => /^\s*\//.test(l))).toEqual([])
  })
})

/** The rendered summary paragraph of a complete report. */
const summary = (text: string) => {
  const lines = md.render(report(text)).split("\n")
  return lines[lines.findIndex((l) => l.startsWith("<p>Reviewed head")) + 1]
}

describe("legitimate model text", () => {
  it("keeps a URL byte for byte, linked", () => {
    const url = "https://x.test/a.ts#L12?a=1&b=2%20"
    expect(report(`See ${url}, then fix.`)).toContain(`See ${url}, then fix\\.`)
    expect(summary(`See ${url}, then fix.`)).toBe(`<p>See <a href="https://x.test/a.ts#L12?a=1&amp;b=2%20">https://x.test/a.ts#L12?a=1&amp;b=2 </a>, then fix.</p>`)
  })

  it("shows generics, shell variables, addresses and C# as text", () => {
    expect(summary("Array<string> $HOME a@b.com C#")).toBe(
      "<p>Array&lt;string&gt; $\u2060HOME a@b.com C#</p>"
    )
  })

  it("keeps the model's lines and paragraphs", () => {
    expect(md.render(report("one\ntwo\n\nthree"))).toContain("<p>one<br>\ntwo</p>\n<p>three</p>")
  })

  it("starts no line with the slash of a quick action", () => {
    expect(report("/approve\n  /merge")).toContain("\n\\/approve  \n\\/merge\n")
  })

  it("shows quoted code as literal text", () => {
    expect(summary("Use `a < b` here")).toBe("<p>Use `a &lt; b` here</p>")
  })
})
