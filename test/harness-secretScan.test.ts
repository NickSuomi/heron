import { afterAll, describe, expect, it } from "@effect/vitest"
import { Effect, Exit, Scope } from "effect"
import { runSourceTool, sourceTools, toolContext, type ToolContext } from "../src/harness/sourceTools.ts"
import { makeRepo } from "./fixtures/harness/repo.ts"
import { noDiscussions } from "./fixtures/harness/request.ts"

// Fake keys, assembled at run time so this file holds no literal credential. Only the shape matches the AWS rule.
const KEY_A = "AKIA" + "Z4ABCDEFGHIJKLMN"
const KEY_B = "AKIA" + "Q3RSTUVWXYZ2345Y"
const KEY_C = "AKIA" + "M5ABCDEFGHJKLMNP"

const repo = makeRepo(() => ({
  "config/a.env": `# staging\nAWS_KEY="${KEY_A}"\n`,
  // The tree tries every way to hide a secret: its own rules, its own ignore file, an inline allow comment.
  ".gitleaks.toml": "[[allowlists]]\nregexes = [\".*\"]\n",
  ".gitleaksignore": "config/a.env:aws-access-token:2\n./config/a.env:aws-access-token:2\n",
  "config/b.env": `AWS_KEY="${KEY_B}" # gitleaks:allow\n`,
  "deep/nested/c.env": `first\nsecond\nAWS_KEY="${KEY_C}"\n`
}))
const scope = Effect.runSync(Scope.make())
const ctx: ToolContext = Effect.runSync(Scope.provide(toolContext(repo.source, noDiscussions), scope))
afterAll(() => {
  Effect.runSync(Scope.close(scope, Exit.void))
  repo.cleanup()
})

const tool = sourceTools.find((t) => t.name === "secret_scan")
const call = (args: unknown) => runSourceTool(tool!, ctx, args)
const json = (args: unknown) =>
  call(args).pipe(Effect.map((out) => (expect(out.ok ? "ok" : out.text).toBe("ok"), JSON.parse(out.text) as { total: number; offset: number; next: number | null; findings: Array<Record<string, unknown>> })))

// Each gitleaks start costs about 0.6 s (it compiles its rule set); a tree with a .gitleaksignore needs a few starts per call.
describe("secret_scan", { timeout: 30_000 }, () => {
  it("is registered as a Heron tool", () => {
    expect(tool?.name).toBe("secret_scan")
    expect(tool?.description).toContain("candidate")
  })

  it.effect("finds every planted secret, redacted, whatever the tree says about itself", () =>
    Effect.gen(function*() {
      const out = yield* json({})
      expect(out.findings.map((f) => [f["path"], f["startLine"], f["ruleId"]])).toEqual([
        ["config/a.env", 2, "aws-access-token"],
        ["config/b.env", 1, "aws-access-token"],
        ["deep/nested/c.env", 3, "aws-access-token"]
      ])
      expect(out.total).toBe(3)
      expect(out.findings[0]).toMatchObject({ endLine: 2, match: "REDACTED" })
      expect(typeof out.findings[0]!["description"]).toBe("string")
      const text = JSON.stringify(out)
      for (const key of [KEY_A, KEY_B, KEY_C]) expect(text).not.toContain(key)
      expect(Object.keys(out.findings[0]!).sort()).toEqual(["description", "endLine", "match", "path", "ruleId", "startLine"])
    }))

  it.effect("limits the scan to a subtree", () =>
    Effect.gen(function*() {
      const out = yield* json({ paths: ["deep"] })
      expect(out.findings.map((f) => f["path"])).toEqual(["deep/nested/c.env"])
    }))

  it.effect("pages with total and next", () =>
    Effect.gen(function*() {
      const first = yield* json({ limit: 2 })
      expect([first.total, first.offset, first.next, first.findings.length]).toEqual([3, 0, 2, 2])
      const last = yield* json({ offset: first.next, limit: 2 })
      expect([last.total, last.offset, last.next, last.findings.map((f) => f["path"])]).toEqual([3, 2, null, ["deep/nested/c.env"]])
    }))

  it.effect("finds nothing on a tree without secrets", () =>
    Effect.gen(function*() {
      expect(yield* json({ ref: "base" })).toEqual({ total: 0, offset: 0, next: null, findings: [] })
    }))

  it.effect("rejects a path outside the repository and a missing path", () =>
    Effect.gen(function*() {
      expect((yield* call({ paths: ["../x"] })).ok).toBe(false)
      expect((yield* call({ paths: ["nope"] })).ok).toBe(false)
    }))
})
