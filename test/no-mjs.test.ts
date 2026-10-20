import { execFileSync } from "node:child_process"
import { describe, expect, it } from "@effect/vitest"

describe("repository sources", () => {
  it("tracks no .mjs file", () => {
    const tracked = execFileSync("git", ["ls-files", "*.mjs"], { encoding: "utf8" }).split("\n").filter(Boolean)
    expect(tracked).toEqual([])
  })
})
