import type { Change, DiffAnchor } from "./domain.ts"

const hunkHeader = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/

/**
 * The head-side lines of a unified diff that GitLab can hold a discussion on, each with its base-side line: null for
 * an added line, the old number for an unchanged line inside a hunk. Removed lines have no head-side number. The
 * hunk header's counts end each hunk, so text after the last hunk is never read as a line.
 */
export const diffLines = (diff: string): ReadonlyMap<number, number | null> => {
  const lines = new Map<number, number | null>()
  let oldLine = 0
  let newLine = 0
  let oldLeft = 0
  let newLeft = 0
  for (const line of diff.split("\n")) {
    const header = hunkHeader.exec(line)
    if (header !== null) {
      oldLine = Number(header[1])
      oldLeft = header[2] === undefined ? 1 : Number(header[2])
      newLine = Number(header[3])
      newLeft = header[4] === undefined ? 1 : Number(header[4])
      continue
    }
    if (oldLeft === 0 && newLeft === 0) continue
    // A transport that trims trailing spaces turns an unchanged empty line into an empty one.
    const kind = line === "" && oldLeft > 0 && newLeft > 0 ? " " : line[0]
    if (kind === "+" && newLeft > 0) {
      lines.set(newLine++, null)
      newLeft--
    } else if (kind === "-" && oldLeft > 0) {
      oldLine++
      oldLeft--
    } else if (kind === " " && oldLeft > 0 && newLeft > 0) {
      lines.set(newLine++, oldLine++)
      oldLeft--
      newLeft--
    }
    // `\ No newline at end of file` changes no line number.
  }
  return lines
}

/** Where a discussion on `line` of `path` at the head can sit, or null when that line is not part of the merge request diff. */
export const anchorAt = (changes: ReadonlyArray<Change>, location: { readonly path: string; readonly line: number }): DiffAnchor | null => {
  const change = changes.find((c) => c.path === location.path)
  if (change === undefined) return null
  const lines = diffLines(change.diff)
  if (!lines.has(location.line)) return null
  return { oldPath: change.oldPath ?? change.path, newPath: change.path, newLine: location.line, oldLine: lines.get(location.line) ?? null }
}
