import { Option } from "effect"
import { describe, expect, it } from "vitest"

import * as Cmd from "./apps/cmd"
import { mergeRequestUrl } from "./apps/gitlabRoutes"
import * as Welcome from "./apps/welcome"
import * as Desk from "./domain/window"
import { Message } from "./message"
import type { Model } from "./model"
import { tourCommand } from "./tourHooks"
import { init, update } from "./update"

// Drives the tour through `update` the way the runtime does, with the clock and the Command Prompt's typing
// delivered as the Messages their Commands and subscriptions would send.

const t0 = 1_000_000

const send = (model: Model, ...messages: ReadonlyArray<Message>): Model => messages.reduce((next, message) => update(next, message).model, model)

const desktop = (): Model =>
  send(init({ viewport: { width: 1440, height: 900 }, now: t0, glass: "Css", isWelcomeAtStartup: true }).model, Message.SkippedBoot())

const focused = (model: Model): Desk.Window => {
  const win = Option.flatMap(model.desk.maybeFocused, (id) => Desk.find(model.desk, id))
  if (Option.isNone(win)) throw new Error("no focused window")
  return win.value
}

const takeTheTour = (model: Model): Model =>
  send(model, Message.GotWelcomeMessage({ windowId: focused(model).id, message: Welcome.Message.ClickedTour() }))

const typeOut = (model: Model): Model => {
  const windowId = focused(model).id
  return Array.from({ length: tourCommand.length + 1 }).reduce<Model>(
    (next) => send(next, Message.GotCmdMessage({ windowId, message: Cmd.Message.TypedKey() })),
    model,
  )
}

/** Ticks the review clock until the current run ends. */
const finishRun = (model: Model, from: number): Model =>
  send(model, Message.TickedReview({ now: from }), Message.TickedReview({ now: from + 60_000 }))

describe("the tour", () => {
  it("types the dry-run command into the Command Prompt and runs it", () => {
    const started = takeTheTour(desktop())
    const cmd = focused(started)
    expect(cmd.app._tag).toBe("Cmd")
    const typed = typeOut(started)
    const app = focused(typed).app
    expect(app._tag === "Cmd" && app.entries.some((entry) => entry._tag === "Lines" && entry.lines.includes(`C:\\Users\\Visitor>${tourCommand}`))).toBe(true)
    expect(typed.review._tag === "Running" && typed.review.delivery).toBe("DryRun")
  })

  it("keeps going after the approval prompt a finished review opens", () => {
    const done = finishRun(typeOut(takeTheTour(desktop())), t0)
    expect(done.uac._tag).toBe("Asking")
    const closed = send(done, Message.ClickedUacCancel(), Message.ClickedUacClose())
    expect(closed.uac._tag).toBe("Hidden")
    expect(closed.tour).toEqual({ _tag: "On", step: 0 })

    const findings = send(closed, Message.ClickedTourNext())
    const studio = focused(findings).app
    expect(studio._tag === "Studio" && [studio.maybeActive, studio.panel]).toEqual([Option.some("/Desktop/merge-request-42.diff"), "ErrorList"])

    const note = send(findings, Message.ClickedTourNext())
    const browser = focused(note).app
    expect(browser._tag === "Browser" && browser.tabs[0]?.history.at(-1)).toBe(mergeRequestUrl)
    expect(note.forge.maybeUser).toEqual(Option.some("visitor"))
    expect(note.review._tag === "Running" && note.review.delivery).toBe("Post")

    const posted = finishRun(note, t0 + 120_000)
    expect(Option.isSome(posted.forge.maybeNote)).toBe(true)
    expect(send(posted, Message.ClickedUacCancel(), Message.ClickedUacClose(), Message.ClickedTourNext()).tour).toEqual({ _tag: "Off" })
  })

  it("starts a dry run in the editor when the visitor skips the Command Prompt", () => {
    const findings = send(takeTheTour(desktop()), Message.ClickedTourNext())
    const studio = focused(findings).app
    expect(findings.review._tag === "Running" && findings.review.delivery).toBe("DryRun")
    expect(studio._tag === "Studio" && studio.panel).toBe("Output")
    const done = finishRun(findings, t0)
    const settled = Desk.find(done.desk, focused(findings).id)
    expect(Option.map(settled, (win) => win.app._tag === "Studio" && win.app.panel)).toEqual(Option.some("ErrorList"))
  })

  it("posts the note once a dry run still going on the Note step ends", () => {
    const note = send(typeOut(takeTheTour(desktop())), Message.ClickedTourNext(), Message.ClickedTourNext())
    expect(note.review._tag === "Running" && note.review.delivery).toBe("DryRun")
    const afterDryRun = finishRun(note, t0)
    expect(afterDryRun.review._tag === "Running" && afterDryRun.review.delivery).toBe("Post")
    expect(Option.isSome(finishRun(afterDryRun, t0 + 120_000).forge.maybeNote)).toBe(true)
  })
})
