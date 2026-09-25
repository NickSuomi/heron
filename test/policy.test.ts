import { describe, expect, it } from "@effect/vitest"
import { Result } from "effect"
import type { Finding, FindingId, LabelMap, NoteId, SessionId, UserId } from "../src/domain.ts"
import { admits, applySynthesis, classify, labelTransition, planFor, publication, slotsOf, verdictOf } from "../src/policy.ts"
import { change, configOf, sha } from "./fakes.ts"

const config = configOf()
const laneFor = (...paths: Array<string>) => classify(config, paths.map((p) => change(p))).lane.name

describe("classify", () => {
  it("picks the lane of the strictest rule that fires, else the default", () => {
    expect(laneFor("README.md", "docs/guide/setup.txt")).toBe("light")
    expect(laneFor("README.md", "src/app.ts")).toBe("standard")
    expect(laneFor("README.md", "src/auth/session.ts")).toBe("critical")
    expect(laneFor("src/app.ts")).toBe("standard")
  })

  it("reports which rule matched which paths", () => {
    expect(classify(config, [change("src/auth/a.ts"), change("docs/x.md")]).matched).toEqual([
      { rule: "auth", paths: ["src/auth/a.ts"] }
    ])
  })

  it("classifies a rename by both its old and new path", () => {
    expect(classify(config, [change("src/other.ts", "renamed", "src/auth/old.ts")]).lane.name).toBe("critical")
  })
})

describe("planFor", () => {
  const shape = (name: string) => {
    const plan = planFor(config.lanes.find((l) => l.name === name)!)
    return slotsOf(plan).map((s) => `${s.id}:${s.role}:${s.profile.harness}/${s.profile.model}:${s.gates.map((g) => g.name).join("+")}`)
  }

  it("builds one reviewer for a single lane", () => {
    expect(shape("light")).toEqual(["reviewer:reviewer:alpha/model-q:correctness"])
  })

  it("builds one gate session per gate plus a supervisor for a gated lane", () => {
    expect(shape("standard")).toEqual([
      "gate.design:gate:alpha/model-q:design",
      "gate.correctness:gate:alpha/model-q:correctness",
      "supervisor:supervisor:alpha/model-d:design+correctness"
    ])
  })

  it("builds two blind branches and a judge for a dual lane", () => {
    expect(shape("critical")).toEqual([
      "b1.gate.design:gate:alpha/model-q:design",
      "b1.gate.correctness:gate:alpha/model-q:correctness",
      "b1.supervisor:supervisor:alpha/model-d:design+correctness",
      "b2.gate.design:gate:beta/model-o:design",
      "b2.gate.correctness:gate:beta/model-o:correctness",
      "b2.supervisor:supervisor:beta/model-o:design+correctness",
      "judge:judge:alpha/model-d:design+correctness"
    ])
  })
})

const f = (id: string, severity: "blocker" | "advisory"): Finding => ({
  id: id as FindingId,
  origin: id.split("#")[0] as SessionId,
  gate: "design",
  severity,
  location: null,
  title: id,
  body: ""
})

describe("verdictOf", () => {
  it("derives the verdict from findings and completeness", () => {
    const complete = (findings: Array<Finding>) => ({ kind: "complete" as const, summary: "", findings, limitations: [] })
    expect(verdictOf(complete([]))).toBe("PASS")
    expect(verdictOf(complete([f("a#1", "advisory")]))).toBe("PASS")
    expect(verdictOf(complete([f("a#1", "advisory"), f("a#2", "blocker")]))).toBe("CHANGES REQUESTED")
    expect(verdictOf({ kind: "incomplete", session: "judge" as SessionId, reason: "timed out" })).toBe("BLOCKED")
  })
})

