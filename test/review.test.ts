import { describe, expect, it } from "@effect/vitest"
import { Effect, Layer } from "effect"
import type { UserId } from "../src/domain.ts"
import { ForgeError, HarnessError, type HarnessRequest } from "../src/ports.ts"
import { parseMarker } from "../src/report.ts"
import { reviewOnce } from "../src/review.ts"
import { change, configOf, fakeForge, fakeHarness, finding, keepAll, promptIds, reviewOut, type Script, sha } from "./fakes.ts"

const config = configOf()
const ref = { project: "group/app", iid: 7 }
const trigger = 2001 as UserId

const run = (
  forge: ReturnType<typeof fakeForge>,
  answers: Record<string, Script>,
  options: { publish?: boolean; triggeredBy?: UserId | null; onRun?: (r: HarnessRequest) => void; slow?: Record<string, number> } = {}
) =>
  reviewOnce(config, { ref, triggeredBy: options.triggeredBy === undefined ? trigger : options.triggeredBy, publish: options.publish ?? true }).pipe(
    Effect.provide(Layer.mergeAll(forge.layer, fakeHarness(answers, { ...(options.onRun ? { onRun: options.onRun } : {}), ...(options.slow ? { slow: options.slow } : {}) }).layer))
  )

const gated: Record<string, Script> = {
  "gate.design": () => reviewOut(),
  "gate.correctness": () => reviewOut([finding("correctness", "advisory")]),
  "supervisor": keepAll({ added: [] })
}

