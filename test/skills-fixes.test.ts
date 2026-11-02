import { createHash } from "node:crypto"
import { describe, expect, it } from "@effect/vitest"
import { Effect, Layer, Result, Schema } from "effect"
import { decodeConfigFile, resolveConfig, type SkillUnit } from "../src/config.ts"
import { synthesisOutput, type UserId } from "../src/domain.ts"
import { assignIds } from "../src/policy.ts"
import { earlierText, findingsText } from "../src/prompt.ts"
import { parsePrior, renderReport } from "../src/report.ts"
import { reviewOnce } from "../src/review.ts"
import { baseConfig, change, configOf, fakeForge, fakeHarness, finding, promptIds, reviewOut, sha, texts, type Script } from "./fakes.ts"
import { sampleReview } from "./report-sample.ts"

const text = "Keep shared state under one owner."
const unit = {
  id: "design-ownership",
  skill: "Design",
  source: {
    repository: "https://github.com/example/review-skills",
    commit: "a".repeat(40),
    path: "skills/design/SKILL.md",
    lines: "12-24"
  },
  file: "skills/design-ownership.md",
  sha256: createHash("sha256").update(text).digest("hex"),
  sessions: ["gate", "supervisor", "judge"]
} satisfies Omit<SkillUnit, "text">
const files = new Map([...texts, [unit.file, text]])
const applied = (rule: string) => ({ skill: unit.skill, rule })
const gateRule = applied("Keep one owner")
const supervisorRule = applied("Check the state owner")
const judgeRule = applied("Check the caller")
const decision = { id: "gate.design#1", ruling: "keep", reason: "The defect remains.", line: null, confirmSuggestion: false }

describe("ruling skill attribution", () => {
  it.each(["supervisor", "judge"] as const)("accepts optional known decision attribution for %s with skills", (role) => {
    const decode = Schema.decodeUnknownResult(synthesisOutput(configOf().defaultLane.gates, role, [unit.skill]), { onExcessProperty: "error" })
    const output = { summary: "Checked.", decisions: [{ ...decision, applied: [supervisorRule] }], ...(role === "supervisor" ? { added: [] } : {}), limitations: [] }
    expect(Result.mapError(decode(output), (e) => e.message)).toEqual(Result.succeed(output))
    const omitted = { ...output, decisions: [decision] }
    expect(decode(omitted)).toEqual(Result.succeed(omitted))
    const empty = { ...output, decisions: [{ ...decision, applied: [] }] }
    expect(decode(empty)).toEqual(Result.succeed(empty))
    expect(Result.isFailure(decode({ ...output, decisions: [{ ...decision, applied: [{ skill: "Unknown", rule: "Check" }] }] }))).toBe(true)
    expect(Result.isFailure(Schema.decodeUnknownResult(synthesisOutput(configOf().defaultLane.gates, role), { onExcessProperty: "error" })(output))).toBe(true)
  })

  for (const lane of ["standard", "critical"] as const) {
    it.effect(`merges and deduplicates kept ruling attribution through the ${lane} report and prior JSON`, () => Effect.gen(function*() {
      const config = configOf({ ...baseConfig, skills: [unit] }, {}, files)
      const forge = fakeForge({ head: sha("a"), changes: [change(lane === "critical" ? "src/auth/login.ts" : "src/app.ts")] })
      const keep: Script = (r) => ({
        summary: "Checked.",
        decisions: promptIds(r).map((id) => ({ ...decision, id, ruling: r.slot.role === "judge" ? "keep as advisory" : "keep", applied: r.slot.role === "judge" ? [supervisorRule, judgeRule, judgeRule] : [gateRule, supervisorRule, supervisorRule] })),
        ...(r.slot.role === "supervisor" ? { added: [] } : {}),
        limitations: []
      })
      const answers = Object.fromEntries([
        ...["", "b1.", "b2."].flatMap((prefix): Array<[string, Script]> => [
          [`${prefix}gate.design`, () => reviewOut([{ ...finding("design", "blocker"), applied: [gateRule] }])],
          [`${prefix}gate.correctness`, () => reviewOut()],
          [`${prefix}supervisor`, keep]
        ]),
        ["judge", keep]
      ])
      const harness = fakeHarness(answers)
      const result = yield* reviewOnce(config, { ref: { project: "group/app", iid: 7 }, triggeredBy: 2001 as UserId, publish: false, full: false }).pipe(
        Effect.provide(Layer.mergeAll(forge.layer, harness.layer))
      )
      expect(result.review.outcome.kind, result.review.outcome.kind === "incomplete" ? result.review.outcome.reason : "").toBe("complete")
      if (result.review.outcome.kind !== "complete") return
      const expected = lane === "critical" ? [gateRule, supervisorRule, judgeRule] : [gateRule, supervisorRule]
      expect(result.review.outcome.findings.length).toBe(lane === "critical" ? 2 : 1)
      for (const f of result.review.outcome.findings) {
        expect(f.applied).toEqual(expected)
        expect(f.severity).toBe(lane === "critical" ? "advisory" : "blocker")
      }
      expect(parsePrior(result.body)?.findings.map((f) => f.applied)).toEqual(result.review.outcome.findings.map(() => expected))
      for (const a of expected) expect(result.body).toContain(`\`${a.skill}\`: ${a.rule}`)
      if (lane === "critical") {
        const prompt = harness.seen.find((r) => r.slot.role === "judge")!.prompt
        expect(prompt).toContain(supervisorRule.rule)
      }
    }))
  }
})

