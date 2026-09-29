import type { Html, HtmlBuilder } from "foldkit/html"

import { iconOf, titleOf } from "../apps/registry"
import glyphUrl from "../assets/heron-glyph.svg?url"
import * as Desk from "../domain/window"
import { Message } from "../message"
import type { Model } from "../model"
import { formatShortDate, formatTime } from "./format"
import { iconUrl } from "./icons"
import { glassLayer } from "./window"

const speaker = (h: HtmlBuilder<Message>, isMuted: boolean): Html =>
  h.svg(
    [h.Class("tray-speaker"), h.ViewBox("0 0 16 16"), h.Width("16"), h.Height("16"), h.AriaHidden(true)],
    [
      h.path([h.Attribute("d", "M2 6h3l4-3.5v11L5 10H2z"), h.Attribute("fill", "#e8eef6"), h.Attribute("stroke", "#5b6b80"), h.Attribute("stroke-width", "0.8")]),
      ...(isMuted
        ? [h.path([h.Attribute("d", "M11 5.5l4 5M15 5.5l-4 5"), h.Attribute("stroke", "#ff4a3a"), h.Attribute("stroke-width", "1.8"), h.Attribute("stroke-linecap", "round")])]
        : [
            h.path([h.Attribute("d", "M11 5.5c1 .8 1 4.2 0 5"), h.Attribute("stroke", "#e8eef6"), h.Attribute("stroke-width", "1.2"), h.Attribute("fill", "none")]),
            h.path([h.Attribute("d", "M12.8 3.8c2 1.6 2 6.8 0 8.4"), h.Attribute("stroke", "#e8eef6"), h.Attribute("stroke-width", "1.2"), h.Attribute("fill", "none")]),
          ]),
    ],
  )

export const taskbarView = (model: Model, h: HtmlBuilder<Message>): Html =>
  h.footer(
    [h.Class("taskbar"), h.Role("toolbar"), h.AriaLabel("Taskbar")],
    [
      glassLayer(model, h, 0),
      h.button(
        [
          h.Class(`start-orb${model.isStartMenuOpen ? " is-open" : ""}`),
          h.AriaLabel("Start"),
          h.Title("Start"),
          h.AriaExpanded(model.isStartMenuOpen),
          h.OnClick(Message.ClickedStart()),
        ],
        [h.span([h.Class("orb-glass")], [h.img([h.Class("orb-glyph"), h.Src(glyphUrl), h.Alt("")])])],
     ),
      h.div(
        [h.Class("task-buttons")],
        model.desk.windows.map((win) =>
          h.keyed("button")(
            `task-${win.id}`,
            [
              h.Class(`task-button${Desk.isFocused(model.desk, win.id) ? " is-active" : ""}`),
              h.Title(titleOf(win.app)),
              h.AriaPressed(Desk.isFocused(model.desk, win.id) ? "true" : "false"),
              h.OnClick(Message.ClickedTaskbarButton({ windowId: win.id })),
            ],
            [h.img([h.Src(iconUrl(iconOf(win.app))), h.Alt("")]), h.span([], [titleOf(win.app)])],
         ),
       ),
     ),
      h.div(
        [h.Class("tray")],
        [
          h.button(
            [
              h.Class("tray-button"),
              h.AriaLabel(model.isMuted ? "Sound is off. Turn on." : "Sound is on. Mute."),
              h.Title(model.isMuted ? "Volume: muted" : "Volume"),
              h.AriaPressed(model.isMuted ? "true" : "false"),
              h.OnClick(Message.ToggledMute()),
            ],
            [speaker(h, model.isMuted)],
         ),
          h.time([h.Class("tray-clock"), h.Title(formatShortDate(model.now))], [formatTime(model.now)]),
        ],
     ),
    ],
  )
