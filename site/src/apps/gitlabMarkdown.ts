// The part of GitLab Flavored Markdown that Heron's report note uses, parsed into a tree the mock GitLab renders:
// headings, paragraphs with hard breaks, tight and loose lists, pipe tables, <details> with a <summary>, code spans,
// bold, links and backslash escapes. HTML comments render as nothing, as GitLab hides Heron's marker.

export type Inline =
  | Readonly<{ _tag: "Text"; text: string }>
  | Readonly<{ _tag: "Code"; text: string }>
  | Readonly<{ _tag: "Strong"; children: ReadonlyArray<Inline> }>
  | Readonly<{ _tag: "Link"; href: string; children: ReadonlyArray<Inline> }>
  | Readonly<{ _tag: "Break" }>

export type Block =
  | Readonly<{ _tag: "Heading"; level: number; children: ReadonlyArray<Inline> }>
  | Readonly<{ _tag: "Paragraph"; children: ReadonlyArray<Inline> }>
  | Readonly<{ _tag: "List"; isLoose: boolean; items: ReadonlyArray<ReadonlyArray<Block>> }>
  | Readonly<{ _tag: "Table"; head: ReadonlyArray<ReadonlyArray<Inline>>; rows: ReadonlyArray<ReadonlyArray<ReadonlyArray<Inline>>> }>
  | Readonly<{ _tag: "Details"; summary: ReadonlyArray<Inline>; children: ReadonlyArray<Block> }>

const punctuation = /[!-/:-@[-`{-~]/

/** The index of the next unescaped `target` at or after `from`, or -1. */
const findUnescaped = (text: string, target: string, from: number): number => {
  for (let i = from; i < text.length; i++) {
    if (text[i] === "\\" && punctuation.test(text[i + 1] ?? "")) i++
    else if (text.startsWith(target, i)) return i
  }
  return -1
}

export const parseInline = (text: string): ReadonlyArray<Inline> => {
  const out: Array<Inline> = []
  let buffer = ""
  const flush = () => {
    if (buffer !== "") out.push({ _tag: "Text", text: buffer })
    buffer = ""
  }
  let i = 0
  while (i < text.length) {
    const char = text[i] ?? ""
    const next = text[i + 1] ?? ""
    if (char === "\\" && punctuation.test(next)) {
      buffer += next
      i += 2
    } else if (char === "\\" && next === "\n") {
      flush()
      out.push({ _tag: "Break" })
      i += 2
    } else if (char === " " && text.startsWith(" \n", i + 1)) {
      flush()
      out.push({ _tag: "Break" })
      i += 3
    } else if (char === "\n") {
      buffer += " "
      i++
    } else if (char === "`") {
      const end = text.indexOf("`", i + 1)
      if (end === -1) {
        buffer += char
        i++
      } else {
        flush()
        out.push({ _tag: "Code", text: text.slice(i + 1, end) })
        i = end + 1
      }
    } else if (text.startsWith("**", i)) {
      const end = findUnescaped(text, "**", i + 2)
      if (end === -1) {
        buffer += "**"
        i += 2
      } else {
        flush()
        out.push({ _tag: "Strong", children: parseInline(text.slice(i + 2, end)) })
        i = end + 2
      }
    } else if (char === "[") {
      const close = findUnescaped(text, "](", i + 1)
      const end = close === -1 ? -1 : text.indexOf(")", close + 2)
      if (end === -1) {
        buffer += char
        i++
      } else {
        flush()
        out.push({ _tag: "Link", href: text.slice(close + 2, end), children: parseInline(text.slice(i + 1, close)) })
        i = end + 1
      }
    } else {
      buffer += char
      i++
    }
  }
  flush()
  return out
}