describe("finding packets without skills", () => {
  const findings = assignIds("gate.design" as Parameters<typeof assignIds>[0], [finding("design", "advisory")])
  const legacy = findings.map(({ body, gate, id, location, severity, suggestion, title }) => ({ id, gate, severity, location, title, body, suggestion }))
  const json = `\`\`\`json\n${JSON.stringify(legacy, null, 2)}\n\`\`\``

  it.each(["Gate findings", "Branch findings"])("keeps the %s packet identical without skills", (title) => {
    expect(findingsText(title, findings)).toBe(`## ${title}\n\n${json}`)
  })

  it("keeps the earlier-findings packet identical without skills", () => {
    const packet = earlierText({ from: sha("a"), earlier: findings, changes: [] }, false)
    expect(packet).toBe([
      "## Earlier findings",
      `Heron's review at \`${sha("a")}\` kept these findings. Rule on each one at the reviewed head: \`keep\` it if the defect is still there, \`keep as advisory\` if it is still there but does not block, and \`drop\` it when the new commits fixed it or it was never real. No ruling raises a finding to blocker.`,
      "Heron has moved each finding's `location` to the reviewed head. A `line` of null means the new commits removed or rewrote the line the finding named: if the defect is still there, keep the finding and give the line where it is now in the decision's `line`; if the rewrite fixed it, drop it.",
      "A finding's `suggestion` was confirmed at the earlier head, and Heron kept it only where the new commits left its lines unchanged. It stays only if you confirm it again at the reviewed head.",
      json
    ].join("\n\n"))
  })

  it("preserves nonempty attribution in finding packets", () => {
    expect(findingsText("Gate findings", [{ ...findings[0]!, applied: [gateRule] }])).toContain(`"rule": "${gateRule.rule}"`)
  })
})

describe("skill label validation", () => {
  it.each(["id", "skill"] as const)("rejects multiline or backtick %s labels", (field) => {
    for (const value of ["design\n## injected", "design\rheading", "design\n", "design\r", "design\u2028heading", "design\u2029heading", "design`heading"]) {
      const result = decodeConfigFile({ ...baseConfig, skills: [{ ...unit, [field]: value }] }, {})
      expect(Result.isFailure(result), JSON.stringify({ field, value })).toBe(true)
    }
  })

  it("accepts a single-line skill name with spaces and punctuation", () => {
    expect(Result.isSuccess(decodeConfigFile({ ...baseConfig, skills: [{ ...unit, skill: "Design: state ownership" }] }, {}))).toBe(true)
  })
})

describe("skill gate selector ownership", () => {
  it("rejects gate:constructor when it is only an inherited property", () => {
    const result = Result.flatMap(decodeConfigFile({ ...baseConfig, skills: [{ ...unit, sessions: ["gate:constructor"] }] }, {}), (file) => resolveConfig(file, files))
    expect(Result.isFailure(result) ? result.failure.message : "ok").toBe('skill unit "design-ownership" selects unknown gate "constructor"')
  })

  it("accepts gate:constructor when the config declares its own gate", () => {
    const gates = { ...baseConfig.gates, constructor: { instructions: "design.md" } }
    const result = Result.flatMap(decodeConfigFile({ ...baseConfig, gates, skills: [{ ...unit, sessions: ["gate:constructor"] }] }, {}), (file) => resolveConfig(file, files))
    expect(Result.isSuccess(result)).toBe(true)
  })
})

describe("skill source selectors", () => {
  it.each([
    ["12", "#L12"],
    ["3-9", "#L3-L9"],
    ["0-2", ""],
    ["24-12", ""],
    ["17 first sentence only", ""],
    ["10-18; 29-52; 76-81", ""],
    ["7, substring from `owner` to end", ""]
  ])("renders source selector %s with anchor '%s'", (lines, anchor) => {
    const selected = { ...unit, source: { ...unit.source, lines } }
    const config = configOf({ ...baseConfig, skills: [selected] }, {}, files)
    const report = renderReport({ ...sampleReview, skills: [{ unit: config.skills[0]!, sessions: [] }] })
    const row = report.split("\n").find((line) => line.startsWith("| `design-ownership`"))!
    const url = `${unit.source.repository}/blob/${unit.source.commit}/${unit.source.path}${anchor}`
    expect(row).toContain(`](${url})`)
    if (anchor === "") expect(row.replace(/\\(.)\u2060/g, "$1")).toContain(`) ${lines} |`)
  })

  it.each(["", "12\n", "12\r34", "12\u202834", "12\u202934"])("rejects empty or multiline source selector %j", (lines) => {
    expect(Result.isFailure(decodeConfigFile({ ...baseConfig, skills: [{ ...unit, source: { ...unit.source, lines } }] }, {}))).toBe(true)
  })
})
