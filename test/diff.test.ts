import { describe, expect, it } from "@effect/vitest"
import { anchorAt, diffLines, lineAfter, locationAfter, withinDiff } from "../src/diff.ts"
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

describe("lineAfter", () => {
  it("moves an unchanged line before, inside, between and after the hunks by the lines they added and removed", () => {
    expect([1, 3, 4, 10, 20, 22, 30].map((line) => lineAfter(modified, line))).toEqual([1, 4, 5, 11, 21, 22, 30])
  })

  it("gives a removed or rewritten line no position", () => {
    expect([lineAfter(modified, 2), lineAfter(modified, 21), lineAfter("@@ -3 +3 @@\n-old\n+new", 3)]).toEqual([null, null, null])
  })

  it("moves the lines after a pure insertion and a pure removal", () => {
    const inserted = "@@ -5,0 +6,2 @@\n+a\n+b"
    const removed = "@@ -3,2 +2,0 @@\n-a\n-b"
    expect([lineAfter(inserted, 5), lineAfter(inserted, 6), lineAfter(removed, 2), lineAfter(removed, 3), lineAfter(removed, 5)]).toEqual([5, 8, 2, null, 3])
  })

  it("keeps every line of a diff with no hunk, such as a rename without edits", () => {
    expect(lineAfter("", 7)).toBe(7)
  })
})

describe("locationAfter", () => {
  const delta: ReadonlyArray<Change> = [
    { path: "src/a.ts", oldPath: null, status: "modified", diff: modified },
    { path: "src/moved.ts", oldPath: "src/old.ts", status: "renamed", diff: "@@ -1,0 +2,1 @@\n+new first\n" },
    { path: "src/gone.ts", oldPath: null, status: "deleted", diff: "@@ -1,2 +0,0 @@\n-a\n-b\n" }
  ]

  it("keeps a file the delta does not touch, moves a line in a changed file, and follows a rename", () => {
    expect([
      locationAfter(delta, { path: "src/untouched.ts", line: 9 }),
      locationAfter(delta, { path: "src/a.ts", line: 10 }),
      locationAfter(delta, { path: "src/old.ts", line: 4 })
    ]).toEqual([{ path: "src/untouched.ts", line: 9 }, { path: "src/a.ts", line: 11 }, { path: "src/moved.ts", line: 5 }])
  })

  it("gives no line to a rewritten line, a deleted file, or a line that already had none", () => {
    expect([
      locationAfter(delta, { path: "src/a.ts", line: 2 }),
      locationAfter(delta, { path: "src/gone.ts", line: 1 }),
      locationAfter(delta, { path: "src/old.ts", line: null })
    ]).toEqual([{ path: "src/a.ts", line: null }, { path: "src/gone.ts", line: null }, { path: "src/moved.ts", line: null }])
  })
})

describe("withinDiff", () => {
  const changes: ReadonlyArray<Change> = [{ path: "src/a.ts", oldPath: null, status: "modified", diff: modified }]

  it("holds when every line of the range is a line of the merge request diff at the head", () => {
    expect([
      withinDiff(changes, { path: "src/a.ts", line: 2 }, 4),
      withinDiff(changes, { path: "src/a.ts", line: 4 }, 3),
      withinDiff(changes, { path: "src/a.ts", line: 21 }, 3),
      withinDiff(changes, { path: "src/b.ts", line: 1 }, 1),
      withinDiff(changes, { path: "src/a.ts", line: null }, 1)
    ]).toEqual([true, false, false, false, false])
  })
})