describe("applySynthesis", () => {
  const inputs = [f("gate.design#1", "blocker"), f("gate.design#2", "advisory")]
  const judge = "judge" as SessionId

  it("keeps the findings the decisions keep and ids the added ones", () => {
    const out = applySynthesis(inputs, {
      summary: "",
      limitations: [],
      decisions: [{ id: "gate.design#1", keep: false, reason: "" }, { id: "gate.design#2", keep: true, reason: "" }],
      added: [{ gate: "design", severity: "blocker", location: null, title: "missed", body: "" }]
    }, "supervisor" as SessionId)
    expect(Result.map(out, (fs) => fs.map((x) => `${x.id}:${x.severity}`))).toEqual(
      Result.succeed(["gate.design#2:advisory", "supervisor#1:blocker"])
    )
  })

  it("fails when decisions are not a bijection over the input ids", () => {
    const out = applySynthesis(inputs, {
      summary: "",
      limitations: [],
      decisions: [
        { id: "gate.design#1", keep: true, reason: "" },
        { id: "gate.design#1", keep: false, reason: "" },
        { id: "gate.spec#9", keep: true, reason: "" }
      ]
    }, judge)
    expect(Result.isFailure(out) && { ...out.failure }).toEqual({
      _tag: "SynthesisIncomplete",
      session: "judge",
      missing: ["gate.design#2"],
      duplicated: ["gate.design#1"],
      unknown: ["gate.spec#9"]
    })
  })
})

describe("labelTransition", () => {
  const map: LabelMap = { inProgress: "run", pass: "ok", changesRequested: "fix", blocked: "stop" }
  const apply = (live: Array<string>, t: { add: ReadonlyArray<string>; remove: ReadonlyArray<string> }) => [
    ...live.filter((l) => !t.remove.includes(l)),
    ...t.add
  ]

  it("adds the running label only when absent", () => {
    expect(labelTransition(map, { kind: "running" }, ["x"])).toEqual({ add: ["run"], remove: [] })
    expect(labelTransition(map, { kind: "running" }, ["x", "run"])).toEqual({ add: [], remove: [] })
  })

  it("converges to exactly the verdict label and leaves foreign labels alone", () => {
    const live = ["x", "run", "ok"]
    const first = labelTransition(map, { kind: "done", verdict: "CHANGES REQUESTED" }, live)
    expect(first).toEqual({ add: ["fix"], remove: ["run", "ok"] })
    const after = apply(live, first)
    expect(after).toEqual(["x", "fix"])
    expect(labelTransition(map, { kind: "done", verdict: "CHANGES REQUESTED" }, after)).toEqual({ add: [], remove: [] })
  })

  it("clears every managed label on SUPERSEDED and never touches an unset one", () => {
    expect(labelTransition(map, { kind: "done", verdict: "SUPERSEDED" }, ["run", "ok", "y"])).toEqual({ add: [], remove: ["run", "ok"] })
    expect(labelTransition({ ...map, pass: null }, { kind: "done", verdict: "PASS" }, ["run"])).toEqual({ add: [], remove: ["run"] })
  })
})

describe("publication", () => {
  const note = 5 as NoteId
  const marker = (head: string) => ({ iid: 7, head: sha(head), configDigest: "0".repeat(64), verdict: "PASS" as const })

  it("creates, updates, or leaves a newer report alone", () => {
    expect(publication(null, "PASS", sha("a"))).toEqual({ kind: "create" })
    expect(publication({ id: note, marker: marker("a") }, "PASS", sha("b"))).toEqual({ kind: "update", note: 5 })
    expect(publication({ id: note, marker: marker("a") }, "SUPERSEDED", sha("c"))).toEqual({ kind: "update", note: 5 })
    expect(publication({ id: note, marker: marker("c") }, "SUPERSEDED", sha("c"))).toEqual({ kind: "skip", note: 5 })
  })
})

describe("admits", () => {
  it("admits anyone without a list, and only listed users with one", () => {
    const u = (n: number) => n as UserId
    expect([admits(null, null), admits([u(1)], u(1)), admits([u(1)], u(2)), admits([u(1)], null)]).toEqual([true, true, false, false])
  })
})
