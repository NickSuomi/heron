import { createHash } from "node:crypto"
import { describe, expect, it } from "@effect/vitest"
import { Result, Schema } from "effect"
import { decodeConfigFile, resolveConfig, type SkillUnit } from "../src/config.ts"
import { reviewOutput, synthesisOutput, type Slot } from "../src/domain.ts"
import { answererOf, planFor, skillsFor, slotsOf } from "../src/policy.ts"
import { instructionsFor } from "../src/prompt.ts"
import { renderReport } from "../src/report.ts"
import { baseConfig, change, configOf, finding, reviewOut, texts } from "./fakes.ts"
import { sampleOutcome, sampleReview } from "./report-sample.ts"

const skillText = "Keep shared state under one owner."
const skillFile = {
  id: "design-ownership",
  skill: "Design",
  source: {
    repository: "https://github.com/example/review-skills",
    commit: "a".repeat(40),
    path: "skills/design/SKILL.md",
    lines: "12-24"
  },
  file: "skills/design-ownership.md",
  sha256: createHash("sha256").update(skillText).digest("hex"),
  sessions: ["gate:design"]
} satisfies Omit<SkillUnit, "text">
const unit = (overrides: Partial<SkillUnit> = {}): SkillUnit => ({ ...skillFile, text: skillText, ...overrides })
const skillTexts = new Map([...texts, [skillFile.file, skillText]])
const config = configOf()
const roles = ["reviewer", "gate", "supervisor", "judge", "answerer"] as const
const slots = [...config.lanes.flatMap((lane) => slotsOf(planFor(lane))), answererOf(planFor(config.defaultLane))]
const slotFor = (role: Slot["role"]) => slots.find((s) => s.role === role)!
const design = slots.find((s) => s.role === "gate" && s.gates[0].name === "design")!
const correctness = slots.find((s) => s.role === "gate" && s.gates[0].name === "correctness")!

describe("skill unit config", () => {
  const resolve = (skills: ReadonlyArray<unknown>, files = skillTexts) =>
    Result.flatMap(decodeConfigFile({ ...baseConfig, skills }, {}), (file) => resolveConfig(file, files))
  const errorOf = (skills: ReadonlyArray<unknown>, files = skillTexts) => {
    const result = resolve(skills, files)
    return Result.isFailure(result) ? result.failure.message : "ok"
  }

  it("resolves a pinned unit with its file text", () => {
    expect(Result.map(resolve([skillFile]), (c) => c.skills)).toEqual(Result.succeed([unit()]))
  })

  it("rejects changed text with the actual and pinned SHA-256 hashes", () => {
    const changed = "Keep shared state under two owners."
    const actual = createHash("sha256").update(changed).digest("hex")
    expect(errorOf([skillFile], new Map([...texts, [skillFile.file, changed]]))).toBe(
      `skill unit "design-ownership" SHA-256 mismatch: actual ${actual}, pinned ${skillFile.sha256}`
    )
  })

  it("rejects a duplicate unit id", () => {
    expect(errorOf([skillFile, { ...skillFile, skill: "Other design" }])).toBe('duplicate skill unit "design-ownership"')
  })

  it("rejects a selector for an unknown gate", () => {
    expect(errorOf([{ ...skillFile, sessions: ["gate:security"] }])).toBe('skill unit "design-ownership" selects unknown gate "security"')
  })
})