const isBlank = (line: string): boolean => line.trim() === ""
const heading = /^(#{1,6}) (.*)$/
const listItem = /^[-*] (.*)$/
const summary = /^<summary>(.*)<\/summary>$/

const splitRow = (line: string): ReadonlyArray<string> => {
  const inner = line.trim().replace(/^\|/, "").replace(/\|$/, "")
  const cells: Array<string> = []
  let from = 0
  for (let at = findUnescaped(inner, "|", 0); at !== -1; at = findUnescaped(inner, "|", from)) {
    cells.push(inner.slice(from, at))
    from = at + 1
  }
  cells.push(inner.slice(from))
  return cells.map((cell) => cell.trim())
}

const startsBlock = (line: string): boolean =>
  heading.test(line) || listItem.test(line) || line.startsWith("|") || line.startsWith("<details>") || line.startsWith("<!--")

export const parseBlocks = (lines: ReadonlyArray<string>): ReadonlyArray<Block> => {
  const blocks: Array<Block> = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i] ?? ""
    const headingMatch = heading.exec(line)
    if (isBlank(line)) {
      i++
    } else if (line.startsWith("<!--")) {
      while (i < lines.length && !(lines[i] ?? "").includes("-->")) i++
      i++
    } else if (headingMatch !== null) {
      blocks.push({ _tag: "Heading", level: headingMatch[1]?.length ?? 1, children: parseInline(headingMatch[2] ?? "") })
      i++
    } else if (line.startsWith("<details>")) {
      let depth = 1
      let end = i + 1
      while (end < lines.length && depth > 0) {
        const current = lines[end] ?? ""
        if (current.startsWith("<details>")) depth++
        if (current.startsWith("</details>")) depth--
        if (depth > 0) end++
      }
      const body = lines.slice(i + 1, end)
      const summaryAt = body.findIndex((entry) => summary.test(entry.trim()))
      blocks.push({
        _tag: "Details",
        summary: parseInline(summaryAt === -1 ? "Details" : (summary.exec(body[summaryAt]?.trim() ?? "")?.[1] ?? "")),
        children: parseBlocks(summaryAt === -1 ? body : body.filter((_, index) => index !== summaryAt)),
      })
      i = end + 1
    } else if (line.startsWith("|")) {
      const rows: Array<string> = []
      while (i < lines.length && (lines[i] ?? "").startsWith("|")) rows.push(lines[i++] ?? "")
      const [head = "", , ...body] = rows
      blocks.push({ _tag: "Table", head: splitRow(head).map(parseInline), rows: body.map((row) => splitRow(row).map(parseInline)) })
    } else if (listItem.test(line)) {
      const items: Array<Array<string>> = []
      let isLoose = false
      while (i < lines.length) {
        const current = lines[i] ?? ""
        const itemMatch = listItem.exec(current)
        if (itemMatch !== null) {
          items.push([itemMatch[1] ?? ""])
          i++
        } else if (current.startsWith("  ") && !isBlank(current)) {
          items[items.length - 1]?.push(current.slice(2))
          i++
        } else if (isBlank(current) && i + 1 < lines.length && ((lines[i + 1] ?? "").startsWith("  ") || listItem.test(lines[i + 1] ?? ""))) {
          isLoose = true
          items[items.length - 1]?.push("")
          i++
        } else break
      }
      blocks.push({ _tag: "List", isLoose, items: items.map(parseBlocks) })
    } else {
      const paragraph: Array<string> = []
      while (i < lines.length && !isBlank(lines[i] ?? "") && (paragraph.length === 0 || !startsBlock(lines[i] ?? ""))) paragraph.push(lines[i++] ?? "")
      blocks.push({ _tag: "Paragraph", children: parseInline(paragraph.join("\n")) })
    }
  }
  return blocks
}

export const parseMarkdown = (source: string): ReadonlyArray<Block> => parseBlocks(source.replace(/\r\n?/g, "\n").split("\n"))

/** The text a reader sees, without markup: for tests and for accessible names. */
export const plainText = (inlines: ReadonlyArray<Inline>): string =>
  inlines
    .map((inline) =>
      inline._tag === "Text" || inline._tag === "Code" ? inline.text : inline._tag === "Break" ? "\n" : plainText(inline.children),
    )
    .join("")