describe("reviewOnce", () => {
  it.effect("refuses a trigger user outside the allow list before touching the forge", () =>
    Effect.gen(function*() {
      const forge = fakeForge({ head: sha("a"), changes: [change("src/app.ts")] })
      const error = yield* Effect.flip(run(forge, gated, { triggeredBy: 999 as UserId }))
      expect([error._tag, error.message, forge.state.calls]).toEqual(["NotAdmitted", "user 999 is not in admission.allowedTriggerUserIds", 0])
    }))

  it.effect("publishes one PASS note and converges labels", () =>
    Effect.gen(function*() {
      const forge = fakeForge({ head: sha("a"), changes: [change("src/app.ts")], labels: ["team::web", "review::blocked"] })
      const result = yield* run(forge, gated)
      expect(result.note).toEqual({ kind: "created", note: 100 })
      expect(parseMarker(forge.state.notes.get(100)!)).toEqual({ iid: 7, head: sha("a"), configDigest: config.digest, verdict: "PASS" })
      expect(forge.state.labels).toEqual(["team::web", "review::passed"])
      expect(forge.state.labelWrites).toEqual([
        { add: ["review::in progress"], remove: [] },
        { add: ["review::passed"], remove: ["review::in progress", "review::blocked"] }
      ])
    }))

  it.effect("updates the same note on a re-run instead of posting a second one", () =>
    Effect.gen(function*() {
      const forge = fakeForge({ head: sha("a"), changes: [change("src/app.ts")] })
      yield* run(forge, gated)
      forge.state.notes.set(101, "a human comment")
      const second = yield* run(forge, {
        ...gated,
        "gate.design": () => reviewOut([finding("design", "blocker", "Leaky abstraction")])
      })
      expect(second.note).toEqual({ kind: "updated", note: 100 })
      expect([...forge.state.notes.keys()]).toEqual([100, 101])
      expect(parseMarker(forge.state.notes.get(100)!)?.verdict).toBe("CHANGES REQUESTED")
      expect(forge.state.labels).toEqual(["review::changes requested"])
    }))

  it.effect("marks the report SUPERSEDED when the head moves before publishing", () =>
    Effect.gen(function*() {
      const forge = fakeForge({ head: sha("a"), changes: [change("src/app.ts")], labels: ["review::passed"] })
      const result = yield* run(forge, gated, {
        onRun: (r) => {
          if (r.slot.role === "supervisor") forge.state.head = sha("c")
        }
      })
      expect(result.review.verdict).toBe("SUPERSEDED")
      expect(parseMarker(forge.state.notes.get(100)!)?.head).toBe(sha("a"))
      expect(result.body).toContain("The source branch moved to `cccccccc` during the review.")
      expect(forge.state.labels).toEqual([])
    }))

  it.effect("does not let a superseded run overwrite a report that covers the live head", () =>
    Effect.gen(function*() {
      const forge = fakeForge({ head: sha("a"), changes: [change("src/app.ts")] })
      const newer = `<!-- heron:v1 mr=7 head=${sha("c")} config=${config.digest} verdict=pass -->\nnewer`
      const result = yield* run(forge, gated, {
        onRun: (r) => {
          if (r.slot.role === "supervisor") {
            forge.state.head = sha("c")
            forge.state.notes.set(50, newer)
            forge.state.labels = ["review::passed", "review::in progress"]
          }
        }
      })
      expect([result.review.verdict, result.note]).toEqual(["SUPERSEDED", { kind: "skipped", note: 50 }])
      expect(forge.state.notes.get(50)).toBe(newer)
      expect(forge.state.labels).toEqual(["review::passed"])
    }))

  it.effect("returns BLOCKED when the judge's decisions miss a finding", () =>
    Effect.gen(function*() {
      const forge = fakeForge({ head: sha("a"), changes: [change("src/auth/login.ts")] })
      const result = yield* run(forge, {
        "b1.gate.design": () => reviewOut([finding("design", "blocker")]),
        "b1.gate.correctness": () => reviewOut(),
        "b1.supervisor": keepAll({ added: [] }),
        "b2.gate.design": () => reviewOut(),
        "b2.gate.correctness": () => reviewOut([finding("correctness", "advisory")]),
        "b2.supervisor": keepAll({ added: [] }),
        "judge": () => ({ summary: "", decisions: [{ id: "b1.gate.design#1", keep: true, reason: "" }], limitations: [] })
      })
      expect(result.review.outcome).toEqual({
        kind: "incomplete",
        session: "judge",
        reason: "decisions do not cover the findings exactly once (missing b2.gate.correctness#1; duplicated none; unknown none)"
      })
      expect(parseMarker(forge.state.notes.get(100)!)?.verdict).toBe("BLOCKED")
      expect(forge.state.labels).toEqual(["review::blocked"])
    }))

  it.effect("gives every session, the judge included, the three-commit checkout and no turn or time limit", () =>
    Effect.gen(function*() {
      const forge = fakeForge({ head: sha("a"), changes: [change("src/auth/login.ts")] })
      const { layer, seen } = fakeHarness({
        "b1.gate.design": () => reviewOut(),
        "b1.gate.correctness": () => reviewOut(),
        "b1.supervisor": keepAll({ added: [] }),
        "b2.gate.design": () => reviewOut(),
        "b2.gate.correctness": () => reviewOut(),
        "b2.supervisor": keepAll({ added: [] }),
        "judge": keepAll()
      })
      const result = yield* reviewOnce(config, { ref, triggeredBy: trigger, publish: true }).pipe(Effect.provide(Layer.mergeAll(forge.layer, layer)))
      expect(result.review.verdict).toBe("PASS")
      const access = (r: (typeof seen)[number]) =>
        `${r.slot.id}:${r.source.commits.source === sha("a") && r.source.commits.target === sha("b") ? "checkout" : "none"}:${r.maxTurns}:${r.timeout}`
      expect(seen.map(access).sort()).toEqual([
        "b1.gate.correctness:checkout:null:null",
        "b1.gate.design:checkout:null:null",
        "b1.supervisor:checkout:null:null",
        "b2.gate.correctness:checkout:null:null",
        "b2.gate.design:checkout:null:null",
        "b2.supervisor:checkout:null:null",
        "judge:checkout:null:null"
      ])
    }))

  it.effect("turns a harness failure into a BLOCKED report and a schema mismatch likewise", () =>
    Effect.gen(function*() {
      const failing = yield* run(fakeForge({ head: sha("a"), changes: [change("README.md")] }), {
        reviewer: () => new HarnessError({ kind: "quota", detail: "limit reached" })
      })
      const malformed = yield* run(fakeForge({ head: sha("a"), changes: [change("README.md")] }), {
        reviewer: () => reviewOut([finding("design", "blocker")])
      })
      expect([failing.review.verdict, failing.body.includes("session `reviewer` failed. quota\\:\u2060 limit reached")]).toEqual(["BLOCKED", true])
      expect([malformed.review.verdict, malformed.review.outcome.kind]).toEqual(["BLOCKED", "incomplete"])
    }))

  it.effect("removes the in-progress label when publishing the report fails", () =>
    Effect.gen(function*() {
      const forge = fakeForge({ head: sha("a"), changes: [change("src/app.ts")], labels: ["team::web"], failCreateNote: true })
      const error = yield* Effect.flip(run(forge, gated))
      expect([error.message, forge.state.labels]).toEqual(["createNote: HTTP 500", ["team::web"]])
    }))

  it.effect("records the failed session in the provenance table of a BLOCKED report", () =>
    Effect.gen(function*() {
      const result = yield* run(fakeForge({ head: sha("a"), changes: [change("README.md")] }), {
        reviewer: () => new HarnessError({ kind: "quota", detail: "limit reached" })
      }, { publish: false })
      const lines = result.body.split("\n")
      const at = lines.indexOf("<summary>AGENT PROVENANCE</summary>")
      expect(lines.slice(at + 2, at + 7)).toEqual([
        "| Session | Model | Effort | Tokens in / out | Duration | Result |",
        "| --- | --- | --- | --- | --- | --- |",
        "| `reviewer` | model\\-\u2060q (alpha) | low | n/a / n/a | 0.0 s | quota |",
        "",
        "Totals: n/a / n/a tokens in / out, n/a tool calls, no vendor-reported cost."
      ])
    }))

  it.live("records a sibling session the failing gate interrupted in the provenance table", () =>
    Effect.gen(function*() {
      const result = yield* run(fakeForge({ head: sha("a"), changes: [change("src/app.ts")] }), {
        ...gated,
        "gate.design": () => new HarnessError({ kind: "quota", detail: "limit reached" })
      }, { publish: false, slow: { "gate.design": 5, "gate.correctness": 60_000 } })
      const lines = result.body.split("\n")
      const at = lines.indexOf("<summary>AGENT PROVENANCE</summary>")
      expect(lines.slice(at + 4, at + 7)).toEqual([
        "| `gate.design` | model\\-\u2060q (alpha) | low | n/a / n/a | 0.0 s | quota |",
        "| `gate.correctness` | model\\-\u2060q (alpha) | low | n/a / n/a | 0.0 s | interrupted |",
        ""
      ])
    }))

  it.effect("shows the supervisor's ruling on each gate finding in REVIEW CHECKS", () =>
    Effect.gen(function*() {
      const result = yield* run(fakeForge({ head: sha("a"), changes: [change("src/app.ts")] }), {
        ...gated,
        "gate.design": () => reviewOut([finding("design", "blocker", "Wrong layer")]),
        "supervisor": () => ({
          summary: "Fine.",
          decisions: [
            { id: "gate.design#1", keep: false, reason: "The layer is right." },
            { id: "gate.correctness#1", keep: true, reason: "Real." }
          ],
          added: [],
          limitations: []
        })
      }, { publish: false })
      const lines = result.body.split("\n")
      const at = lines.indexOf("| By | Finding | Ruling | Reason |")
      expect([result.review.verdict, ...lines.slice(at + 2, at + 4)]).toEqual([
        "PASS",
        "| `supervisor` | `gate.design#1` Wrong layer | dropped | The layer is right\\.\u2060 |",
        "| `supervisor` | `gate.correctness#1` advisory in correctness | kept | Real\\.\u2060 |"
      ])
    }))

  it.effect("publishes nothing and leaves labels alone on a dry run", () =>
    Effect.gen(function*() {
      const forge = fakeForge({ head: sha("a"), changes: [change("src/app.ts")], labels: ["x"] })
      const result = yield* run(forge, gated, { publish: false })
      expect([result.note, result.review.verdict, forge.state.notes.size, forge.state.labels]).toEqual([{ kind: "dry-run" }, "PASS", 0, ["x"]])
      expect(result.body.split("\n").slice(1, 4)).toEqual(["## Heron review: PASS", "", "0 blockers · 1 advisory · head `aaaaaaaa` · lane `standard`"])
    }))

  it.live("never runs more sessions on one harness than its concurrency allows", () =>
    Effect.gen(function*() {
      const forge = fakeForge({ head: sha("a"), changes: [change("src/auth/login.ts")] })
      const { layer, peak } = fakeHarness({
        "b1.gate.design": () => reviewOut(),
        "b1.gate.correctness": () => reviewOut(),
        "b1.supervisor": keepAll({ added: [] }),
        "b2.gate.design": () => reviewOut(),
        "b2.gate.correctness": () => reviewOut(),
        "b2.supervisor": keepAll({ added: [] }),
        "judge": keepAll()
      }, { delay: 20 })
      yield* reviewOnce(config, { ref, triggeredBy: trigger, publish: false }).pipe(Effect.provide(Layer.mergeAll(forge.layer, layer)))
      expect(Object.fromEntries(peak)).toEqual({ alpha: 2, beta: 1 })
    }))
})

