import { Option } from "effect"
import { describe, expect, it } from "vitest"

import { Message } from "./message"
import * as Desk from "./domain/window"
import type { Model } from "./model"
import { init, update } from "./update"

// Which window the keyboard reaches: every change of the focused window asks the runtime to move DOM focus into it.

const send = (model: Model, ...messages: ReadonlyArray<Message>): Model => messages.reduce((next, message) => update(next, message).model, model)

const desktop = (): Model => send(init({ viewport: { width: 1440, height: 900 }, now: 0, glass: "Css", isWelcomeAtStartup: false }).model, Message.SkippedBoot())

const focusRequests = (model: Model, message: Message) =>
  (update(model, message).commands ?? []).filter((command) => command.name === "FocusWindow").map((command) => command.args)

const focusedId = (model: Model): Desk.WindowId => Option.getOrThrow(model.desk.maybeFocused)

describe("keyboard focus", () => {
  it("moves into a window that opens, one the switcher picks, and one a taskbar button raises", () => {
    const withCmd = send(desktop(), Message.ClickedStartApp({ app: "cmd" }))
    expect(focusRequests(withCmd, Message.ClickedStartApp({ app: "notepad" }))).toEqual([{ windowId: 2 }])
    const both = send(withCmd, Message.ClickedStartApp({ app: "notepad" }))
    const switching = send(both, Message.PressedSwitchWindow({ isBackward: false }))
    expect(focusRequests(switching, Message.ReleasedAlt())).toEqual([{ windowId: focusedId(withCmd) }])
    expect(focusRequests(both, Message.ClickedTaskbarButton({ windowId: focusedId(withCmd) }))).toEqual([{ windowId: focusedId(withCmd) }])
  })

  it("leaves focus alone when the focused window stays the same", () => {
    const withCmd = send(desktop(), Message.ClickedStartApp({ app: "cmd" }))
    expect(focusRequests(withCmd, Message.PressedWindow({ windowId: focusedId(withCmd) }))).toEqual([])
  })
})
