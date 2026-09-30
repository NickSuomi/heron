import { describe, expect, it } from "@effect/vitest"
import { Result } from "effect"
import type { DiscussionId, Finding, FindingId, LabelMap, LocatedFinding, NoteId, SessionId, Thread, UserId } from "../src/domain.ts"
import {
  admits,
  applySynthesis,
  carried,
  classify,
  EARLIER,
  fingerprintOf,
  labelTransition,
  planFor,
  publication,
  slotsOf,
  threadActions,
  verdictOf
} from "../src/policy.ts"
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
    const complete = (findings: Array<Finding>) => ({ kind: "complete" as const, summary: "", findings, rulings: [], limitations: [] })
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
      decisions: [{ id: "gate.design#1", ruling: "drop", reason: "", line: null }, { id: "gate.design#2", ruling: "keep", reason: "", line: null }],
      added: [{ gate: "design", severity: "blocker", location: null, title: "missed", body: "" }]
    }, "supervisor" as SessionId)
    expect(Result.map(out, (fs) => fs.map((x) => `${x.id}:${x.severity}`))).toEqual(
      Result.succeed(["gate.design#2:advisory", "supervisor#1:blocker"])
    )
  })

  it("keeps a finding ruled keep as advisory with advisory severity, whatever the gate said", () => {
    const out = applySynthesis(inputs, {
      summary: "",
      limitations: [],
      decisions: [{ id: "gate.design#1", ruling: "keep as advisory", reason: "", line: null }, { id: "gate.design#2", ruling: "keep as advisory", reason: "", line: null }]
    }, judge)
    expect(Result.map(out, (fs) => fs.map((x) => `${x.id}:${x.severity}`))).toEqual(Result.succeed(["gate.design#1:advisory", "gate.design#2:advisory"]))
  })

  it("places a kept finding that has no line at the decision's line, and never moves one that has a line", () => {
    const unplaced = { ...f("earlier#1", "blocker"), location: { path: "src/a.ts", line: null } }
    const placed = { ...f("earlier#2", "blocker"), location: { path: "src/a.ts", line: 4 } }
    const out = applySynthesis([unplaced, placed], {
      summary: "",
      limitations: [],
      decisions: [{ id: "earlier#1", ruling: "keep", reason: "", line: 12 }, { id: "earlier#2", ruling: "keep", reason: "", line: 30 }]
    }, judge)
    expect(Result.map(out, (fs) => fs.map((x) => x.location))).toEqual(Result.succeed([{ path: "src/a.ts", line: 12 }, { path: "src/a.ts", line: 4 }]))
  })

  it("fails when decisions are not a bijection over the input ids", () => {
    const out = applySynthesis(inputs, {
      summary: "",
      limitations: [],
      decisions: [
        { id: "gate.design#1", ruling: "keep", reason: "", line: null },
        { id: "gate.design#1", ruling: "drop", reason: "", line: null },
        { id: "gate.spec#9", ruling: "keep", reason: "", line: null }
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

describe("carried", () => {
  const at = (id: string, location: Finding["location"]): Finding => ({ ...f(id, "blocker"), location })
  const delta = [{ path: "src/a.ts", oldPath: null, status: "modified" as const, diff: "@@ -2,1 +2,3 @@\n-two\n+TWO\n+two and a half\n+two and three quarters" }]

  it("moves each earlier finding to its line at the reviewed head and leaves a line the delta rewrote without one", () => {
    expect(carried([at("earlier#1", { path: "src/a.ts", line: 9 }), at("earlier#2", { path: "src/a.ts", line: 2 }), at("earlier#3", null)], delta).map((x) => x.location))
      .toEqual([{ path: "src/a.ts", line: 11 }, { path: "src/a.ts", line: null }, null])
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

describe("threadActions", () => {
  const blocker = (title: string, origin = "supervisor"): LocatedFinding => ({
    id: `${origin}#1` as FindingId,
    origin: origin as SessionId,
    gate: "correctness",
    severity: "blocker",
    location: { path: "src/a.ts", line: 4 },
    title,
    body: ""
  })
  const anchor = { oldPath: "src/a.ts", newPath: "src/a.ts", newLine: 4, oldLine: null }
  const draft = (finding: LocatedFinding, body = "now", onDiff = true) => ({ finding, body, anchor: onDiff ? anchor : null })
  const thread = (n: number, title: string, body = "now", resolved = false): Thread => ({
    id: `d${n}` as DiscussionId,
    note: n as NoteId,
    fingerprint: fingerprintOf(blocker(title)),
    body,
    resolved
  })
  const kinds = (actions: ReturnType<typeof threadActions>) =>
    actions.map((a) => a.kind === "resolve" ? `resolve ${a.thread.id}` : a.kind === "create" ? `create ${a.finding.title}` : `${a.kind} ${a.thread.id} ${a.body}`)

  it("finds a thread again by gate, path and a title that differs only in case, spacing and punctuation", () => {
    expect(fingerprintOf(blocker("  Export: button   stays ENABLED!"))).toEqual({ gate: "correctness", path: "src/a.ts", title: "export button stays enabled" })
    expect(kinds(threadActions([draft(blocker("Export button stays enabled."), "later")], [thread(1, "export: button stays enabled")]))).toEqual([
      "update d1 later"
    ])
  })

  it("opens a thread only for a blocker on a diff line, a carried one included, once per fingerprint", () => {
    expect(kinds(threadActions([
      draft(blocker("On the diff")),
      draft(blocker("On the diff"), "a duplicate"),
      draft(blocker("Off the diff"), "now", false),
      draft(blocker("Carried to a line on the diff", EARLIER)),
      draft({ ...blocker("Carried from a rewritten line", EARLIER), location: { path: "src/a.ts", line: null } }, "now", false)
    ], []))).toEqual(["create On the diff", "create Carried to a line on the diff"])
  })

  it("updates an open thread only when its text changed, and reopens a resolved one", () => {
    expect(kinds(threadActions([draft(blocker("Same")), draft(blocker("Changed"), "new"), draft(blocker("Resolved")), draft(blocker("Resolved, changed"), "new")], [
      thread(1, "Same"),
      thread(2, "Changed", "old"),
      thread(3, "Resolved", "now\n", true),
      thread(4, "Resolved, changed", "old", true)
    ]))).toEqual(["update d2 new", "reopen d3 null", "reopen d4 new"])
  })

  it("keeps the thread of a carried earlier blocker, even off the diff", () => {
    expect(kinds(threadActions([draft(blocker("Carried", EARLIER), "later", false)], [thread(1, "Carried")]))).toEqual(["update d1 later"])
  })

  it("resolves every open thread whose blocker is gone and leaves resolved ones and duplicates of a kept one alone", () => {
    expect(kinds(threadActions([draft(blocker("Kept"))], [
      thread(1, "Kept"),
      thread(2, "Kept", "a second thread"),
      thread(3, "Fixed"),
      thread(4, "Fixed earlier", "now", true)
    ]))).toEqual(["resolve d3"])
  })
})
