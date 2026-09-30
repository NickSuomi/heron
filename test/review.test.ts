import { describe, expect, it } from "@effect/vitest"
import { Effect, Layer } from "effect"
import type { DiscussionId, NoteId, Review, UserId } from "../src/domain.ts"
import { ForgeError, HarnessError, type HarnessRequest } from "../src/ports.ts"
import { parseMarker, parsePrior } from "../src/report.ts"
import { reviewOnce } from "../src/review.ts"
import { addedFile, change, configOf, fakeForge, fakeHarness, finding, keepAll, promptIds, reviewOut, type Script, sha } from "./fakes.ts"

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

  it.effect("gives every session the discussions of the merge request and of each linked issue, and says why one could not be read", () =>
    Effect.gen(function*() {
      const forge = fakeForge({ head: sha("a"), changes: [change("src/app.ts")] })
      const linked = (reference: string) => ({ reference, relation: "related" as const, title: "t", description: "", state: "opened", webUrl: "https://gitlab.example.com/x" })
      forge.state.issues = [linked("acme/storefront#12"), linked("acme/payments#3")]
      const thread = (id: string, body: string) => ({ id, resolved: false, path: null, line: null, notes: [{ author: "jdoe", createdAt: "2026-09-01T10:00:00.000Z", body }] })
      forge.state.comments = {
        "!": [thread("aa01", "Why not reuse the cart total?")],
        "acme/storefront#12": [thread("bb01", "Reproduced on staging.")],
        "acme/payments#3": "HTTP 403",
        "acme/storefront#13": [thread("cc01", "An issue the merge request does not link.")]
      }
      const seen: Array<HarnessRequest> = []
      const result = yield* run(forge, gated, { onRun: (r) => seen.push(r) })
      expect(result.review.verdict).toBe("PASS")
      const expected = {
        mergeRequest: { kind: "read", threads: [thread("aa01", "Why not reuse the cart total?")] },
        issues: {
          "acme/storefront#12": { kind: "read", threads: [thread("bb01", "Reproduced on staging.")] },
          "acme/payments#3": { kind: "unavailable", reason: "discussions: HTTP 403" }
        }
      }
      expect(seen.map((r) => [r.slot.id, r.discussions])).toEqual(["gate.design", "gate.correctness", "supervisor"].map((id) => [id, expected]))
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
        "judge": () => ({ summary: "", decisions: [{ id: "b1.gate.design#1", ruling: "keep", reason: "", line: null }], limitations: [] })
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
            { id: "gate.design#1", ruling: "drop", reason: "The layer is right.", line: null },
            { id: "gate.correctness#1", ruling: "keep", reason: "Real.", line: null }
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

  it.effect("moves a blocker the supervisor keeps as advisory into the advisories, and the verdict follows", () =>
    Effect.gen(function*() {
      const forge = fakeForge({ head: sha("a"), changes: [change("src/app.ts")] })
      const result = yield* run(forge, {
        ...gated,
        "gate.design": () => reviewOut([finding("design", "blocker", "Missing region comments")]),
        "supervisor": (r) => ({
          summary: "Fine.",
          decisions: promptIds(r).map((id) => ({ id, ruling: id === "gate.design#1" ? "keep as advisory" : "keep", reason: "A rule-only breach.", line: null })),
          added: [],
          limitations: []
        })
      })
      expect(result.review.verdict).toBe("PASS")
      expect(result.body).not.toContain("### Blockers")
      expect(result.body).toContain("<summary>2 advisories</summary>")
      expect(result.body).toContain("| `supervisor` | `gate.design#1` Missing region comments | kept as advisory | A rule\\-\u2060only breach\\.\u2060 |")
      expect(result.body).toContain("| design | pass |")
      expect(parsePrior(forge.state.notes.get(100)!)?.findings.map((f) => `${f.title}:${f.severity}`)).toEqual([
        "Missing region comments:advisory",
        "advisory in correctness:advisory"
      ])
    }))

  it.effect("publishes nothing and leaves labels alone on a dry run", () =>
    Effect.gen(function*() {
      const forge = fakeForge({ head: sha("a"), changes: [change("src/app.ts")], labels: ["x"] })
      const result = yield* run(forge, gated, { publish: false })
      expect([result.note, result.review.verdict, forge.state.notes.size, forge.state.labels]).toEqual([{ kind: "dry-run" }, "PASS", 0, ["x"]])
      expect(result.body.split("\n").slice(1, 4)).toEqual(["## Heron review: PASS", "", "0 blockers · 1 advisory · head `aaaaaaaa` · lane `standard`"])
    }))

  it.effect("reads the subscription before and after the sessions and shows the share next to the cost", () =>
    Effect.gen(function*() {
      const forge = fakeForge({ head: sha("a"), changes: [change("src/app.ts")] })
      const at = (fiveHour: number, weekly: number, resets = "2026-09-30T01:00:00Z") => [
        { window: "five-hour" as const, percent: fiveHour, resetsAt: resets },
        { window: "weekly" as const, percent: weekly, resetsAt: "2026-10-03T12:00:00Z" }
      ]
      const harness = fakeHarness(gated, { limits: [at(25, 38), at(28, 39)], limitWarning: "five_hour limit allowed_warning" })
      const result = yield* reviewOnce(config, { ref, triggeredBy: trigger, publish: false }).pipe(Effect.provide(Layer.mergeAll(forge.layer, harness.layer)))
      expect(result.review.subscription).toEqual({ before: at(25, 38), after: at(28, 39), warnings: ["five_hour limit allowed_warning"] })
      const lines = result.body.split("\n")
      expect(lines[lines.findIndex((l) => l.startsWith("Totals:")) + 2]).toBe(
        "Subscription: +3% of the five-hour window (now 28%), +1% of the weekly window (now 39%). An estimate: Claude reports whole percent, and other sessions on the account count too."
      )
    }))

  it.effect("shows no subscription line when no harness runs on a subscription", () =>
    Effect.gen(function*() {
      const forge = fakeForge({ head: sha("a"), changes: [change("src/app.ts")] })
      const result = yield* run(forge, gated, { publish: false })
      expect([result.review.subscription, result.body.includes("Subscription")]).toEqual([null, false])
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
          decisions: promptIds(r).map((id) => ({ id, ruling: id === "earlier#1" ? "drop" : "keep", reason: id === "earlier#1" ? "The new commit removed it." : "real", line: null })),
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
          decisions: [{ id: "earlier#1", ruling: "drop", reason: "The link now resolves.", line: null }],
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

  it.effect("lets the single reviewer keep an earlier blocker as advisory", () =>
    Effect.gen(function*() {
      const forge = yield* reviewedThenPushed({ reviewer: () => reviewOut([finding("correctness", "blocker", "Heading skips a level")]) }, [change("README.md")])
      forge.state.delta = () => [change("docs/guide.md")]
      const result = yield* run(forge, {
        reviewer: () => ({ summary: "Minor.", decisions: [{ id: "earlier#1", ruling: "keep as advisory", reason: "Style only.", line: null }], added: [], limitations: [] })
      })
      expect([result.review.verdict, result.body.includes("| `reviewer` | `earlier#1` Heading skips a level | kept as advisory |")]).toEqual(["PASS", true])
      expect(result.body).toContain("Re-review of `aaaaaaaa..cccccccc`: 1 of 1 earlier findings carried.")
    }))

  it.effect("lets the judge keep a branch blocker as advisory", () =>
    Effect.gen(function*() {
      const result = yield* run(fakeForge({ head: sha("a"), changes: [change("src/auth/login.ts")] }), {
        "b1.gate.design": () => reviewOut([finding("design", "blocker", "Token name is unclear")]),
        "b1.gate.correctness": () => reviewOut(),
        "b1.supervisor": keepAll({ added: [] }),
        "b2.gate.design": () => reviewOut(),
        "b2.gate.correctness": () => reviewOut(),
        "b2.supervisor": keepAll({ added: [] }),
        "judge": () => ({ summary: "", decisions: [{ id: "b1.gate.design#1", ruling: "keep as advisory", reason: "Naming only.", line: null }], limitations: [] })
      }, { publish: false })
      expect([result.review.verdict, result.review.outcome.kind === "complete" && result.review.outcome.findings.map((f) => `${f.id}:${f.severity}`)]).toEqual([
        "PASS",
        ["b1.gate.design#1:advisory"]
      ])
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

describe("blocker threads", () => {
  const blocking = (title = "Export runs twice"): Record<string, Script> => ({
    ...gated,
    "gate.design": () => reviewOut([finding("design", "blocker", title)])
  })
  const onDiff = () => fakeForge({ head: sha("a"), changes: [addedFile("src/app.ts")] })
  const report = (forge: ReturnType<typeof fakeForge>) => [...forge.state.notes.values()].find((b) => parseMarker(b) !== null)!
  const threadKinds = (result: { threads: { results: ReadonlyArray<{ action: { kind: string }; failure: string | null }> } }) =>
    result.threads.results.map((r) => r.failure === null ? r.action.kind : `${r.action.kind} failed: ${r.failure}`)

  it.effect("opens a thread on a blocker's diff line, and none for an advisory or a blocker off the diff", () =>
    Effect.gen(function*() {
      const forge = fakeForge({ head: sha("a"), changes: [addedFile("src/app.ts"), change("src/lib.ts")] })
      const result = yield* run(forge, {
        ...gated,
        "gate.design": () => reviewOut([finding("design", "blocker", "Export runs twice"), { ...finding("design", "blocker", "Off the diff"), location: { path: "src/lib.ts", line: 3 } }])
      })
      expect(forge.state.threads.map((t) => [t.anchor, t.head, t.body.split("\n")[1]])).toEqual([[
        { oldPath: "src/app.ts", newPath: "src/app.ts", newLine: 3, oldLine: null },
        sha("a"),
        "**Heron blocker** `design` Export runs twice ([src\\/\u2060app\\.\u2060ts\\:\u20603](https://gitlab.example.com/group/app/-/blob/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/src/app.ts#L3))"
      ]])
      expect(threadKinds(result)).toEqual(["create"])
      expect(report(forge)).toContain("\n\nBlocker threads on the diff: 1 opened.\n\n")
      expect(report(forge)).toContain("Off the diff")
    }))

  it.effect("updates the same thread at a new head, resolves it with a reply once the blocker is gone, and then does nothing", () =>
    Effect.gen(function*() {
      const forge = onDiff()
      yield* run(forge, blocking())
      forge.state.head = sha("c")
      const updated = yield* run(forge, blocking("export runs TWICE"))
      expect([threadKinds(updated), forge.state.threads.length, forge.state.threads[0]!.body]).toEqual([
        ["update"],
        1,
        expect.stringContaining("Kept by the review of `cccccccc`.")
      ])
      forge.state.head = sha("e")
      const fixed = yield* run(forge, gated)
      expect([threadKinds(fixed), forge.state.threads[0]!.replies, forge.state.threads[0]!.resolved]).toEqual([["resolve"], ["No longer a blocker at `eeeeeeee`.\n"], true])
      expect(report(forge)).toContain("Blocker threads on the diff: 1 resolved.")
      const again = yield* run(forge, gated)
      expect([threadKinds(again), forge.state.threads[0]!.replies.length, report(forge).includes("Blocker threads")]).toEqual([[], 1, false])
    }))

  it.effect("reopens a thread a person resolved when the blocker is back, and writes nothing more at the same head", () =>
    Effect.gen(function*() {
      const forge = onDiff()
      yield* run(forge, blocking())
      forge.state.threads[0]!.resolved = true
      const body = forge.state.threads[0]!.body
      const result = yield* run(forge, blocking())
      expect([threadKinds(result), forge.state.threads[0]!.resolved, forge.state.threads[0]!.body]).toEqual([["reopen"], false, body])
      expect(threadKinds(yield* run(forge, blocking()))).toEqual([])
    }))

  it.effect("never touches a discussion another user started, even one that copies Heron's fingerprint", () =>
    Effect.gen(function*() {
      const forge = onDiff()
      yield* run(forge, blocking())
      const copy = { ...forge.state.threads[0]!, id: "e1" as DiscussionId, note: 900 as NoteId, byBot: false, replies: [] }
      forge.state.threads = [copy]
      const result = yield* run(forge, gated)
      expect([threadKinds(result), copy.resolved, copy.replies]).toEqual([[], false, []])
    }))

  it.effect("leaves threads alone on a BLOCKED and a SUPERSEDED review", () =>
    Effect.gen(function*() {
      const forge = onDiff()
      yield* run(forge, blocking())
      const blocked = yield* run(forge, { ...gated, "gate.design": () => new HarnessError({ kind: "quota", detail: "limit reached" }) })
      const superseded = yield* run(forge, gated, {
        onRun: (r) => {
          if (r.slot.role === "supervisor") forge.state.head = sha("c")
        }
      })
      expect([blocked.review.verdict, threadKinds(blocked), superseded.review.verdict, threadKinds(superseded)]).toEqual(["BLOCKED", [], "SUPERSEDED", []])
      expect([forge.state.threads.length, forge.state.threads[0]!.resolved, forge.state.threads[0]!.replies]).toEqual([1, false, []])
    }))

  it.effect("plans the thread actions on a dry run and writes none", () =>
    Effect.gen(function*() {
      const forge = onDiff()
      yield* run(forge, blocking("Export runs twice"))
      const result = yield* run(forge, blocking("Button stays enabled"), { publish: false })
      expect([result.note, threadKinds(result), forge.state.threads.length, forge.state.threads[0]!.resolved]).toEqual([
        { kind: "dry-run" },
        ["create", "resolve"],
        1,
        false
      ])
      expect(result.body).toContain("Blocker threads on the diff: 1 opened, 1 resolved.")
    }))

  it.effect("publishes the note and the labels when a thread write fails, and says so in the note", () =>
    Effect.gen(function*() {
      const forge = onDiff()
      forge.state.failing.add("createThread")
      const result = yield* run(forge, blocking())
      expect([threadKinds(result), result.note, forge.state.labels]).toEqual([
        ["create failed: createThread: HTTP 500"],
        { kind: "created", note: 100 },
        ["review::changes requested"]
      ])
      expect(report(forge)).toContain("Blocker threads on the diff: 1 failed, to be retried by the next review.")
      forge.state.failing = new Set(["findThreads"])
      const unlisted = yield* run(forge, blocking())
      expect([unlisted.threads, unlisted.note]).toEqual([{ results: [], unlisted: "findThreads: HTTP 500" }, { kind: "updated", note: 100 }])
      forge.state.failing.clear()
      expect(threadKinds(yield* run(forge, blocking()))).toEqual(["create"])
    }))

  /** A blocker at line 3 of `src/app.ts` reviewed at `a`, then a push to `c` whose delta changes that file with `diff`. */
  const carriedThrough = (diff: string) =>
    Effect.gen(function*() {
      const forge = yield* reviewedThenPushed(blocking(), [addedFile("src/app.ts")])
      forge.state.changes = [addedFile("src/app.ts", 7)]
      forge.state.delta = () => [{ path: "src/app.ts", oldPath: null, status: "modified", diff }]
      return forge
    })
  const carriedLocation = ({ review: { outcome } }: { review: Review }) =>
    outcome.kind === "complete" ? outcome.findings.filter((f) => `${f.id}` === "earlier#1").map((f) => f.location) : []

  it.effect("moves a carried blocker's line to the reviewed head, in the prompt, the note and its thread", () =>
    Effect.gen(function*() {
      const forge = yield* carriedThrough("@@ -0,0 +1,2 @@\n+import a\n+import b")
      const seen: Array<HarnessRequest> = []
      const result = yield* run(forge, gated, { onRun: (r) => seen.push(r) })
      expect(promptsOf(seen, "supervisor")[0]).toContain(`"location": {\n      "path": "src/app.ts",\n      "line": 5\n    }`)
      expect(carriedLocation(result)).toEqual([{ path: "src/app.ts", line: 5 }])
      expect([threadKinds(result), forge.state.threads[0]!.body.includes(`/src/app.ts#L5))`), report(forge).includes(`/src/app.ts#L5))`)]).toEqual([
        ["update"],
        true,
        true
      ])
    }))

  it.effect("lets the ruling session place a carried blocker whose line was rewritten, and shows it without a line until then", () =>
    Effect.gen(function*() {
      const rewrite = "@@ -3 +3 @@\n-line 3\n+line three"
      const unplaced = yield* run(yield* carriedThrough(rewrite), gated)
      expect(carriedLocation(unplaced)).toEqual([{ path: "src/app.ts", line: null }])
      expect(unplaced.body).toContain("(https://gitlab.example.com/group/app/-/blob/cccccccccccccccccccccccccccccccccccccccc/src/app.ts), on a line the newer commits changed)")
      const forge = yield* carriedThrough(rewrite)
      const placed = yield* run(forge, {
        ...gated,
        "supervisor": (r) => ({
          summary: "Still there.",
          decisions: promptIds(r).map((id) => ({ id, ruling: "keep", reason: "real", line: id === "earlier#1" ? 4 : null })),
          added: [],
          limitations: []
        })
      })
      expect([carriedLocation(placed), forge.state.threads[0]!.body.includes("/src/app.ts#L4))")]).toEqual([[{ path: "src/app.ts", line: 4 }], true])
      expect(parsePrior(report(forge))?.findings.find((f) => f.title === "Export runs twice")?.location).toEqual({ path: "src/app.ts", line: 4 })
    }))

  it.effect("keeps the thread of a blocker a re-review carries", () =>
    Effect.gen(function*() {
      const forge = yield* reviewedThenPushed(blocking(), [addedFile("src/app.ts")])
      const result = yield* run(forge, gated)
      expect(result.review.rereview?.from).toBe(sha("a"))
      expect(result.review.outcome.kind === "complete" && result.review.outcome.findings.map((f) => f.id)).toEqual(["gate.correctness#1", "earlier#1", "earlier#2"])
      expect([threadKinds(result), forge.state.threads.length, forge.state.threads[0]!.body]).toEqual([
        ["update"],
        1,
        expect.stringContaining("Kept by the review of `cccccccc`.")
      ])
    }))
})
