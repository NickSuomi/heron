import { Match, Option } from "effect"
import type { Html, HtmlBuilder } from "foldkit/html"

import * as Cmd from "../apps/cmd"
import * as Notepad from "../apps/notepad"
import { appIdOf, definition, iconOf, titleOf } from "../apps/registry"
import * as Studio from "../apps/studio"
import * as Stub from "../apps/stub"
import { edges } from "../domain/geometry"
import * as Desk from "../domain/window"
import { Message } from "../message"
import { isPhone, type Model } from "../model"
import { GlassSurface } from "./glass"
import { iconUrl } from "./icons"

const px = (value: number): string => `${Math.round(value)}px`

export const appView = (model: Model, win: Desk.Window, h: HtmlBuilder<Message>): Html =>
  Match.value(win.app).pipe(
    Match.tagsExhaustive({
      Notepad: (notepad) =>
        h.submodel({
          slotId: `notepad-${win.id}`,
          model: notepad,
          view: Notepad.view,
          toParentMessage: (message) => Message.GotNotepadMessage({ windowId: win.id, message }),
        }),
      Cmd: (cmd) =>
        h.submodel({
          slotId: `cmd-${win.id}`,
          model: cmd,
          view: Cmd.view,
          viewInputs: { review: model.review, inputId: Cmd.inputIdFor(win.id) },
          toParentMessage: (message) => Message.GotCmdMessage({ windowId: win.id, message }),
        }),
      Studio: (studio) =>
        h.submodel({
          slotId: `studio-${win.id}`,
          model: studio,
          view: Studio.view,
          viewInputs: { review: model.review, windowId: win.id, isPhone: isPhone(model) },
          toParentMessage: (message) => Message.GotStudioMessage({ windowId: win.id, message }),
        }),
      Stub: (stub) => Stub.view(h, definition(stub.app).name, stub),
    }),
  )

/** The glass layer behind a frame: Canvas UI Glass when the browser has HTML-in-canvas, CSS otherwise. */
export const glassLayer = (model: Model, h: HtmlBuilder<Message>, corner: number): Html =>
  model.glass === "Native"
    ? h.div([h.Class("glass-native"), h.DataAttribute("glass-corner", String(corner)), h.OnMount(GlassSurface())])
    : h.empty

const captionButtons = (win: Desk.Window, h: HtmlBuilder<Message>): Html =>
  h.div(
    [h.Class("caption-buttons")],
    [
      h.button(
        [h.Class("caption caption-min"), h.AriaLabel("Minimize"), h.Title("Minimize"), h.OnClick(Message.ClickedMinimise({ windowId: win.id }))],
        [h.span([h.Class("glyph")])],
      ),
      h.button(
        [
          h.Class(`caption caption-max${win.display === "Maximised" ? " is-restore" : ""}`),
          h.AriaLabel(win.display === "Maximised" ? "Restore Down" : "Maximize"),
          h.Title(win.display === "Maximised" ? "Restore Down" : "Maximize"),
          h.OnClick(Message.ClickedMaximise({ windowId: win.id })),
        ],
        [h.span([h.Class("glyph")])],
      ),
      h.button(
        [h.Class("caption caption-close"), h.AriaLabel("Close"), h.Title("Close"), h.OnClick(Message.ClickedClose({ windowId: win.id }))],
        [h.span([h.Class("glyph")])],
      ),
    ],
  )

const resizeHandles = (win: Desk.Window, h: HtmlBuilder<Message>): ReadonlyArray<Html> =>
  win.display === "Maximised"
    ? []
    : edges.map((edge) =>
        h.div([
          h.Class(`resize resize-${edge.toLowerCase()}`),
          h.AriaHidden(true),
          h.OnPointerDown((_type, button, _sx, _sy, _t, x, y) =>
            button === 0 ? Option.some(Message.PressedResizeHandle({ windowId: win.id, edge, x, y })) : Option.none(),
          ),
        ]),
      )

export const windowView = (model: Model, win: Desk.Window, zIndex: number, h: HtmlBuilder<Message>): Html => {
  const isActive = Desk.isFocused(model.desk, win.id)
  const isMaximised = win.display === "Maximised"
  const title = titleOf(win.app)
  return h.keyed("section")(
    `window-${win.id}`,
    [
      h.Class(
        ["window", `app-${appIdOf(win.app)}`, isActive ? "is-active" : "is-inactive", isMaximised ? "is-maximised" : "", win.isMinimised ? "is-minimised" : ""]
          .filter(Boolean)
          .join(" "),
      ),
      h.DataAttribute("glass-root", ""),
      h.Role("dialog"),
      h.AriaLabel(title),
      h.Style(
        isMaximised
          ? { left: "0px", top: "0px", width: "100%", height: "100%", "z-index": String(zIndex) }
          : { left: px(win.bounds.x), top: px(win.bounds.y), width: px(win.bounds.width), height: px(win.bounds.height), "z-index": String(zIndex) },
      ),
      h.OnPointerDown(() => Option.some(Message.PressedWindow({ windowId: win.id }))),
    ],
    [
      glassLayer(model, h, isMaximised ? 0 : 7),
      h.div([h.Class("frame-sheen"), h.AriaHidden(true)]),
      h.div(
        [
          h.Class("titlebar"),
          h.OnPointerDown((_type, button, _sx, _sy, _t, x, y) =>
            button === 0 ? Option.some(Message.PressedTitleBar({ windowId: win.id, x, y })) : Option.none(),
          ),
          h.OnDoubleClick(Message.DoubleClickedTitleBar({ windowId: win.id })),
        ],
        [h.img([h.Class("title-icon"), h.Src(iconUrl(iconOf(win.app))), h.Alt("")]), h.span([h.Class("title-text")], [title])],
      ),
      captionButtons(win, h),
      h.div([h.Class("client")], [appView(model, win, h)]),
      ...resizeHandles(win, h),
    ],
  )
}
