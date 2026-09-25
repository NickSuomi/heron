import { readFileSync } from "node:fs"
import { describe, expect, it } from "@effect/vitest"
import { DOC, envTable, tableIn } from "../scripts/gen-env-table.ts"

describe("docs/configuration.md", () => {
  it("lists every environment variable exactly as src/config.ts defines it", () => {
    expect(tableIn(readFileSync(DOC, "utf8"))).toBe(envTable())
  })

  it("renders one row per variable with its config key", () => {
    const rows = envTable().split("\n")
    expect(rows).toContain("| `HERON_PROJECT` | `forge.project` | string | Project path or numeric id. |")
    expect(rows).toContain("| `GITLAB_TOKEN` | none | secret | Bot token for the GitLab API. Never passed to a harness. |")
  })
})
