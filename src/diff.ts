import type { Change, DiffAnchor } from "./domain.ts"

const hunkHeader = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/

/** One hunk: its base-side line count, the first base-side line it covers, and each line with its number on either side. */
interface Hunk {
  readonly oldFirst: number
  readonly oldCount: number
  readonly newCount: number
  /** An added line has no `old`, a removed line no `new`, an unchanged line both. */
  readonly lines: ReadonlyArray<{ readonly old: number | null; readonly new: number | null }>
}

/** The hunk header's counts end each hunk, so text after the last hunk is never read as a line. */
const hunksOf = (diff: string): ReadonlyArray<Hunk> => {
  const hunks: Array<Hunk & { lines: Array<Hunk["lines"][number]> }> = []
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
      // A hunk that removes nothing names the base-side line it inserts after.
      hunks.push({ oldFirst: oldLeft === 0 ? oldLine + 1 : oldLine, oldCount: oldLeft, newCount: newLeft, lines: [] })
      continue
    }
    const hunk = hunks.at(-1)
    if (hunk === undefined || (oldLeft === 0 && newLeft === 0)) continue
    // A transport that trims trailing spaces turns an unchanged empty line into an empty one.
    const kind = line === "" && oldLeft > 0 && newLeft > 0 ? " " : line[0]
    if (kind === "+" && newLeft > 0) {
      hunk.lines.push({ old: null, new: newLine++ })
      newLeft--
    } else if (kind === "-" && oldLeft > 0) {
      hunk.lines.push({ old: oldLine++, new: null })
      oldLeft--
    } else if (kind === " " && oldLeft > 0 && newLeft > 0) {
      hunk.lines.push({ old: oldLine++, new: newLine++ })
      oldLeft--
      newLeft--
    }
    // `\ No newline at end of file` changes no line number.
  }
  return hunks
}

/**
 * The head-side lines of a unified diff that GitLab can hold a discussion on, each with its base-side line: null for
 * an added line, the old number for an unchanged line inside a hunk. Removed lines have no head-side number.
 */
export const diffLines = (diff: string): ReadonlyMap<number, number | null> =>
  new Map(hunksOf(diff).flatMap((h) => h.lines.flatMap((l) => l.new === null ? [] : [[l.new, l.old] as const])))

/**
 * Where base-side `line` is on the head side of a diff: an unchanged line moves by the lines the hunks before it added
 * and removed. A line the diff removed or rewrote has no head-side number, so the result is null.
 */
export const lineAfter = (diff: string, line: number): number | null => {
  let shift = 0
  for (const hunk of hunksOf(diff)) {
    if (line < hunk.oldFirst) break
    if (line < hunk.oldFirst + hunk.oldCount) return hunk.lines.find((l) => l.old === line)?.new ?? null
    shift += hunk.newCount - hunk.oldCount
  }
  return line + shift
}

/**
 * Where a location read at an earlier head is after `delta`, the changes from that head to the reviewed one: the file's
 * path after a rename, and the line moved through the file's hunks. The line is null when the delta removed or rewrote
 * it, deleted the file, or the location had no line already.
 */
export const locationAfter = (
  delta: ReadonlyArray<Change>,
  location: { readonly path: string; readonly line: number | null }
): { readonly path: string; readonly line: number | null } => {
  const change = delta.find((c) => (c.oldPath ?? c.path) === location.path)
  if (change === undefined) return location
  return {
    path: change.path,
    line: location.line === null || change.status === "deleted" ? null : lineAfter(change.diff, location.line)
  }
}

/** Where a discussion on `line` of `path` at the head can sit, or null when that line is not part of the merge request diff. */
export const anchorAt = (changes: ReadonlyArray<Change>, location: { readonly path: string; readonly line: number | null }): DiffAnchor | null => {
  const change = changes.find((c) => c.path === location.path)
  if (change === undefined || location.line === null) return null
  const lines = diffLines(change.diff)
  if (!lines.has(location.line)) return null
  return { oldPath: change.oldPath ?? change.path, newPath: change.path, newLine: location.line, oldLine: lines.get(location.line) ?? null }
}

/** Whether `count` lines from `location` are all lines of the merge request diff at the head, which the author sees there. */
export const withinDiff = (changes: ReadonlyArray<Change>, location: { readonly path: string; readonly line: number | null }, count: number): boolean => {
  const change = changes.find((c) => c.path === location.path)
  if (change === undefined || location.line === null) return false
  const lines = diffLines(change.diff)
  return Array.from({ length: count }, (_, i) => location.line! + i).every((l) => lines.has(l))
}
