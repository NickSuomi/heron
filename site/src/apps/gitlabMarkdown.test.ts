import { describe, expect, it } from "vitest"

import { mr42 } from "../data/mr42"
import { type Block, parseInline, parseMarkdown, plainText } from "./gitlabMarkdown"

const blocks = parseMarkdown(mr42.note)

const shape = (block: Block): string =>
  block._tag === "Heading" ? `h${block.level}` : block._tag === "Details" ? `details:${plainText(block.summary)}` : block._tag

const strip = (text: string) => text.replaceAll("\u2060", "")

const details = (summary: string): ReadonlyArray<Block> => {
  const found = blocks.find((block) => block._tag === "Details" && plainText(block.summary) === summary)
  if (found?._tag !== "Details") throw new Error(`no details "${summary}"`)
  return found.children
}

const listText = (block: Block | undefined): ReadonlyArray<string> => {
  if (block?._tag !== "List") throw new Error("not a list")
  return block.items.map((item) => item.map((child) => (child._tag === "Paragraph" ? strip(plainText(child.children)) : child._tag)).join("\n"))
}

const tableText = (block: Block | undefined) => {
  if (block?._tag !== "Table") throw new Error("not a table")
  return { head: block.head.map(plainText), rows: block.rows.map((row) => row.map((cell) => strip(plainText(cell)))) }
}

describe("the report note as the mock GitLab renders it", () => {
  it("hides the marker and shows the verdict, counts, summary and blockers, with the rest collapsed", () => {
    expect(blocks.map(shape)).toEqual([
      "h2",
      "Paragraph",
      "Paragraph",
      "h3",
      "List",
      "details:4 advisories",
      "details:REVIEW CHECKS",
      "details:AGENT PROVENANCE",
    ])
    expect(JSON.stringify(blocks)).not.toContain("heron:v1")
  })

  it("renders the counts line with the head and lane as code", () => {
    expect(blocks[1]).toEqual({
      _tag: "Paragraph",
      children: [
        { _tag: "Text", text: "1 blocker · 4 advisories · head " },
        { _tag: "Code", text: "9abe74a0" },
        { _tag: "Text", text: " · lane " },
        { _tag: "Code", text: "standard" },
      ],
    })
  })

  it("unescapes the two-sentence summary Heron escaped", () => {
    const summary = blocks[2]
    expect(summary?._tag === "Paragraph" && strip(plainText(summary.children))).toBe(
      "Adds bulk archiving to the project list: a checkbox on each row, an Archive button and an archiveSelected helper. The helper deletes each project instead of archiving it, so the change cannot merge as it is.",
    )
  })

  it("renders the blocker as a tight list item: gate, title, file:line link, a hard break, then the body", () => {
    const list = blocks[4]
    if (list?._tag !== "List") throw new Error("no blocker list")
    expect(list.isLoose).toBe(false)
    const [item] = list.items
    const [paragraph] = item ?? []
    if (paragraph?._tag !== "Paragraph") throw new Error("no blocker paragraph")
    expect(paragraph.children.slice(0, 5)).toEqual([
      { _tag: "Code", text: "correctness" },
      { _tag: "Text", text: " Archiving deletes the projects (" },
      {
        _tag: "Link",
        href: "https://gitlab.heron.local/acme/storefront/-/blob/9abe74a0d67dfd7a0c5e599d51a1edfd91c0e3e7/src/projects/archive.ts#L12",
        children: [{ _tag: "Text", text: "src/\u2060projects/\u2060archive.\u2060ts:\u206012" }],
      },
      { _tag: "Text", text: ")" },
      { _tag: "Break" },
    ])
    expect(listText(list)).toEqual([
      "correctness Archiving deletes the projects (src/projects/archive.ts:12)\narchiveSelected sends DELETE /projects/:id for every id, which removes the projects that the doc comment on line 6 and the button promise to archive. Call the archive endpoint instead, for example POST /projects/:id/archive, and pin the request in a test.",
    ])
  })

  it("collapses the advisories into their own details, each with its link and body", () => {
    const [list] = details("4 advisories")
    expect(listText(list).map((item) => item.split("\n")[0])).toEqual([
      "design The selection is typed as any[] (src/projects/ProjectList.vue:15)",
      "design The button label has no singular form (src/locales/en.json:3)",
      "correctness Archive acts on rows the filter hides (src/projects/ProjectList.vue:18)",
      "correctness A failed request stops the batch halfway (src/projects/archive.ts:11)",
    ])
  })

  it("renders the gate table, the rulings table, what was not checked, the scope line and the plan under REVIEW CHECKS", () => {
    const [gates, rulings, notCheckedLabel, notChecked, scope, plan] = details("REVIEW CHECKS")
    expect(tableText(gates)).toEqual({
      head: ["Gate", "Status"],
      rows: [["design", "pass"], ["correctness", "changes requested"], ["security", "pass"]],
    })
    expect(tableText(rulings).rows.at(-1)).toEqual([
      "supervisor",
      "gate.security#1 A bulk destructive action runs without confirmation",
      "dropped",
      "A confirmation step is a product decision, not a security boundary; the server checks permissions per project.",
    ])
    expect(notCheckedLabel?._tag === "Paragraph" && plainText(notCheckedLabel.children)).toBe("Not checked:")
    expect(listText(notChecked)).toEqual([
      "The server side of DELETE /projects/:id was not read. src/api/client.ts only forwards the path.",
      "The change adds no test, so the request archiveSelected sends was checked by reading only.",
    ])
    expect(scope?._tag === "Paragraph" && plainText(scope.children)).toBe(
      "Heron reviews by reading the source and target branches. It does not run tests, the app, a browser or a device.",
    )
    expect(plan?._tag === "Paragraph" && plainText(plan.children)).toBe(
      "No classification rule matched; the default lane standard applied. Plan: gated, 4 sessions. Config digest fc7316b64819.",
    )
  })

  it("renders the compact provenance table and its totals line", () => {
    const [table, totals] = details("AGENT PROVENANCE")
    expect(tableText(table)).toEqual({
      head: ["Session", "Model", "Effort", "Tokens in / out", "Duration", "Result"],
      rows: [
        ["gate.design", "<fast model id> (claude)", "low", "18,420 / 1,212", "61.3 s", "ok"],
        ["gate.correctness", "<fast model id> (claude)", "low", "26,905 / 1,804", "88.7 s", "ok"],
        ["gate.security", "<fast model id> (claude)", "low", "15,733 / 690", "52.4 s", "ok"],
        ["supervisor", "<strong model id> (claude)", "high", "31,118 / 2,356", "71.9 s", "ok"],
      ],
    })
    expect(totals?._tag === "Paragraph" && plainText(totals.children)).toBe(
      "Totals: 92,176 / 6,062 tokens in / out, 44 tool calls, no vendor-reported cost.",
    )
  })
})