/** Publishes a first review at `a`, then moves the head to `c` with `delta` as the change between them. */
const reviewedThenPushed = (answers: Record<string, Script>, changes = [change("src/app.ts")]) =>
  Effect.gen(function*() {
    const forge = fakeForge({ head: sha("a"), changes })
    yield* run(forge, answers)
    forge.state.head = sha("c")
    forge.state.delta = (from, to) => from === sha("a") && to === sha("c") ? [change("src/other.ts", "added")] : null
    return forge
  })

const promptsOf = (seen: ReadonlyArray<HarnessRequest>, id: string) => seen.filter((r) => r.slot.id === id).map((r) => r.prompt)

describe("re-review", () => {
  it.effect("reviews only the new commits and lets the supervisor rule on each earlier finding", () =>
    Effect.gen(function*() {
      const forge = yield* reviewedThenPushed(gated)
      const seen: Array<HarnessRequest> = []
      const result = yield* run(forge, {
        ...gated,
        "gate.design": () => reviewOut([finding("design", "blocker", "New helper skips validation")])
      }, { onRun: (r) => seen.push(r) })
      const [gatePrompt] = promptsOf(seen, "gate.design")
      const [supervisorPrompt] = promptsOf(seen, "supervisor")
      expect(forge.state.deltaCalls).toEqual([[sha("a"), sha("c")]])
      expect([
        gatePrompt!.includes(`## Changes since \`${sha("a")}\``),
        gatePrompt!.includes("### added `src/other.ts`"),
        gatePrompt!.includes("### modified `src/app.ts`"),
        gatePrompt!.includes("## Earlier findings")
      ]).toEqual([true, true, false, false])
      expect(supervisorPrompt!.includes("## Earlier findings")).toBe(true)
      expect(result.review.verdict).toBe("CHANGES REQUESTED")
      expect(result.review.outcome.kind === "complete" && result.review.outcome.findings.map((f) => f.id)).toEqual([
        "gate.design#1",
        "gate.correctness#1",
        "earlier#1"
      ])
      expect(result.body).toContain("Re-review of `aaaaaaaa..cccccccc`: 1 of 1 earlier findings carried.")
      expect(result.body).toContain("| `supervisor` | `earlier#1` advisory in correctness | kept | real |")
      expect(result.note).toEqual({ kind: "updated", note: 100 })
      expect(parseMarker(forge.state.notes.get(100)!)?.head).toBe(sha("c"))
    }))

  it.effect("drops an earlier finding the supervisor rules fixed, and the verdict follows the kept findings", () =>
    Effect.gen(function*() {
      const forge = yield* reviewedThenPushed({ ...gated, "gate.design": () => reviewOut([finding("design", "blocker", "Leaky abstraction")]) })
      expect(parseMarker(forge.state.notes.get(100)!)?.verdict).toBe("CHANGES REQUESTED")
      const result = yield* run(forge, {
        "gate.design": () => reviewOut(),
        "gate.correctness": () => reviewOut(),
        "supervisor": (r) => ({
          summary: "Fixed.",
          decisions: promptIds(r).map((id) => ({ id, keep: id !== "earlier#1", reason: id === "earlier#1" ? "The new commit removed it." : "real" })),
          added: [],
          limitations: []
        })
      })
      expect(result.review.verdict).toBe("PASS")
      expect(result.body).toContain("Re-review of `aaaaaaaa..cccccccc`: 1 of 2 earlier findings carried.")
      expect(result.body).toContain("| `supervisor` | `earlier#1` Leaky abstraction | dropped | The new commit removed it\\.⁠ |")
    }))

  it.effect("has the single reviewer rule on the earlier findings and add new ones", () =>
    Effect.gen(function*() {
      const forge = yield* reviewedThenPushed({ reviewer: () => reviewOut([finding("correctness", "blocker", "Broken link")]) }, [change("README.md")])
      forge.state.delta = () => [change("docs/guide.md")]
      const seen: Array<HarnessRequest> = []
      const result = yield* run(forge, {
        reviewer: () => ({
          summary: "Link fixed.",
          decisions: [{ id: "earlier#1", keep: false, reason: "The link now resolves." }],
          added: [finding("correctness", "advisory", "Typo in the new heading")],
          limitations: []
        })
      }, { onRun: (r) => seen.push(r) })
      expect(Object.keys((seen[0]!.outputSchema["properties"] ?? {}) as object)).toEqual(["summary", "decisions", "added", "limitations"])
      expect(result.review.verdict).toBe("PASS")
      expect(result.review.outcome.kind === "complete" && result.review.outcome.findings.map((f) => `${f.id} ${f.title}`)).toEqual([
        "reviewer#1 Typo in the new heading"
      ])
      expect(result.body).toContain("| `reviewer` | `earlier#1` Broken link | dropped | The link now resolves\\.⁠ |")
    }))

  it.effect("gives the earlier findings to the judge in a dual lane, not to the branches", () =>
    Effect.gen(function*() {
      const dual: Record<string, Script> = {
        "b1.gate.design": () => reviewOut([finding("design", "blocker", "Session outlives logout")]),
        "b1.gate.correctness": () => reviewOut(),
        "b1.supervisor": keepAll({ added: [] }),
        "b2.gate.design": () => reviewOut(),
        "b2.gate.correctness": () => reviewOut(),
        "b2.supervisor": keepAll({ added: [] }),
        "judge": keepAll()
      }
      const forge = yield* reviewedThenPushed(dual, [change("src/auth/login.ts")])
      const seen: Array<HarnessRequest> = []
      const result = yield* run(forge, { ...dual, "b1.gate.design": () => reviewOut() }, { onRun: (r) => seen.push(r) })
      expect(["b1.supervisor", "b2.supervisor", "judge"].map((id) => promptsOf(seen, id)[0]!.includes("## Earlier findings"))).toEqual([false, false, true])
      expect([result.review.verdict, result.review.outcome.kind === "complete" && result.review.outcome.findings.map((f) => f.id)]).toEqual([
        "CHANGES REQUESTED",
        ["earlier#1"]
      ])
    }))

  it.effect("takes the same path on a dry run and writes nothing", () =>
    Effect.gen(function*() {
      const forge = yield* reviewedThenPushed(gated)
      const note = forge.state.notes.get(100)
      const labels = [...forge.state.labels]
      const result = yield* run(forge, gated, { publish: false })
      expect([result.note, result.review.rereview?.from, forge.state.notes.get(100) === note, forge.state.labels]).toEqual([
        { kind: "dry-run" },
        sha("a"),
        true,
        labels
      ])
      expect(result.body).toContain("Re-review of `aaaaaaaa..cccccccc`: 1 of 1 earlier findings carried.")
    }))

  const fallbacks: ReadonlyArray<readonly [string, (forge: ReturnType<typeof fakeForge>) => void]> = [
    ["the head has not moved", (forge) => void (forge.state.head = sha("a"))],
    ["the earlier head is not an ancestor of the new one", (forge) => void (forge.state.delta = () => null)],
    ["the config digest changed", (forge) => void forge.state.notes.set(100, forge.state.notes.get(100)!.replace(config.digest, "e".repeat(64)))],
    ["the target branch moved", (forge) => void (forge.state.start = sha("d"))],
    ["the merge base moved", (forge) => void (forge.state.base = sha("d"))],
    ["the lane changed", (forge) => void (forge.state.changes = [change("src/app.ts"), change("src/auth/login.ts")])],
    ["the earlier note carries no findings data", (forge) => void forge.state.notes.set(100, forge.state.notes.get(100)!.replace(/<!-- heron:prior [^\n]*\n$/, ""))],
    ["the forge cannot compare the heads", (forge) => void (forge.state.delta = () => new ForgeError({ operation: "delta", detail: "HTTP 404" }))]
  ]
  for (const [name, change] of fallbacks) {
    it.effect(`reviews the whole change when ${name}`, () =>
      Effect.gen(function*() {
        const forge = yield* reviewedThenPushed(gated)
        change(forge)
        const seen: Array<HarnessRequest> = []
        const everyLane: Record<string, Script> = {
          ...gated,
          ...Object.fromEntries(["b1", "b2"].flatMap((b) => [
            [`${b}.gate.design`, () => reviewOut()],
            [`${b}.gate.correctness`, () => reviewOut()],
            [`${b}.supervisor`, keepAll({ added: [] })]
          ])),
          "judge": keepAll()
        }
        const result = yield* run(forge, everyLane, { onRun: (r) => seen.push(r) })
        expect([result.review.rereview, seen.some((r) => r.prompt.includes("## Earlier findings")), result.body.includes("Re-review")]).toEqual([null, false, false])
        expect(seen.every((r) => r.prompt.includes("### modified `src/app.ts`"))).toBe(true)
      }))
  }

  it.effect("reviews the whole change after a BLOCKED review, which leaves no findings to carry", () =>
    Effect.gen(function*() {
      const forge = yield* reviewedThenPushed({ ...gated, "gate.design": () => new HarnessError({ kind: "quota", detail: "limit reached" }) })
      const result = yield* run(forge, gated)
      expect([parseMarker(forge.state.notes.get(100)!)?.verdict, result.review.rereview, forge.state.deltaCalls]).toEqual(["PASS", null, []])
    }))
})
