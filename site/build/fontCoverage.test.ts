import { readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

import { readmeText } from "./readme-text"
import { codePoints, names, parse } from "./woff2.ts"

const weights = ["regular", "semibold", "bold"] as const
const load = (weight: string) => parse(readFileSync(join(import.meta.dirname, "../public/fonts", `heron-sans-${weight}.woff2`)))

const walk = (dir: string): ReadonlyArray<string> =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return name === "vendor" ? [] : walk(path)
    return /\.ts$/.test(name) && !/\.test\.ts$/.test(name) ? [path] : []
  })

// Characters the subset lacks on purpose. U+200B is zero-width and draws nothing (the code editor's empty
// line, in the monospace font). U+2192 is the arrow between branch names on a merge request page; the
// browser draws it from the next font in the stack. Add to this list only with a reason.
const allowedMissing = new Set(["\u200B", "\u2192"])

// Every character that appears in a source file of the site or in the desktop's README.txt. This
// over-approximates the visible text (it includes code and comments), which errs toward failing.
const usedCharacters = (): ReadonlySet<string> => {
  const text = [...walk(join(import.meta.dirname, "../src")).map((path) => readFileSync(path, "utf8")), readmeText(readFileSync(join(import.meta.dirname, "../../README.md"), "utf8"))].join("")
  return new Set([...text].filter((char) => !/[\s\p{Cc}]/u.test(char) && !allowedMissing.has(char)))
}

describe("the shipped interface font", () => {
  it("is named Heron Sans, not the Reserved Font Name Selawik, in every name record but the copyright", () => {
    for (const weight of weights) {
      const records = names(load(weight)).filter((record) => record.id !== 0)
      expect(records.length).toBeGreaterThan(0)
      for (const record of records) expect(record.value).not.toMatch(/selawik/i)
      expect(records.find((record) => record.id === 1)?.value).toMatch(/^Heron Sans/)
    }
  })

  for (const weight of weights) {
    it(`${weight} has a glyph for every character the site uses`, () => {
      const covered = codePoints(load(weight))
      const missing = [...usedCharacters()].filter((char) => !covered.has(char.codePointAt(0) ?? 0))
      expect(missing.map((char) => `${char} U+${(char.codePointAt(0) ?? 0).toString(16).toUpperCase().padStart(4, "0")}`)).toEqual([])
    })
  }
})
