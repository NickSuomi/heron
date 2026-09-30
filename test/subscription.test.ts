import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { parseUsage, readSubscription } from "../src/harness/subscription.ts"

const body = {
  five_hour: { utilization: 25.0, resets_at: "2026-09-30T01:49:59+00:00" },
  seven_day: { utilization: 38.0, resets_at: "2026-10-03T11:59:59+00:00" },
  extra_usage: { utilization: null, resets_at: null }
}

const replying = (response: Response | Error): typeof fetch => (async () => {
  if (response instanceof Error) throw response
  return response
}) as typeof fetch

describe("the subscription reading", () => {
  it("takes the five-hour and weekly windows from a usage response and ignores the rest", () => {
    expect(parseUsage(body)).toEqual([
      { window: "five-hour", percent: 25, resetsAt: "2026-09-30T01:49:59+00:00" },
      { window: "weekly", percent: 38, resetsAt: "2026-10-03T11:59:59+00:00" }
    ])
    expect([parseUsage({ five_hour: { utilization: "25" } }), parseUsage(null), parseUsage([])]).toEqual([null, null, null])
  })

  it.effect("sends the token to the usage endpoint and returns the windows", () =>
    Effect.gen(function*() {
      const sent: Array<[string, RequestInit | undefined]> = []
      const fetchUsage = (async (url: string, init?: RequestInit) => {
        sent.push([url, init])
        return new Response(JSON.stringify(body), { status: 200 })
      }) as typeof fetch
      const windows = yield* readSubscription("sk-ant-oat-test", fetchUsage)
      expect("failure" in windows ? windows : windows.map((w) => w.percent)).toEqual([25, 38])
      expect([sent[0]![0], (sent[0]![1]?.headers as Record<string, string>)["authorization"]]).toEqual([
        "https://api.anthropic.com/api/oauth/usage",
        "Bearer sk-ant-oat-test"
      ])
    }))

  it.effect("says why, never failing the review, when the endpoint refuses, breaks or answers nonsense", () =>
    Effect.gen(function*() {
      const token = "sk-ant-oat-secret"
      const refused = new Response(JSON.stringify({ error: { type: "permission_error", message: `scope user:profile is required for ${token}` } }), { status: 403 })
      const results = yield* Effect.all([
        readSubscription(token, replying(refused)),
        readSubscription(token, replying(new Response("rate limited", { status: 429 }))),
        readSubscription(token, replying(new Error("network down"))),
        readSubscription(token, replying(new Response("not json", { status: 200 })))
      ])
      expect(results).toEqual([
        { failure: "HTTP 403: scope user:profile is required for [redacted]" },
        { failure: "HTTP 429: rate limited" },
        { failure: "network down" },
        { failure: "the response had no usage windows" }
      ])
    }))
})
