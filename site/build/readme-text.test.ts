import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

import { readmeText } from "./readme-text"

describe("README.txt", () => {
  it("turns markdown into text that reads in Notepad", () => {
    const markdown = [
      '<p align="center">',
      '  <img alt="Heron" src="docs/brand/assets/heron-lockup.svg">',
      "</p>",
      "",
      "# Heron",
      "",
      "<!-- github-readme-standard: full -->",
      "",
      "## Quick start",
      "",
      "### Install",
      "",
      "Run **`pnpm heron`** with one [backend](docs/backends.md) or see [`site/`](site/).",
      "",
      "```sh",
      "pnpm install",
      "```",
    ].join("\n")
    expect(readmeText(markdown)).toBe(
      [
        "HERON",
        "=====",
        "",
        "Quick start",
        "-----------",
        "",
        "Install:",
        "",
        "Run pnpm heron with one backend (docs/backends.md) or see site/.",
        "",
        "    pnpm install",
        "",
      ].join("\n"),
    )
  })

  it("keeps no HTML or heading hashes from the repository's README", () => {
    const text = readmeText(readFileSync(join(import.meta.dirname, "../../README.md"), "utf8"))
    expect(text.startsWith("HERON\n=====\n\nHeron is a self-hosted code-review bot")).toBe(true)
    expect(text).not.toMatch(/<[a-z/!]/i)
    expect(text).not.toMatch(/^#/m)
    expect(text).toContain("\nLicense\n-------\n")
  })
})
