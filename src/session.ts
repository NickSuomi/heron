import { Effect } from "effect"
import type { FallbackCause } from "./domain.ts"
import { HarnessError, type HarnessRequest } from "./ports.ts"

export const runSession = <A, E, R>(
  request: HarnessRequest,
  attempt: (actual: HarnessRequest, fallback?: FallbackCause) => Effect.Effect<A, E, R>
): Effect.Effect<A, E | HarnessError, R> => {
  const { fallback, name, harness } = request.slot.profile
  const first = attempt(request)
  if (fallback === undefined) return first
  return first.pipe(Effect.catchIf(
    (error): error is E & HarnessError & { readonly kind: FallbackCause["kind"] } =>
      error instanceof HarnessError && (error.kind === "auth" || error.kind === "quota" || error.kind === "vendor"),
    (error) => attempt({ ...request, slot: { ...request.slot, profile: fallback } }, {
      profile: name,
      kind: error.kind,
      detail: error.detail
    }).pipe(Effect.mapError((second) =>
      // Without the primary's failure, a failed fallback reads as if the primary never ran.
      second instanceof HarnessError
        ? new HarnessError({
          kind: second.kind,
          detail: `${second.detail}. Before this fallback, profile ${name} on harness ${harness} failed with ${error.message}`,
          ...(second.accounting === undefined ? {} : { accounting: second.accounting })
        })
        : second
    ))
  ))
}
