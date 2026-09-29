// The Markdown subset the design book uses: headings, paragraphs, lists, tables, fenced code, and inline
// code, bold and links. Help and Support renders it in the app; docs/brand/tools/build_book.ts renders
// the same blocks to site/public/brand/index.html. No imports, so Node runs this file directly.

export type Inline =
  | Readonly<{ kind: "text"; text: string }>
  | Readonly<{ kind: "code"; text: string }>
  | Readonly<{ kind: "strong"; text: string }>
  | Readonly<{ kind: "link"; text: string; href: string }>

export type Block =
  | Readonly<{ kind: "heading"; level: number; text: ReadonlyArray<Inline>; plain: string }>
  | Readonly<{ kind: "paragraph"; text: ReadonlyArray<Inline> }>
  | Readonly<{ kind: "list"; isOrdered: boolean; items: ReadonlyArray<ReadonlyArray<Inline>> }>
  | Readonly<{ kind: "table"; head: ReadonlyArray<ReadonlyArray<Inline>>; rows: ReadonlyArray<ReadonlyArray<ReadonlyArray<Inline>>> }>
  | Readonly<{ kind: "code"; text: string }>

/** A `##` section of the book: one Help topic, one section of the /brand/ page. */
export type Topic = Readonly<{ id: string; title: string; blocks: ReadonlyArray<Block> }>

const inlinePattern = /`([^`]+)`|\*\*([^*]+)\*\*|\[([^\]]+)\]\(([^)]+)\)/g

export const parseInline = (source: string): ReadonlyArray<Inline> => {
  const parts: Array<Inline> = []
  let last = 0
  for (const match of source.matchAll(inlinePattern)) {
    const at = match.index ?? 0
    if (at > last) parts.push({ kind: "text", text: source.slice(last, at) })
    if (match[1] !== undefined) parts.push({ kind: "code", text: match[1] })
    else if (match[2] !== undefined) parts.push({ kind: "strong", text: match[2] })
    else parts.push({ kind: "link", text: match[3] ?? "", href: match[4] ?? "" })
    last = at + match[0].length
  }
  if (last < source.length) parts.push({ kind: "text", text: source.slice(last) })
  return parts
}

export const plainText = (inlines: ReadonlyArray<Inline>): string => inlines.map((part) => part.text).join("")

const cells = (row: string): ReadonlyArray<string> =>
  row
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim())

const isTableRule = (line: string): boolean => /^\|?\s*:?-{3,}/.test(line.trim())
const listItem = /^(\s*)(?:[-*]|(\d+)\.)\s+(.*)$/

export const parseBlocks = (source: string): ReadonlyArray<Block> => {
  const lines = source.replace(/\r\n/g, "\n").split("\n")
  const blocks: Array<Block> = []
  let index = 0
  while (index < lines.length) {
    const line = lines[index] ?? ""
    if (line.trim() === "" || line.trim().startsWith("<!--")) {
      index += 1
      continue
    }
    if (line.startsWith("```")) {
      const body: Array<string> = []
      index += 1
      while (index < lines.length && !(lines[index] ?? "").startsWith("```")) {
        body.push(lines[index] ?? "")
        index += 1
      }
      blocks.push({ kind: "code", text: body.join("\n") })
      index += 1
      continue
    }
    const heading = /^(#{1,4})\s+(.*)$/.exec(line)
    if (heading !== null) {
      const text = parseInline(heading[2] ?? "")
      blocks.push({ kind: "heading", level: (heading[1] ?? "#").length, text, plain: plainText(text) })
      index += 1
      continue
    }
    if (line.trim().startsWith("|") && isTableRule(lines[index + 1] ?? "")) {
      const head = cells(line).map(parseInline)
      const rows: Array<ReadonlyArray<ReadonlyArray<Inline>>> = []
      index += 2
      while (index < lines.length && (lines[index] ?? "").trim().startsWith("|")) {
        rows.push(cells(lines[index] ?? "").map(parseInline))
        index += 1
      }
      blocks.push({ kind: "table", head, rows })
      continue
    }
    const item = listItem.exec(line)
    if (item !== null) {
      const isOrdered = item[2] !== undefined
      const items: Array<ReadonlyArray<Inline>> = []
      let current = item[3] ?? ""
      index += 1
      while (index < lines.length) {
        const next = lines[index] ?? ""
        const nextItem = listItem.exec(next)
        if (nextItem !== null && (nextItem[2] !== undefined) === isOrdered) {
          items.push(parseInline(current))
          current = nextItem[3] ?? ""
        } else if (next.startsWith("  ") && next.trim() !== "") {
          current = `${current} ${next.trim()}`
        } else break
        index += 1
      }
      items.push(parseInline(current))
      blocks.push({ kind: "list", isOrdered, items })
      continue
    }
    const paragraph: Array<string> = [line.trim()]
    index += 1
    while (index < lines.length) {
      const next = lines[index] ?? ""
      if (next.trim() === "" || /^(#{1,4}\s|```|\|)/.test(next) || listItem.test(next)) break
      paragraph.push(next.trim())
      index += 1
    }
    blocks.push({ kind: "paragraph", text: parseInline(paragraph.join(" ")) })
  }
  return blocks
}

export const slug = (title: string): string =>
  title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")

/** Splits the book at its `##` headings. The title and the text before the first `##` form the first topic. */
export const topicsOf = (source: string): ReadonlyArray<Topic> => {
  const topics: Array<Topic> = []
  let title = ""
  let blocks: Array<Block> = []
  const flush = (): void => {
    if (title !== "" || blocks.length > 0) topics.push({ id: slug(title), title, blocks })
  }
  for (const block of parseBlocks(source)) {
    if (block.kind === "heading" && block.level <= 2) {
      if (block.level === 1 && topics.length === 0 && title === "") {
        title = block.plain
        continue
      }
      flush()
      title = block.plain
      blocks = []
    } else blocks.push(block)
  }
  flush()
  return topics
}

const blockText = (block: Block): string => {
  switch (block.kind) {
    case "heading":
      return block.plain
    case "paragraph":
      return plainText(block.text)
    case "list":
      return block.items.map(plainText).join(" ")
    case "table":
      return [...block.head, ...block.rows.flat()].map(plainText).join(" ")
    case "code":
      return block.text
  }
}

/** Everything a topic says, for search. */
export const topicText = (topic: Topic): string => [topic.title, ...topic.blocks.map(blockText)].join(" ")
