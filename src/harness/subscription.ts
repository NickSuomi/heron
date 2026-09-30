import { Duration, Effect } from "effect"
import type { LimitReading, LimitWindow } from "../domain.ts"

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

/** Why a response carried no windows: its status and the error message Anthropic gave, without the token. */
const refusal = async (response: Response, token: string): Promise<string> => {
  const text = await response.text().catch(() => "")
  let message = text
  try {
    const body: unknown = JSON.parse(text)
    const error = isRecord(body) && isRecord(body["error"]) ? body["error"]["message"] : undefined
    if (typeof error === "string") message = error
  } catch {
    // Not JSON: keep the text.
  }
  const clean = message.split(token).join("[redacted]").replace(/\s+/g, " ").trim().slice(0, 200)
  return `HTTP ${response.status}${clean === "" ? "" : `: ${clean}`}`
}

export const readSubscription = (token: string, fetchUsage: typeof fetch = fetch): Effect.Effect<LimitReading> =>
  Effect.tryPromise({
    try: async (signal): Promise<LimitReading> => {
      const response = await fetchUsage(USAGE_URL, {
        headers: { authorization: `Bearer ${token}`, "anthropic-beta": "oauth-2025-04-20", accept: "application/json" },
        signal
      })
      if (!response.ok) return { failure: await refusal(response, token) }
      return parseUsage(await response.json().catch(() => null)) ?? { failure: "the response had no usage windows" }
    },
    catch: (e): LimitReading => ({ failure: e instanceof Error ? e.message.split(token).join("[redacted]") : "the request failed" })
  }).pipe(
    Effect.timeoutOrElse({ duration: Duration.seconds(30), orElse: () => Effect.succeed<LimitReading>({ failure: "no answer within 30 s" }) }),
    Effect.catch((reading) => Effect.succeed(reading))
  )
