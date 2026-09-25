import { describe, expect, it } from "@effect/vitest"
import { Effect, Layer } from "effect"
import type { UserId } from "../src/domain.ts"
import { HarnessError, type HarnessRequest } from "../src/ports.ts"
import { parseMarker } from "../src/report.ts"
import { reviewOnce } from "../src/review.ts"
import { change, configOf, fakeForge, fakeHarness, finding, keepAll, reviewOut, type Script, sha } from "./fakes.ts"

const config = configOf()
const ref = { project: "group/app", iid: 7 }
const trigger = 2001 as UserId

const run = (
  forge: ReturnType<typeof fakeForge>,
  answers: Record<string, Script>,
  options: { publish?: boolean; triggeredBy?: UserId | null; onRun?: (r: HarnessRequest) => void } = {}
) =>
  reviewOnce(config, { ref, triggeredBy: options.triggeredBy === undefined ? trigger : options.triggeredBy, publish: options.publish ?? true }).pipe(
    Effect.provide(Layer.mergeAll(forge.layer, fakeHarness(answers, options.onRun ? { onRun: options.onRun } : {}).layer))
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

  it.effect("gives the judge no repository access and the other sessions the checkout", () =>
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
      expect(seen.map((r) => `${r.slot.id}:${r.source?.commit === sha("a") ? "source" : "none"}`).sort()).toEqual([
        "b1.gate.correctness:source",
        "b1.gate.design:source",
        "b1.supervisor:source",
        "b2.gate.correctness:source",
        "b2.gate.design:source",
        "b2.supervisor:source",
        "judge:none"
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
      expect([failing.review.verdict, failing.body.includes("session `reviewer` failed. quota: limit reached")]).toEqual(["BLOCKED", true])
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
      expect(lines.slice(at + 2, at + 5)).toEqual([
        "| Session | Role | Backend | Model | Effort | Tokens in / out | Tool calls | Duration | Vendor cost | Result |",
        "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
        "| reviewer | reviewer | alpha | model-q | low | n/a / n/a | n/a | 0.0 s | n/a | quota |"
      ])
    }))

  it.effect("publishes nothing and leaves labels alone on a dry run", () =>
    Effect.gen(function*() {
      const forge = fakeForge({ head: sha("a"), changes: [change("src/app.ts")], labels: ["x"] })
      const result = yield* run(forge, gated, { publish: false })
      expect([result.note, result.review.verdict, forge.state.notes.size, forge.state.labels]).toEqual([{ kind: "dry-run" }, "PASS", 0, ["x"]])
      expect(result.body.split("\n").slice(1, 4)).toEqual(["## Heron review: PASS", "", "Reviewed head `aaaaaaaa` in lane `standard`."])
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

describe("report rendering", () => {
  it.effect("makes model-written text inert: no quick action, hidden HTML, or mention survives", () =>
    Effect.gen(function*() {
      const hostile = {
        gate: "design",
        severity: "advisory",
        location: { path: "src/a`b.ts", line: 3 },
        title: "/approve",
        body: "  /merge\n- /unlabel ~x\n> /close\n<!-- hidden\n<details>\n@all\nsee #12, !34 and ![p](https://x.test/a.png)",
      }
      const result = yield* run(fakeForge({ head: sha("a"), changes: [change("src/app.ts")] }), {
        "gate.design": () => reviewOut([hostile]),
        "gate.correctness": () => reviewOut(),
        "supervisor": keepAll({ summary: "/merge now @all", added: [], limitations: ["/label ~x"] })
      }, { publish: false })
      const lines = result.body.split("\n")
      const at = lines.indexOf("### Findings")
      expect(lines.slice(at - 2, at + 17)).toEqual([
        "\\/merge now @⁠all",
        "",
        "### Findings",
        "",
        "- **Advisory** `design` \\/approve ([``src/a`b.ts:3``](https://gitlab.example.com/group/app/-/blob/" + sha("a") + "/src/a%60b.ts#L3))",
        "",
        "    \\/merge",
        "  - \\/unlabel ~⁠x",
        "  > \\/close",
        "  &lt;!-- hidden",
        "  &lt;details>",
        "  @⁠all",
        "  see #⁠12, !⁠34 and !⁠[p](https://x.test/a.png)",
        "",
        "### Not checked",
        "",
        "- \\/label ~⁠x",
        "",
        "<details>"
      ])
    }))
})
