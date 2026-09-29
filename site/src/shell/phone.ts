import { Array, Option, pipe } from "effect"
import type { Html, HtmlBuilder } from "foldkit/html"

import { apps, iconOf, titleOf } from "../apps/registry"
import glyphUrl from "../assets/heron-glyph.svg?url"

const inkGlyphUrl = `${import.meta.env.BASE_URL}brand/assets/heron-mark-mono-ink.svg`
import { readmePath } from "../domain/vfs"
import type * as Desk from "../domain/window"
import { Message } from "../message"
import type { Model } from "../model"
import { plainDocsUrl } from "./desktop"
import { formatDate, formatTime } from "./format"
import { iconUrl } from "./icons"
import { appView } from "./window"

// Windows Mobile 6 on narrow screens: the same Model, with the top window shown full screen.

const topWindow = (model: Model): Option.Option<Desk.Window> => Array.findLast(model.desk.windows, (win) => !win.isMinimised)

const signal = (h: HtmlBuilder<Message>): Html =>
  h.span([h.Class("wm-signal"), h.AriaHidden(true)], [h.i([]), h.i([]), h.i([]), h.i([])])

const todayItem = (h: HtmlBuilder<Message>, icon: string, lines: ReadonlyArray<string>, message?: Message): Html =>
  h.button(
    [h.Class("wm-today-item"), ...(message === undefined ? [h.Disabled(true)] : [h.OnClick(message)])],
    [h.img([h.Src(icon), h.Alt("")]), h.span([h.Class("wm-today-text")], lines.map((line) => h.span([], [line])))],
  )

const todayView = (model: Model, h: HtmlBuilder<Message>): Html =>
  h.div(
    [h.Class("wm-today")],
    [
      h.div([h.Class("wm-today-brand")], [h.img([h.Src(inkGlyphUrl), h.Alt("")]), h.span([], ["Heron OS"])]),
      h.p([h.Class("wm-today-date")], [formatDate(model.now)]),
      todayItem(h, iconUrl("user"), ["Owner: Visitor", "Heron reviews one merge request at its head"]),
      todayItem(h, iconUrl("text"), ["README.txt", "Tap to read how Heron works"], Message.ClickedStartPath({ path: readmePath })),
      todayItem(h, iconUrl("cmd"), ["Command Prompt", "heron review --mr 42 --dry-run"], Message.ClickedStartApp({ app: "cmd" })),
      todayItem(h, iconUrl("browser"), ["gitlab.heron.local", "Merge request !42 (fictional example)"], Message.ClickedStartApp({ app: "browser" })),
      h.a([h.Class("wm-plain-docs"), h.Href(plainDocsUrl)], ["Skip to the plain docs"]),
    ],
  )

const startListView = (h: HtmlBuilder<Message>): Html =>
  h.nav(
    [h.Class("wm-start-menu"), h.Role("menu"), h.AriaLabel("Start")],
    [
      h.button([h.Class("wm-start-item"), h.Role("menuitem"), h.OnClick(Message.ClickedToday())], [h.img([h.Src(inkGlyphUrl), h.Alt("")]), "Today"]),
      h.div([h.Class("wm-start-separator")]),
      ...apps
        .filter((app) => app.id !== "uac")
        .map((app) =>
          h.button(
            [h.Class("wm-start-item"), h.Role("menuitem"), h.OnClick(app.id === "notepad" ? Message.ClickedStartPath({ path: readmePath }) : Message.ClickedStartApp({ app: app.id }))],
            [h.img([h.Src(iconUrl(app.icon)), h.Alt("")]), app.name],
         ),
       ),
    ],
  )

export const phoneView = (model: Model, h: HtmlBuilder<Message>): Html => {
  const maybeTop = topWindow(model)
  return h.div(
    [h.Class("wm")],
    [
      h.header(
        [h.Class("wm-topbar")],
        [
          h.button(
            [h.Class(`wm-start${model.isStartMenuOpen ? " is-open" : ""}`), h.AriaExpanded(model.isStartMenuOpen), h.OnClick(Message.ClickedStart())],
            [
              h.img([h.Src(Option.match(maybeTop, { onNone: () => glyphUrl, onSome: (win) => iconUrl(iconOf(win.app)) })), h.Alt("")]),
              h.span([], [Option.match(maybeTop, { onNone: () => "Start", onSome: (win) => titleOf(win.app).replace(/ - .*$/, "") })]),
            ],
         ),
          h.span([h.Class("wm-status")], [signal(h), h.span([h.Class("wm-clock")], [formatTime(model.now)])]),
        ],
     ),
      h.main(
        [h.Class(`wm-body${Option.isSome(maybeTop) ? " is-app" : ""}`)],
        [Option.match(maybeTop, { onNone: () => todayView(model, h), onSome: (win) => h.div([h.Class(`wm-app app-${win.app._tag.toLowerCase()}`)], [appView(win, h)]) })],
     ),
      model.isStartMenuOpen ? startListView(h) : h.empty,
      h.footer(
        [h.Class("wm-softkeys")],
        pipe(
          maybeTop,
          Option.match({
            onNone: () => [
              h.button([h.Class("wm-softkey"), h.OnClick(Message.ClickedStartPath({ path: readmePath }))], ["Notepad"]),
              h.span([h.Class("wm-keyboard"), h.AriaHidden(true)]),
              h.button([h.Class("wm-softkey"), h.OnClick(Message.ClickedStart())], ["Programs"]),
            ],
            onSome: (win) => [
              h.button([h.Class("wm-softkey"), h.OnClick(Message.ClickedClose({ windowId: win.id }))], ["Close"]),
              h.span([h.Class("wm-keyboard"), h.AriaHidden(true)]),
              h.button([h.Class("wm-softkey"), h.OnClick(Message.ClickedStart())], ["Menu"]),
            ],
          }),
       ),
     ),
    ],
  )
}
