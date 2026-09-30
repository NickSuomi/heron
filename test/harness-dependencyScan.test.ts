import { symlinkSync, writeFileSync } from "node:fs"
import { afterAll, describe, expect, it } from "@effect/vitest"
import { Effect, Exit, Scope } from "effect"
import { runSourceTool, sourceTools, toolContext, type ToolContext } from "../src/harness/sourceTools.ts"
import { makeRepo } from "./fixtures/harness/repo.ts"
import { noDiscussions } from "./fixtures/harness/request.ts"

const lockfile = (name: string, version: string) =>
  JSON.stringify({
    name: "acme-storefront",
    lockfileVersion: 3,
    requires: true,
    packages: { "": { name: "acme-storefront", version: "1.0.0", dependencies: { [name]: version } }, [`node_modules/${name}`]: { version } }
  })

// lodash 4.17.15 and minimist 1.2.0 carry published advisories. The tree tries to hide them: an osv-scanner.toml that ignores one,
// and, written into the checkout below, a .gitignore that lists one of the lockfiles.
const repo = makeRepo(() => ({
  "package-lock.json": lockfile("lodash", "4.17.15"),
  "osv-scanner.toml": '[[IgnoredVulns]]\nid = "GHSA-35jh-r3h4-6jhm"\nreason = "not reachable"\n\n[[IgnoredVulns]]\nid = "GHSA-29mw-wpgm-hmr9"\nreason = "not reachable"\n',
  "apps/web/package-lock.json": lockfile("minimist", "1.2.0"),
  "clean/package-lock.json": lockfile("left-pad", "1.3.0")
}))
// A tracked file can still match a .gitignore in the checked-out tree; osv-scanner would then skip it.
writeFileSync(`${repo.source.trees.source}/.gitignore`, "apps/web/package-lock.json\n")
const scope = Effect.runSync(Scope.make())
const ctx: ToolContext = Effect.runSync(Scope.provide(toolContext(repo.source, noDiscussions), scope))
afterAll(() => {
  Effect.runSync(Scope.close(scope, Exit.void))
  repo.cleanup()
})

const tool = sourceTools.find((t) => t.name === "dependency_scan")
const call = (args: unknown) => runSourceTool(tool!, ctx, args)
type Result = {
  database: { ecosystems: Array<string>; snapshot: string | null }
  total: number
  offset: number
  next: number | null
  packages: Array<{ lockfile: string; package: string; version: string; advisoryIds: Array<string>; severity: string | null; fixedVersions: Array<string>; advisories: Array<{ id: string; summary: string | null }> }>
}
const json = (args: unknown) =>
  call(args).pipe(Effect.map((out) => (expect(out.ok ? "ok" : out.text).toBe("ok"), JSON.parse(out.text) as Result)))

// Each osv-scanner start loads the vulnerability database, about 15 s.
describe("dependency_scan", { timeout: 120_000 }, () => {
  it("is registered as a Heron tool", () => {
    expect(tool?.name).toBe("dependency_scan")
    expect(tool?.description).toContain("candidate")
  })

  it.effect("finds every vulnerable package, whatever the tree says about itself, and shows the database date", () =>
    Effect.gen(function*() {
      const out = yield* json({})
      expect(out.packages.map((p) => [p.lockfile, p.package, p.version])).toEqual([
        ["apps/web/package-lock.json", "minimist", "1.2.0"],
        ["package-lock.json", "lodash", "4.17.15"]
      ])
      const lodash = out.packages[1]!
      // Both ignored advisories are reported although osv-scanner.toml ignores them.
      expect(lodash.advisoryIds).toContain("GHSA-35jh-r3h4-6jhm")
      expect(lodash.advisoryIds).toContain("GHSA-29mw-wpgm-hmr9")
      expect(lodash.fixedVersions).toContain("4.17.21")
      expect(lodash.severity).toMatch(/^\d/)
      expect(lodash.advisories.find((a) => a.id === "GHSA-29mw-wpgm-hmr9")?.summary).toContain("lodash")
      expect(out.database.ecosystems).toEqual(["npm"])
      expect(out.database.snapshot).toMatch(/^\d{4}-\d\d-\d\dT/)
      expect(Object.keys(lodash).sort()).toEqual(["advisories", "advisoryIds", "ecosystem", "fixedVersions", "lockfile", "package", "severity", "version"])
    }))

  it.effect("limits the scan to a lockfile, and pages with total and next", () =>
    Effect.gen(function*() {
      const one = yield* json({ paths: ["apps/web/package-lock.json"] })
      expect(one.packages.map((p) => p.package)).toEqual(["minimist"])
      const first = yield* json({ limit: 1 })
      expect([first.total, first.offset, first.next, first.packages.map((p) => p.package)]).toEqual([2, 0, 1, ["minimist"]])
      const last = yield* json({ offset: first.next, limit: 1 })
      expect([last.total, last.offset, last.next, last.packages.map((p) => p.package)]).toEqual([2, 1, null, ["lodash"]])
    }))

  it.effect("finds nothing in a clean lockfile or a tree without one", () =>
    Effect.gen(function*() {
      expect((yield* json({ paths: ["clean"] })).total).toBe(0)
      expect((yield* json({ ref: "base" })).total).toBe(0)
    }))

  it.effect("rejects a path outside the repository, a missing path and a symlink out of the tree", () =>
    Effect.gen(function*() {
      symlinkSync("/etc/hostname", `${repo.source.trees.source}/link.json`)
      expect((yield* call({ paths: ["../x"] })).ok).toBe(false)
      expect((yield* call({ paths: ["nope"] })).ok).toBe(false)
      expect((yield* call({ paths: ["link.json"] })).ok).toBe(false)
    }))
})
