import { Duration, Effect } from "effect"
import type { LimitWindow } from "../domain.ts"

/**
 * The plan-usage endpoint Claude Code's own `/usage` reads. Anthropic does not document it, so a reading is best effort:
 * any failure, including a timeout, is a missing reading, never a failed review.
 */
const USAGE_URL = "https://api.anthropic.com/api/oauth/usage"

const windows = [["five_hour", "five-hour"], ["seven_day", "weekly"]] as const

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null

/** The five-hour and weekly windows of a usage response, or null when it carries neither. */
export const parseUsage = (body: unknown): ReadonlyArray<LimitWindow> | null => {
  if (!isRecord(body)) return null
  const found = windows.flatMap(([key, window]): ReadonlyArray<LimitWindow> => {
    const w = body[key]
    if (!isRecord(w) || typeof w["utilization"] !== "number" || !Number.isFinite(w["utilization"])) return []
    return [{ window, percent: w["utilization"], resetsAt: typeof w["resets_at"] === "string" ? w["resets_at"] : null }]
  })
  return found.length === 0 ? null : found
}

export const readSubscription = (token: string, fetchUsage: typeof fetch = fetch): Effect.Effect<ReadonlyArray<LimitWindow> | null> =>
  Effect.tryPromise({
    try: async (signal) => {
      const response = await fetchUsage(USAGE_URL, {
        headers: { authorization: `Bearer ${token}`, "anthropic-beta": "oauth-2025-04-20", accept: "application/json" },
        signal
      })
      return response.ok ? parseUsage(await response.json()) : null
    },
    catch: () => null
  }).pipe(
    Effect.timeoutOrElse({ duration: Duration.seconds(30), orElse: () => Effect.succeed(null) }),
    Effect.orElseSucceed(() => null)
  )
