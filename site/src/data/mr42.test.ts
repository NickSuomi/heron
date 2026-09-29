import { describe, expect, it } from "vitest"

import { mr42 } from "./mr42"

const file = (path: string) => mr42.files.find((changed) => changed.path === path)

describe("merge request !42", () => {
  it("says it is fictional", () => {
    expect(mr42.isFictional).toBe(true)
  })

  it("diffs a modified file with git's hunk header and three lines of context", () => {
    expect(file("src/locales/en.json")?.diff).toBe(
      [
        "@@ -1,5 +1,6 @@",
        " {",
        '   "projects": {',
        '+    "archiveSelected": "Archive {count} projects",',
        '     "empty": "No projects match this filter.",',
        '     "title": "Projects"',
        "   }",
      ].join("\n"),
    )
  })

  it("diffs an added file from line zero", () => {
    expect(file("src/projects/archive.ts")?.diff.split("\n")[0]).toBe("@@ -0,0 +1,14 @@")
  })

  it("puts every finding on a line of the reviewed file that holds its excerpt", () => {
    expect(
      mr42.findings.map((finding) => [finding.id, `${finding.path}:${finding.line}`, file(finding.path)?.after.split("\n")[finding.line - 1]?.includes(finding.excerpt)]),
    ).toEqual([
      ["gate.correctness#1", "src/projects/archive.ts:12", true],
      ["gate.design#1", "src/projects/ProjectList.vue:15", true],
      ["gate.design#2", "src/locales/en.json:3", true],
      ["gate.correctness#2", "src/projects/ProjectList.vue:18", true],
      ["supervisor#1", "src/projects/archive.ts:11", true],
    ])
  })

  it("carries the note Heron's renderReport wrote, marker first", () => {
    expect(mr42.note.split("\n").slice(0, 4)).toEqual([
      "<!-- heron:v1 mr=42 head=9abe74a0d67dfd7a0c5e599d51a1edfd91c0e3e7 config=90980f470d74e1f4b1239b864b8030a43317076cb182936f4c38b302a409a292 verdict=changes-requested -->",
      "## Heron review: CHANGES REQUESTED",
      "",
      "1 blocker · 4 advisories · head `9abe74a0` · lane `standard`",
    ])
  })
})
