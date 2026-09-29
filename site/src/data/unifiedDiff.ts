// A small unified diff (three lines of context, git's hunk headers) over whole files. The merge request's diff is
// computed from its before and after contents, so the diff, the files the editor opens and the finding lines agree.

type Op = Readonly<{ kind: " " | "-" | "+"; text: string }>

const linesOf = (text: string): ReadonlyArray<string> => (text === "" ? [] : text.replace(/\n$/, "").split("\n"))

const operations = (before: ReadonlyArray<string>, after: ReadonlyArray<string>): ReadonlyArray<Op> => {
  const rows = before.length + 1
  const cols = after.length + 1
  const common = new Array<number>(rows * cols).fill(0)
  for (let i = before.length - 1; i >= 0; i--)
    for (let j = after.length - 1; j >= 0; j--)
      common[i * cols + j] =
        before[i] === after[j] ? (common[(i + 1) * cols + j + 1] ?? 0) + 1 : Math.max(common[(i + 1) * cols + j] ?? 0, common[i * cols + j + 1] ?? 0)
  const ops: Array<Op> = []
  let i = 0
  let j = 0
  while (i < before.length || j < after.length) {
    if (i < before.length && j < after.length && before[i] === after[j]) {
      ops.push({ kind: " ", text: before[i++] ?? "" })
      j++
    } else if (j >= after.length || (i < before.length && (common[(i + 1) * cols + j] ?? 0) >= (common[i * cols + j + 1] ?? 0))) {
      ops.push({ kind: "-", text: before[i++] ?? "" })
    } else {
      ops.push({ kind: "+", text: after[j++] ?? "" })
    }
  }
  return ops
}

const range = (start: number, count: number): string => (count === 1 ? `${start}` : `${count === 0 ? start - 1 : start},${count}`)

/** The hunks of one file, as GitLab returns a change's `diff`: no file header, one `@@` line per hunk. */
export const fileDiff = (before: string, after: string, context = 3): string => {
  const ops = operations(linesOf(before), linesOf(after))
  const changed = ops.flatMap((op, index) => (op.kind === " " ? [] : [index]))
  const groups: Array<[number, number]> = []
  for (const index of changed) {
    const last = groups[groups.length - 1]
    if (last !== undefined && index - last[1] <= context * 2 + 1) last[1] = index
    else groups.push([index, index])
  }
  const oldLine = (upTo: number) => ops.slice(0, upTo).filter((op) => op.kind !== "+").length + 1
  const newLine = (upTo: number) => ops.slice(0, upTo).filter((op) => op.kind !== "-").length + 1
  return groups
    .map(([first, last]) => {
      const from = Math.max(first - context, 0)
      const to = Math.min(last + context, ops.length - 1)
      const body = ops.slice(from, to + 1)
      const oldCount = body.filter((op) => op.kind !== "+").length
      const newCount = body.filter((op) => op.kind !== "-").length
      return [`@@ -${range(oldLine(from), oldCount)} +${range(newLine(from), newCount)} @@`, ...body.map((op) => `${op.kind}${op.text}`)].join("\n")
    })
    .join("\n")
}

export type DiffFile = Readonly<{ path: string; status: "added" | "modified"; before: string; after: string }>

/** The whole change as `git diff` prints it, file headers included. */
export const unifiedDiff = (files: ReadonlyArray<DiffFile>): string =>
  files
    .map((file) =>
      [
        `diff --git a/${file.path} b/${file.path}`,
        ...(file.status === "added" ? ["new file mode 100644", "--- /dev/null"] : [`--- a/${file.path}`]),
        `+++ b/${file.path}`,
        fileDiff(file.before, file.after),
      ].join("\n"),
    )
    .join("\n")
    .concat("\n")
