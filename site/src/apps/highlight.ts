// A small line tokenizer for Heron Studio's colouring: TypeScript, Vue single-file components, JSON, diffs and
// Markdown. It carries only the state that crosses lines (an open block comment, the Vue section).

export type TokenKind = "plain" | "keyword" | "type" | "string" | "number" | "comment" | "tag" | "attribute" | "punctuation" | "added" | "removed" | "hunk" | "heading"

export type Token = Readonly<{ text: string; kind: TokenKind }>

export type Language = "typescript" | "vue" | "json" | "diff" | "markdown" | "text"

export const languageOf = (name: string): Language => {
  const extension = name.slice(name.lastIndexOf(".") + 1).toLowerCase()
  return (
    ({ ts: "typescript", vue: "vue", json: "json", diff: "diff", md: "markdown" } as Record<string, Language>)[extension] ?? "text"
  )
}

const keywords = new Set(
  "as async await break case catch class const continue default delete do else export extends false finally for from function if import in instanceof interface let new null of readonly return satisfies static switch this throw true try type typeof undefined var void while yield".split(
    " ",
  ),
)

type State = Readonly<{ isInComment: boolean; vueSection: "template" | "script" | "none" }>

const initial: State = { isInComment: false, vueSection: "none" }

const script = /(\/\/.*$)|(\/\*.*?(?:\*\/|$))|("(?:\\.|[^"\\])*"?|'(?:\\.|[^'\\])*'?|`(?:\\.|[^`\\])*`?)|(\b\d[\d_]*(?:\.\d+)?\b)|([A-Za-z_$][\w$]*)|(\s+)|([^\sA-Za-z_$\d"'`/]+|\/)/g

const scriptLine = (line: string, state: State): [ReadonlyArray<Token>, State] => {
  const tokens: Array<Token> = []
  let rest = line
  let isInComment = state.isInComment
  if (isInComment) {
    const end = rest.indexOf("*/")
    if (end < 0) return [[{ text: rest, kind: "comment" }], state]
    tokens.push({ text: rest.slice(0, end + 2), kind: "comment" })
    rest = rest.slice(end + 2)
    isInComment = false
  }
  for (const match of rest.matchAll(script)) {
    const [text, line, block, string, number, word] = match
    if (line !== undefined) tokens.push({ text, kind: "comment" })
    else if (block !== undefined) {
      tokens.push({ text, kind: "comment" })
      isInComment = !block.endsWith("*/") || block.length < 4
    } else if (string !== undefined) tokens.push({ text, kind: "string" })
    else if (number !== undefined) tokens.push({ text, kind: "number" })
    else if (word !== undefined) tokens.push({ text, kind: keywords.has(word) ? "keyword" : /^[A-Z]/.test(word) ? "type" : "plain" })
    else tokens.push({ text, kind: "plain" })
  }
  return [tokens, { ...state, isInComment }]
}

const markup = /(<\/?)([\w-]+)|(\/?>)|([:@]?[\w.-]+)(=)|("[^"]*")|(\{\{.*?\}\})|(\s+)|([^<>"\s{]+|[{])/g

const markupLine = (line: string): ReadonlyArray<Token> =>
  Array.from(line.matchAll(markup)).flatMap((match): ReadonlyArray<Token> => {
    const [text, open, tag, close, attribute, equals, value, mustache] = match
    if (open !== undefined && tag !== undefined)
      return [
        { text: open, kind: "punctuation" },
        { text: tag, kind: "tag" },
      ]
    if (close !== undefined) return [{ text: close, kind: "punctuation" }]
    if (attribute !== undefined && equals !== undefined)
      return [
        { text: attribute, kind: "attribute" },
        { text: equals, kind: "plain" },
      ]
    if (value !== undefined) return [{ text: value, kind: "string" }]
    if (mustache !== undefined) return [{ text: mustache, kind: "keyword" }]
    return [{ text, kind: "plain" }]
  })

const json = /("(?:\\.|[^"\\])*")(\s*:)?|(-?\b\d+(?:\.\d+)?\b)|\b(true|false|null)\b|(\s+)|([^\s"]+?)/g

const jsonLine = (line: string): ReadonlyArray<Token> =>
  Array.from(line.matchAll(json)).flatMap((match): ReadonlyArray<Token> => {
    const [text, string, colon, number, literal] = match
    if (string !== undefined)
      return colon === undefined
        ? [{ text: string, kind: "string" }]
        : [
            { text: string, kind: "attribute" },
            { text: colon, kind: "plain" },
          ]
    if (number !== undefined) return [{ text, kind: "number" }]
    if (literal !== undefined) return [{ text, kind: "keyword" }]
    return [{ text, kind: "plain" }]
  })

const diffLine = (line: string): ReadonlyArray<Token> => [
  {
    text: line,
    kind: line.startsWith("@@")
      ? "hunk"
      : /^(diff |new file|--- |\+\+\+ |index )/.test(line)
        ? "heading"
        : line.startsWith("+")
          ? "added"
          : line.startsWith("-")
            ? "removed"
            : line.startsWith("#")
              ? "comment"
              : "plain",
  },
]

const markdownLine = (line: string): ReadonlyArray<Token> => [
  { text: line, kind: /^#{1,6}\s/.test(line) ? "heading" : /^\s*(```|<)/.test(line) ? "tag" : "plain" },
]

const vueLine = (line: string, state: State): [ReadonlyArray<Token>, State] => {
  const trimmed = line.trim()
  if (/^<script\b/.test(trimmed)) return [markupLine(line), { ...state, vueSection: "script" }]
  if (/^<\/script>/.test(trimmed)) return [markupLine(line), { ...state, vueSection: "none" }]
  if (/^<template\b/.test(trimmed)) return [markupLine(line), { ...state, vueSection: "template" }]
  return state.vueSection === "script" ? scriptLine(line, state) : [markupLine(line), state]
}

/** Every line of `text` as coloured tokens. */
export const highlight = (text: string, language: Language): ReadonlyArray<ReadonlyArray<Token>> => {
  let state = initial
  return text.split("\n").map((line) => {
    if (language === "typescript" || language === "vue") {
      const [tokens, next] = language === "vue" ? vueLine(line, state) : scriptLine(line, state)
      state = next
      return tokens
    }
    if (language === "json") return jsonLine(line)
    if (language === "diff") return diffLine(line)
    if (language === "markdown") return markdownLine(line)
    return [{ text: line, kind: "plain" }]
  })
}