describe("skillsFor", () => {
  const roleUnits = roles.map((role) => unit({ id: `${role}-only`, sessions: [role] }))

  it.each(roles)("selects only units for the %s role", (role) => {
    expect(skillsFor(slotFor(role), roleUnits, []).map((s) => s.id)).toEqual([`${role}-only`])
  })

  it("selects gate:name only for that gate's single-gate session", () => {
    const units = [unit(), unit({ id: "correctness-only", sessions: ["gate:correctness"] })]
    expect(skillsFor(design, units, []).map((s) => s.id)).toEqual(["design-ownership"])
    expect(skillsFor(correctness, units, []).map((s) => s.id)).toEqual(["correctness-only"])
    for (const role of ["reviewer", "supervisor", "judge", "answerer"] as const) {
      expect(skillsFor(slotFor(role), units, [])).toEqual([])
    }
    expect(skillsFor({ ...design, gates: config.defaultLane.gates }, units, [])).toEqual([])
  })

  it.each([
    { paths: [change("src/ui/Button.vue")], expected: ["scoped", "global"] },
    { paths: [change("src/components/Card.vue")], expected: ["scoped", "global"] },
    { paths: [change("docs/guide.md")], expected: ["global"] },
    { paths: [change("docs/guide.md"), change("src/ui/Button.vue")], expected: ["scoped", "global"] },
    { paths: [change("src/moved.ts", "renamed", "src/ui/Button.vue")], expected: ["scoped", "global"] },
    { paths: [], expected: ["global"] }
  ])("filters path globs against $paths", ({ paths, expected }) => {
    const units = [
      unit({ id: "scoped", sessions: ["gate"], paths: ["src/ui/**", "src/components/**"] }),
      unit({ id: "global", sessions: ["gate"] })
    ]
    expect(skillsFor(design, units, paths).map((s) => s.id)).toEqual(expected)
  })

  it("keeps config order after filtering", () => {
    const units = [
      unit({ id: "z-last", sessions: ["gate"] }),
      unit({ id: "skipped", sessions: ["answerer"] }),
      unit({ id: "a-first", sessions: ["gate:design"] }),
      unit({ id: "m-middle", sessions: ["gate"], paths: ["src/**"] })
    ]
    expect(skillsFor(design, units, [change("src/app.ts")]).map((s) => s.id)).toEqual(["z-last", "a-first", "m-middle"])
  })
})

describe("skill references in instructionsFor", () => {
  it.each(roles)("omits skill references and the applied rule for %s without units", (role) => {
    const text = instructionsFor(slotFor(role), [], false)
    expect(text).not.toContain("## Skill references")
    expect(text).not.toContain("`applied`")
    expect(instructionsFor(slotFor(role), [], false, [])).toBe(text)
  })

  it.each(["reviewer", "gate", "supervisor", "judge"] as const)("gives %s the preface, unit text and applied rule", (role) => {
    const text = instructionsFor(slotFor(role), [], false, [unit()])
    expect(text).toContain("## Skill references")
    expect(text).toContain("The skill texts below are read-only review criteria chosen by the operator.")
    expect(text).toContain("The repository's rules, this role, your tools, the severity policy and the output schema take precedence over them.")
    expect(text).toContain("### Skill `Design`: unit `design-ownership`")
    expect(text).toContain(`\`\`\`text\n${skillText}\n\`\`\``)
    expect(text).toContain("- Record in each finding's `applied` the skills and rules it applied, using the skill name exactly as given; leave it empty when no skill applied.")
  })

  it("gives the answerer skill references without a finding's applied rule", () => {
    const text = instructionsFor(slotFor("answerer"), [], false, [unit({ sessions: ["answerer"] })])
    expect(text).toContain("## Skill references")
    expect(text).toContain("The skill texts below are read-only review criteria chosen by the operator.")
    expect(text).toContain(skillText)
    expect(text).not.toContain("`applied`")
  })
})

