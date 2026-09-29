import { describe, expect, it } from "vitest"

import { mr42 } from "../data/mr42"
import { type Block, parseInline, parseMarkdown, plainText } from "./gitlabMarkdown"

const blocks = parseMarkdown(mr42.note)

const shape = (block: Block): string =>
  block._tag === "Heading" ? `h${block.level}` : block._tag === "Details" ? `details:${plainText(block.summary)}` : block._tag

const strip = (text: string) => text.replaceAll("⁠", "")

describe("the report note as the mock GitLab renders it", () => {
  it("hides the marker and keeps the report's sections in order", () => {
    expect(blocks.map(shape)).toEqual([
      "h2",
      "Paragraph",
      "Paragraph",
      "h3",
      "List",
      "h3",
      "List",
      "details:REVIEW CHECKS",
      "details:AGENT PROVENANCE",
    ])
    expect(JSON.stringify(blocks)).not.toContain("heron:v1")
  })

  it("renders each finding as a loose list item with its file:line link", () => {
    const findings = blocks[4]
    if (findings?._tag !== "List") throw new Error("no findings list")
    expect(findings.isLoose).toBe(true)
    expect(findings.items).toHaveLength(5)
    const [title] = findings.items[0] ?? []
    if (title?._tag !== "Paragraph") throw new Error("no finding title")
    const link = title.children.find((inline) => inline._tag === "Link")
    expect(link?._tag === "Link" && link.href).toBe(
      "https://gitlab.heron.local/acme/storefront/-/blob/9abe74a0d67dfd7a0c5e599d51a1edfd91c0e3e7/src/projects/archive.ts#L12",
    )
    expect(strip(plainText(title.children))).toBe("Blocker correctness Archiving deletes the projects (src/projects/archive.ts:12)")
  })

  it("unescapes the plain text Heron escaped", () => {
    const summary = blocks[2]
    expect(summary?._tag === "Paragraph" && strip(plainText(summary.children))).toBe(
      "Adds bulk archiving to the project list: a checkbox on each row, an Archive button and an archiveSelected helper. The helper deletes each project instead of archiving it, so the change cannot merge as it is. Four smaller issues concern the selection type, rows hidden by the filter, a partial failure, and the button label.",
    )
  })

  it("parses the provenance table inside its details", () => {
    const provenance = blocks[8]
    if (provenance?._tag !== "Details") throw new Error("no provenance")
    const [table] = provenance.children
    if (table?._tag !== "Table") throw new Error("no table")
    expect(table.head.map(plainText)).toEqual([
      "Session", "Role", "Backend", "Model", "Effort", "Tokens in / out", "Tool calls", "Duration", "Vendor cost", "Result",
    ])
    expect(table.rows.map((row) => strip(plainText(row[3] ?? [])))).toEqual(["<fast model id>", "<fast model id>", "<fast model id>", "<strong model id>"])
  })

  it("turns two trailing spaces into a hard break", () => {
    expect(parseInline("one  \ntwo")).toEqual([{ _tag: "Text", text: "one" }, { _tag: "Break" }, { _tag: "Text", text: "two" }])
  })
})