describe("GitLab Markdown the note can hold", () => {
  it("closes a code span only on a backtick run of the same length and strips one space of padding", () => {
    expect(parseInline("run ``a`b`` and `` `x` `` and ``` `` ```")).toEqual([
      { _tag: "Text", text: "run " },
      { _tag: "Code", text: "a`b" },
      { _tag: "Text", text: " and " },
      { _tag: "Code", text: "`x`" },
      { _tag: "Text", text: " and " },
      { _tag: "Code", text: "``" },
    ])
  })

  it("keeps a code span of only spaces, and an unclosed fence as text", () => {
    expect(parseInline("`  ` then ``a` b")).toEqual([
      { _tag: "Code", text: "  " },
      { _tag: "Text", text: " then ``a` b" },
    ])
  })

  it("shows code span content literally, backslashes included", () => {
    expect(parseInline("`\\*` and \\`not code\\`")).toEqual([
      { _tag: "Code", text: "\\*" },
      { _tag: "Text", text: " and `not code`" },
    ])
  })

  it("does not end a link label at a bracket inside a code span", () => {
    expect(parseInline("[`a](b)` c](https://x.test/c)")).toEqual([
      { _tag: "Link", href: "https://x.test/c", children: [{ _tag: "Code", text: "a](b)" }, { _tag: "Text", text: " c" }] },
    ])
  })

  it("turns two or more trailing spaces into a hard break and one into a soft break", () => {
    expect(parseInline("one  \n  two   \nthree \nfour")).toEqual([
      { _tag: "Text", text: "one" },
      { _tag: "Break" },
      { _tag: "Text", text: "two" },
      { _tag: "Break" },
      { _tag: "Text", text: "three four" },
    ])
  })

  it("drops the backslash of an escape and keeps the word joiner after it, which renders as nothing", () => {
    expect(parseInline("\\[\u2060x\\]\u2060\\(\u2060y\\)\u2060")).toEqual([{ _tag: "Text", text: "[\u2060x]\u2060(\u2060y)\u2060" }])
  })

  it("nests a details block inside another and parses the Markdown inside both", () => {
    expect(
      parseMarkdown(
        ["<details>", "<summary>Outer</summary>", "", "| A |", "| --- |", "| `1` |", "", "<details>", "<summary>Inner</summary>", "", "- item", "", "</details>", "", "</details>", "", "after"].join("\n"),
      ),
    ).toEqual([
      {
        _tag: "Details",
        summary: [{ _tag: "Text", text: "Outer" }],
        children: [
          { _tag: "Table", head: [[{ _tag: "Text", text: "A" }]], rows: [[[{ _tag: "Code", text: "1" }]]] },
          {
            _tag: "Details",
            summary: [{ _tag: "Text", text: "Inner" }],
            children: [{ _tag: "List", isLoose: false, items: [[{ _tag: "Paragraph", children: [{ _tag: "Text", text: "item" }] }]] }],
          },
        ],
      },
      { _tag: "Paragraph", children: [{ _tag: "Text", text: "after" }] },
    ])
  })
})
