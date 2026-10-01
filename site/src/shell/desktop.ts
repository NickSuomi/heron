import { Array, Option } from "effect"
import type { Html, HtmlBuilder } from "foldkit/html"

import { children, desktopPath, type VfsNode } from "../domain/vfs"
import * as Desk from "../domain/window"
import { Message } from "../message"
import { type Model, Switcher } from "../model"
import { iconForNode, iconOf, titleOf } from "../apps/registry"
import { iconUrl } from "./icons"
import { secureDesktopView } from "./secureDesktop"
import { startMenuView } from "./startMenu"
import { taskbarView } from "./taskbar"
import { tourBalloonView } from "./tourBalloon"
import { windowView } from "./window"

export const plainDocsUrl = "https://github.com/NickSuomi/heron#readme"

const displayName = (node: VfsNode): string => node.name

const iconView = (model: Model, node: VfsNode, h: HtmlBuilder<Message>): Html =>
  h.keyed("button")(
    `icon-${node.path}`,
    [
      h.Class(`desktop-icon${Option.contains(model.maybeSelectedIcon, node.path) ? " is-selected" : ""}`),
      h.AriaLabel(displayName(node)),
      h.OnClick(Message.ClickedIcon({ path: node.path })),
      h.OnDoubleClick(Message.DoubleClickedIcon({ path: node.path })),
      h.OnFocus(Message.ClickedIcon({ path: node.path })),
    ],
    [
      h.img([h.Src(iconUrl(iconForNode(node), 48)), h.Alt(""), h.Width("48"), h.Height("48"), h.Draggable(false)]),
      h.span([h.Class("desktop-icon-label")], [displayName(node)]),
    ],
  )

const switcherView = (model: Model, h: HtmlBuilder<Message>): Html =>
  Switcher.match<Html>(model.switcher, {
    Closed: () => h.empty,
    Open: ({ index }) => {
      const order = Desk.switchOrder(model.desk)
      return h.div(
        [h.Class("switcher"), h.Role("listbox"), h.AriaLabel("Switch windows")],
        [
          h.p([h.Class("switcher-title")], [Option.match(Array.get(order, index), { onNone: () => "", onSome: (win) => titleOf(win.app) })]),
          h.div(
            [h.Class("switcher-items")],
            order.map((win, position) =>
              h.div(
                [h.Class(`switcher-item${position === index ? " is-selected" : ""}`), h.Role("option"), h.AriaSelected(position === index )],
                [h.img([h.Src(iconUrl(iconOf(win.app))), h.Alt(titleOf(win.app))])],
              ),
            ),
          ),
          h.p([h.Class("switcher-hint")], ["Hold Alt and press ` to switch windows"]),
        ],
      )
    },
  })

export const desktopView = (model: Model, h: HtmlBuilder<Message>): Html => {
  const isSecure = model.uac._tag !== "Hidden"
  return h.div(
    [h.Class(`os${model.gesture._tag === "Idle" ? "" : ` is-${model.gesture._tag.toLowerCase()}`}${isSecure ? " is-secure" : ""}`)],
    [
      h.a([h.Class("skip-link"), h.Href(plainDocsUrl)], ["Skip to the plain docs"]),
      h.main(
        [h.Class("desk"), h.AriaLabel("Heron OS desktop"), h.Inert(isSecure)],
        [
          h.div([h.Class("wallpaper")]),
          h.div(
            [h.Class("desktop-surface"), h.OnPointerDown(() => Option.some(Message.PressedDesktop()))],
            [h.div([h.Class("desktop-icons"), h.Role("group"), h.AriaLabel("Desktop icons")], children(desktopPath).map((node) => iconView(model, node, h)))],
          ),
          ...model.desk.windows.map((win, index) => windowView(model, win, index + 10, h)),
        ],
      ),
      h.div([h.Class("os-chrome"), h.Inert(isSecure)], [startMenuView(model, h), taskbarView(model, h), switcherView(model, h), tourBalloonView(model, h)]),
      secureDesktopView(model, h),
    ],
  )
}
