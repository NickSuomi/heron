// README.txt on the Heron OS desktop is the repository's README.md as plain text, the way a README.txt reads in
// Notepad: no HTML, headings underlined instead of marked with hashes, code indented, links spelled out.

const underline = (title: string, rule: string): ReadonlyArray<string> => [title, rule.repeat(title.length)]

/** `[text](url)` becomes `text (url)`, or just the text when it already is the url; images and inline markup go. */
const inline = (line: string): string =>
  line
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, text: string, url: string) => {
      const plain = text.replace(/`/g, "")
      return plain === url || plain === url.replace(/^\.\//, "") ? plain : `${plain} (${url})`
    })
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")

const heading = (level: number, title: string): ReadonlyArray<string> =>
  level === 1 ? underline(title.toUpperCase(), "=") : level === 2 ? underline(title, "-") : [`${title}:`]

export const readmeText = (markdown: string): string => {
  const out: Array<string> = []
  let isFenced = false
  let isHtml = false
  for (const line of markdown.replace(/<!--[\s\S]*?-->/g, "").split("\n")) {
    if (/^```/.test(line)) {
      isFenced = !isFenced
      continue
    }
    if (isFenced) {
      out.push(line === "" ? "" : `    ${line}`)
      continue
    }
    // As in CommonMark, an HTML block starts with a tag at the start of a line and runs to the next blank line.
    if (/^<\/?[a-z]/i.test(line)) isHtml = true
    if (isHtml) {
      isHtml = line.trim() !== ""
      continue
    }
    const match = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line)
    out.push(...(match === null ? [inline(line)] : heading(match[1]?.length ?? 1, inline(match[2] ?? ""))))
  }
  return `${out.join("\n").replace(/\n{3,}/g, "\n\n").trim()}\n`
}
