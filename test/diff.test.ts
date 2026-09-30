import { describe, expect, it } from "@effect/vitest"
import { anchorAt, diffLines } from "../src/diff.ts"
import type { Change } from "../src/domain.ts"

const modified = [
  "@@ -1,4 +1,5 @@ export const a = 1",
  " one",
  "-two",
  "+TWO",
  "+two and a half",
  " three",
  " four",
  "@@ -20,3 +21,2 @@",
  " twenty",
  "-twenty-one",
  " twenty-two",
  "\\ No newline at end of file",
  ""
].join("\n")

describe("diffLines", () => {
  it("maps each added line to null and each unchanged line to its old number, and skips removed lines", () => {
    expect([...diffLines(modified)]).toEqual([[1, 1], [2, null], [3, null], [4, 3], [5, 4], [21, 20], [22, 22]])
  })

  it("reads a hunk header without counts as one line", () => {
    expect([...diffLines("@@ -3 +3 @@\n-old\n+new")]).toEqual([[3, null]])
  })

  it("counts an unchanged empty line whose leading space was trimmed", () => {
    expect([...diffLines("@@ -1,3 +1,3 @@\n a\n\n-b\n+c")]).toEqual([[1, 1], [2, 2], [3, null]])
  })

  it("reads nothing outside a hunk, a deleted file's lines, or a binary diff", () => {
    expect([
      [...diffLines("+not in a hunk\n@@ -1 +1 @@\n-a\n+b\n+past the counts")],
      [...diffLines("@@ -1,2 +0,0 @@\n-a\n-b\n")],
      [...diffLines("Binary files a/logo.png and b/logo.png differ\n")]
    ]).toEqual([[[1, null]], [], []])
  })
})

describe("anchorAt", () => {
  const changes: ReadonlyArray<Change> = [
    { path: "src/a.ts", oldPath: null, status: "modified", diff: modified },
    { path: "src/moved.ts", oldPath: "src/old.ts", status: "renamed", diff: "@@ -8,2 +8,2 @@\n keep\n-x\n+y\n" }
  ]

  it("anchors an added line by its new number and an unchanged line by both", () => {
    expect([anchorAt(changes, { path: "src/a.ts", line: 2 }), anchorAt(changes, { path: "src/a.ts", line: 22 })]).toEqual([
      { oldPath: "src/a.ts", newPath: "src/a.ts", newLine: 2, oldLine: null },
      { oldPath: "src/a.ts", newPath: "src/a.ts", newLine: 22, oldLine: 22 }
    ])
  })

  it("uses the old path of a renamed file", () => {
    expect(anchorAt(changes, { path: "src/moved.ts", line: 8 })).toEqual({ oldPath: "src/old.ts", newPath: "src/moved.ts", newLine: 8, oldLine: 8 })
  })

  it("returns null for a line between hunks, a path the merge request does not change, and a path given by its old name", () => {
    expect([
      anchorAt(changes, { path: "src/a.ts", line: 10 }),
      anchorAt(changes, { path: "src/b.ts", line: 1 }),
      anchorAt(changes, { path: "src/old.ts", line: 8 })
    ]).toEqual([null, null, null])
  })
})
