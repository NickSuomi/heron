import { afterAll, describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { runSourceTool, type SourceTool, sourceTools } from "../src/harness/sourceTools.ts"
import { makeRepo } from "./fixtures/harness/repo.ts"

const repo = makeRepo()
afterAll(repo.cleanup)

const byName = (name: SourceTool["name"]) => sourceTools.find((t) => t.name === name)!
const call = (name: SourceTool["name"], args: unknown) => runSourceTool(byName(name), repo.source, args)
const json = (name: SourceTool["name"], args: unknown) =>
  call(name, args).pipe(Effect.map((out) => (expect(out.ok).toBe(true), JSON.parse(out.text) as unknown)))

describe("grep", () => {
  it.effect("finds a literal across the commit, in path order", () =>
    Effect.gen(function*() {
      expect(yield* json("grep", { pattern: "add" })).toEqual({
        lines: [
          "docs/guide.md:1:Use add for sums.",
          "src/app.ts:1:import { add } from \"./math.ts\"",
          "src/app.ts:3:export const total = add(1, 2)",
          "src/math.ts:1:export const add = (a: number, b: number) => a + b"
        ],
        truncated: false
      })
    }))

  it.effect("supports ERE, path globs, case folding and context", () =>
    Effect.gen(function*() {
      expect(yield* json("grep", { pattern: "^export const (add|sub)", mode: "regex", paths: ["src/**"] })).toEqual({
        lines: [
          "src/math.ts:1:export const add = (a: number, b: number) => a + b",
          "src/math.ts:2:export const sub = (a: number, b: number) => a - b"
        ],
        truncated: false
      })
      expect(yield* json("grep", { pattern: "TOTAL", ignoreCase: true, paths: ["src/app.ts"] })).toEqual({
        lines: ["src/app.ts:3:export const total = add(1, 2)", "src/app.ts:5:console.log(\"Total\", total)"],
        truncated: false
      })
      expect(yield* json("grep", { pattern: "TODO", context: 1 })).toEqual({
        lines: ["src/app.ts-3-export const total = add(1, 2)", "src/app.ts:4:// TODO: remove debug", "src/app.ts-5-console.log(\"Total\", total)"],
        truncated: false
      })
    }))

  it.effect("caps output and says so", () =>
    Effect.gen(function*() {
      expect(yield* json("grep", { pattern: "hit", maxLines: 3 })).toEqual({
        lines: ["many.txt:1:hit 1", "many.txt:2:hit 2", "many.txt:3:hit 3"],
        truncated: true
      })
    }))

  it.effect("reads the pinned commit, not a later one", () =>
    Effect.gen(function*() {
      expect(yield* json("grep", { pattern: "late" })).toEqual({ lines: [], truncated: false })
    }))
})

describe("list_files", () => {
  it.effect("lists by prefix and glob with a truncation flag", () =>
    Effect.gen(function*() {
      expect(yield* json("list_files", {})).toEqual({
        paths: ["README.md", "docs/guide.md", "many.txt", "src/app.ts", "src/math.ts"],
        truncated: false
      })
      expect(yield* json("list_files", { prefix: "src/" })).toEqual({ paths: ["src/app.ts", "src/math.ts"], truncated: false })
      expect(yield* json("list_files", { glob: "**/*.md" })).toEqual({ paths: ["README.md", "docs/guide.md"], truncated: false })
      expect(yield* json("list_files", { maxPaths: 2 })).toEqual({ paths: ["README.md", "docs/guide.md"], truncated: true })
    }))
})

describe("read_file", () => {
  it.effect("returns a numbered line window", () =>
    Effect.gen(function*() {
      expect(yield* json("read_file", { path: "src/app.ts", startLine: 3, maxLines: 2 })).toEqual({
        path: "src/app.ts",
        startLine: 3,
        endLine: 4,
        totalLines: 5,
        text: "3\texport const total = add(1, 2)\n4\t// TODO: remove debug",
        truncated: true
      })
    }))

  it.effect("rejects traversal, absolute paths and directories without revealing the host path", () =>
    Effect.gen(function*() {
      const results = [
        yield* call("read_file", { path: "../etc/passwd" }),
        yield* call("read_file", { path: "/etc/passwd" }),
        yield* call("grep", { pattern: "x", paths: ["src/../../x"] }),
        yield* call("read_file", { path: "src" }),
        yield* call("read_file", { path: "nope.ts" }),
        yield* call("read_file", { path: 7 })
      ]
      expect(results.map((r) => r.ok)).toEqual([false, false, false, false, false, false])
      expect(results.slice(0, 5).map((r) => r.text)).toEqual([
        "path must not contain \"..\": ../etc/passwd",
        "path must be repository-relative: /etc/passwd",
        "path must not contain \"..\": src/../../x",
        "not a file: src (use list_files for directories)",
        "no such path at this commit: nope.ts"
      ])
      expect(results[5]!.text).toMatch(/^invalid arguments: /)
      expect(results.some((r) => r.text.includes(repo.root))).toBe(false)
    }))
})