describe("skill attribution schemas", () => {
  const gates = configOf().defaultLane.gates

  it("rejects an unknown skill name", () => {
    const decode = Schema.decodeUnknownResult(reviewOutput(gates, false, ["Design"]))
    const output = reviewOut([{ ...finding("design", "advisory"), applied: [{ skill: "Unknown", rule: "Keep one owner" }] }])
    expect(Result.isFailure(decode(output))).toBe(true)
  })

  it.each([false, true])("omits applied from review findings without skill names, suggestions %s", (suggests) => {
    const f = { ...finding("design", "advisory"), ...(suggests ? { suggestion: null } : {}) }
    const decode = Schema.decodeUnknownResult(reviewOutput(gates, suggests))
    expect(decode(reviewOut([f]))).toEqual(Result.succeed(reviewOut([f])))
    expect(decode(reviewOut([{ ...f, applied: [{ skill: "Design", rule: "Keep one owner" }] }]))).toEqual(Result.succeed(reviewOut([f])))
  })

  it.each([false, true])("accepts a known skill on a review finding, suggestions %s", (suggests) => {
    const f = { ...finding("design", "advisory"), ...(suggests ? { suggestion: null } : {}), applied: [{ skill: "Design", rule: "Keep one owner" }] }
    const output = reviewOut([f])
    expect(Schema.decodeUnknownResult(reviewOutput(gates, suggests, ["Design"]))(output)).toEqual(Result.succeed(output))
  })

  it("rejects an unknown skill on a gate finding with suggestions", () => {
    const output = reviewOut([{ ...finding("design", "advisory"), suggestion: null, applied: [{ skill: "Unknown", rule: "Keep one owner" }] }])
    expect(Result.isFailure(Schema.decodeUnknownResult(reviewOutput(gates, true, ["Design"]))(output))).toBe(true)
  })

  it.each([false, true])("accepts an empty applied list but requires it with skill names, suggestions %s", (suggests) => {
    const f = { ...finding("design", "advisory"), ...(suggests ? { suggestion: null } : {}) }
    const decode = Schema.decodeUnknownResult(reviewOutput(gates, suggests, ["Design"]))
    const output = reviewOut([{ ...f, applied: [] }])
    expect(decode(output)).toEqual(Result.succeed(output))
    expect(Result.isFailure(decode(reviewOut([f])))).toBe(true)
  })

  it("omits applied from added synthesis findings without skill names", () => {
    const f = finding("design", "advisory")
    const output = { summary: "Looks fine.", decisions: [], added: [f], limitations: [] }
    const decode = Schema.decodeUnknownResult(synthesisOutput(gates, "supervisor"))
    expect(decode(output)).toEqual(Result.succeed(output))
    expect(decode({ ...output, added: [{ ...f, applied: [{ skill: "Design", rule: "Keep one owner" }] }] })).toEqual(Result.succeed(output))
  })

  it("rejects an unknown skill on an added synthesis finding", () => {
    const decode = Schema.decodeUnknownResult(synthesisOutput(gates, "supervisor", ["Design"]))
    const output = { summary: "Looks fine.", decisions: [], added: [{ ...finding("design", "advisory"), applied: [{ skill: "Unknown", rule: "Keep one owner" }] }], limitations: [] }
    expect(Result.isFailure(decode(output))).toBe(true)
  })

  it("accepts a known skill on an added synthesis finding", () => {
    const decode = Schema.decodeUnknownResult(synthesisOutput(gates, "supervisor", ["Design"]))
    const output = { summary: "Looks fine.", decisions: [], added: [{ ...finding("design", "advisory"), applied: [{ skill: "Design", rule: "Keep one owner" }] }], limitations: [] }
    expect(decode(output)).toEqual(Result.succeed(output))
  })

  it("accepts an empty applied list but requires it on added synthesis findings with skill names", () => {
    const f = finding("design", "advisory")
    const decode = Schema.decodeUnknownResult(synthesisOutput(gates, "supervisor", ["Design"]))
    const output = { summary: "Looks fine.", decisions: [], added: [{ ...f, applied: [] }], limitations: [] }
    expect(decode(output)).toEqual(Result.succeed(output))
    expect(Result.isFailure(decode({ ...output, added: [f] }))).toBe(true)
  })
})

describe("skill references in renderReport", () => {
  const review = {
    ...sampleReview,
    skills: [{ unit: unit(), sessions: [design.id, slotFor("supervisor").id] }],
    outcome: {
      ...sampleOutcome,
      findings: [
        { ...sampleOutcome.findings[0]!, applied: [] },
        { ...sampleOutcome.findings[1]!, applied: [{ skill: "Design", rule: "Keep one owner" }] }
      ]
    }
  }

  it("links the pinned source lines and shows a 12-character hash in the PINNED SKILLS table", () => {
    const text = renderReport(review)
    const table = text.split("<summary>PINNED SKILLS</summary>")[1]?.split("</details>")[0] ?? ""
    expect(text).toContain("<summary>PINNED SKILLS</summary>")
    expect(table).toContain("| Unit | Skill | Source | SHA-256 | Sessions |")
    expect(table).toContain("| `design-ownership` | Design |")
    expect(table).toContain(`](https://github.com/example/review-skills/blob/${skillFile.source.commit}/skills/design/SKILL.md#L12-L24) | \`${skillFile.sha256.slice(0, 12)}\` | \`gate.design\`, \`supervisor\` |`)
    expect(table).not.toContain(skillFile.sha256)
  })

  it("shows none on an unattributed blocker and the skill and rule on an advisory", () => {
    const text = renderReport(review)
    const blockers = text.split("### Blockers")[1]?.split("<details>")[0] ?? ""
    const advisories = text.split("<summary>1 advisory</summary>")[1]?.split("</details>")[0] ?? ""
    expect(blockers).toContain("Skills applied: none")
    expect(advisories).toContain("Skills applied: `Design`: Keep one owner")
  })

  it("omits the skills table and finding attribution without pinned skills", () => {
    const text = renderReport({ ...review, skills: [] })
    expect(text).not.toContain("PINNED SKILLS")
    expect(text).not.toContain("Skills applied:")
  })
})
