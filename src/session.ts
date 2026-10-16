import { Effect } from "effect"
import type { FallbackCause } from "./domain.ts"
import { HarnessError, type HarnessRequest } from "./ports.ts"

export const runSession = <A, E, R>(
  request: HarnessRequest,
  attempt: (actual: HarnessRequest, fallback?: FallbackCause) => Effect.Effect<A, E, R>
): Effect.Effect<A, E, R> => {
  const fallback = request.slot.profile.fallback
  const first = attempt(request)
  if (fallback === undefined) return first
  return first.pipe(Effect.catchIf(
    (error): error is E & HarnessError & { readonly kind: FallbackCause["kind"] } =>
      error instanceof HarnessError && (error.kind === "auth" || error.kind === "quota" || error.kind === "vendor"),
    (error) => attempt({ ...request, slot: { ...request.slot, profile: fallback } }, {
      profile: request.slot.profile.name,
      kind: error.kind,
      detail: error.detail
    })
  ))
}
