import { describe, expect, it } from "@effect/vitest"
import { type Gate, type GateName, outputJsonSchema, reviewOutput, synthesisOutput } from "../src/domain.ts"
import { parseMarker, printMarker } from "../src/report.ts"
import { sha } from "./fakes.ts"

describe("marker", () => {
  it("round-trips through a note body", () => {
    const marker = { iid: 42, head: sha("a"), configDigest: "f".repeat(64), verdict: "CHANGES REQUESTED" as const }
    const body = `${printMarker(marker)}\n## Heron review: CHANGES REQUESTED\n`
    expect(printMarker(marker)).toBe(`<!-- heron:v1 mr=42 head=${"a".repeat(40)} config=${"f".repeat(64)} verdict=changes-requested -->`)
    expect(parseMarker(body)).toEqual(marker)
  })

  it("ignores notes without a well-formed marker", () => {
    expect(parseMarker("plain comment")).toBe(null)
    expect(parseMarker(`<!-- heron:v1 mr=1 head=${"a".repeat(40)} config=${"f".repeat(64)} verdict=maybe -->`)).toBe(null)
  })
})

const gates: readonly [Gate, ...Array<Gate>] = [
  { name: "design" as GateName, instructions: "" },
  { name: "correctness" as GateName, instructions: "" }
]

const allowed = new Set([
  "type", "properties", "required", "additionalProperties", "items", "enum", "anyOf", "const", "description", "title",
  "pattern", "minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "minItems", "maxItems", "$ref", "$defs"
])

/** OpenAI strict structured output: every key required, no optional keys, closed objects, no lookaround patterns. */
const strictViolations = (node: unknown, at = "$"): Array<string> => {
  if (typeof node !== "object" || node === null) return []
  if (Array.isArray(node)) return node.flatMap((n, i) => strictViolations(n, `${at}[${i}]`))
  const o = node as Record<string, unknown>
  const out = Object.keys(o).filter((k) => !allowed.has(k) && !at.endsWith(".properties")).map((k) => `${at}: keyword ${k}`)
  if (o["type"] === "object") {
    const keys = Object.keys((o["properties"] ?? {}) as object).sort()
    if (o["additionalProperties"] !== false) out.push(`${at}: additionalProperties must be false`)
    if (JSON.stringify([...(o["required"] as Array<string> ?? [])].sort()) !== JSON.stringify(keys)) out.push(`${at}: not every key required`)
  }
  if (typeof o["pattern"] === "string" && /\(\?<?[=!]/.test(o["pattern"])) out.push(`${at}: lookaround in pattern`)
  return [...out, ...Object.entries(o).flatMap(([k, v]) => strictViolations(v, `${at}.${k}`))]
}

describe("model output schemas", () => {
  it("obey strict structured-output rules", () => {
    const emitted = {
      reviewer: outputJsonSchema(reviewOutput(gates)),
      supervisor: outputJsonSchema(synthesisOutput(gates, "supervisor")),
      judge: outputJsonSchema(synthesisOutput(gates, "judge"))
    }
    expect(Object.entries(emitted).flatMap(([role, s]) => strictViolations(s, role))).toEqual([])
    expect(Object.keys((emitted.judge["properties"] ?? {}) as object)).toEqual(["summary", "decisions", "limitations"])
    expect(Object.keys((emitted.supervisor["properties"] ?? {}) as object)).toEqual(["summary", "decisions", "added", "limitations"])
  })

  it("detects a violation when a key is optional", () => {
    expect(strictViolations({ type: "object", properties: { a: { type: "string" } }, required: [], additionalProperties: false })).toEqual([
      "$: not every key required"
    ])
  })
})
