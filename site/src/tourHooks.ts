import type { Update } from "foldkit"

import type { WindowId } from "./domain/window"
import type { Message } from "./message"
import type { Model } from "./model"
import type { TourStepId } from "./tour"

/**
 * What a tour step does once its app's window is open and focused. `windowId` is that window.
 * A hook returns the next Model and any Commands, exactly like a branch of `update`.
 *
 * WIRING (controller, at the merge of units 2a and 2b): replace each body below.
 * - DryRun, unit 2a: type `heron review --mr 42 --dry-run` into the Command Prompt in `windowId` and
 *   run it, so the shared review starts in DryRun delivery.
 * - Findings, unit 2a: show the review's findings in the editor in `windowId` (the tour opened it on
 *   /Desktop/merge-request-42.diff): squiggles, hover text and the Problems panel.
 * - Note, unit 2b: navigate the browser in `windowId` to acme/storefront !42 with the posted report
 *   note and the verdict label. If no review has posted yet, run one with Post delivery first.
 */
export type TourHook = (model: Model, windowId: WindowId) => Update.Return<Model, Message>

const opensOnly: TourHook = (model) => ({ model })

export const tourHooks: Readonly<Record<TourStepId, TourHook>> = {
  DryRun: opensOnly,
  Findings: opensOnly,
  Note: opensOnly,
}
