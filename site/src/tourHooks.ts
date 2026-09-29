import type { Update } from "foldkit"

import * as Browser from "./apps/browser"
import * as Cmd from "./apps/cmd"
import * as Studio from "./apps/studio"
import { mergeRequestUrl } from "./apps/gitlabRoutes"
import * as Review from "./domain/review"
import { FilePath } from "./domain/vfs"
import type { WindowId } from "./domain/window"
import { Message } from "./message"
import type { Model } from "./model"
import type { TourStepId } from "./tour"

type UpdateReturn = Update.Return<Model, Message>

/** Runs one Message through the shell's update, so a hook drives an app exactly as a visitor's input would. */
export type Send = (model: Model, message: Message) => UpdateReturn

/**
 * What a tour step does once its app's window is open and focused. `windowId` is that window.
 * A hook returns the next Model and any Commands, exactly like a branch of `update`.
 */
export type TourHook = (model: Model, windowId: WindowId, send: Send) => UpdateReturn

const sendAll = (model: Model, messages: ReadonlyArray<Message>, send: Send): UpdateReturn =>
  messages.reduce<UpdateReturn>(
    (sent, message) => {
      const next = send(sent.model, message)
      return { model: next.model, commands: [...(sent.commands ?? []), ...(next.commands ?? [])] }
    },
    { model },
  )

export const tourCommand = `heron review --mr ${Review.exampleMergeRequestIid} --dry-run`

export const diffPath = FilePath.make("/Desktop/merge-request-42.diff")

/** Types the dry-run command into the Command Prompt and presses Enter, unless a review is already running. */
const dryRun: TourHook = (model, windowId, send) =>
  model.review._tag === "Running"
    ? { model }
    : send(model, Message.GotCmdMessage({ windowId, message: Cmd.Message.StartedTyping({ text: tourCommand }) }))

/**
 * Shows the diff and the findings. A finished review brings the Error List forward; a running one shows its Output
 * until it ends; with no review yet, the editor runs a dry run.
 */
const findings: TourHook = (model, windowId, send) => {
  const studio = (message: Studio.Message) => Message.GotStudioMessage({ windowId, message })
  const opened = studio(Studio.Message.ClickedFile({ path: diffPath }))
  return Review.Review.match(model.review, {
    Idle: () => sendAll(model, [opened, studio(Studio.Message.ClickedRun({ delivery: "DryRun" }))], send),
    Running: () => sendAll(model, [opened, studio(Studio.Message.ClickedPanel({ panel: "Output" }))], send),
    Done: () => sendAll(model, [opened, studio(Studio.Message.ClickedPanel({ panel: "ErrorList" }))], send),
  })
}

/**
 * Signs in to the mock GitLab as the visitor if needed and opens !42. If no posted review has written the note yet,
 * a posted run starts now, or, when a dry run is still going, as soon as it ends (see `update`).
 */
const note: TourHook = (model, windowId, send) => {
  const browser = (message: Browser.Message) => Message.GotBrowserMessage({ windowId, message })
  const shown = sendAll(
    model,
    model.forge.maybeUser._tag === "Some"
      ? [browser(Browser.Message.ClickedLink({ url: mergeRequestUrl }))]
      : [browser(Browser.Message.TypedUsername({ value: "visitor" })), browser(Browser.Message.SubmittedSignIn())],
    send,
  )
  return isNoteDue(shown.model) ? { ...shown, model: { ...shown.model, review: Review.start(shown.model.review, "Post") } } : shown
}

/** The Note step needs a posted note; a new posted run can start once no review is running. */
export const isNoteDue = (model: Model): boolean => model.review._tag !== "Running" && !Review.isReportNotePosted(model.review)

export const tourHooks: Readonly<Record<TourStepId, TourHook>> = {
  DryRun: dryRun,
  Findings: findings,
  Note: note,
}
