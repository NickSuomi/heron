import type { Html, HtmlBuilder } from "foldkit/html"

import { apps, definition } from "../apps/registry"
import { type AppId, FilePath, readmePath } from "../domain/vfs"
import { Message } from "../message"
import type { Model } from "../model"
import { type IconName, iconUrl } from "./icons"
import { glassLayer } from "./window"

type Entry = Readonly<{ label: string; detail?: string; icon: IconName; message: Message }>

const app = (id: AppId, detail?: string): Entry => ({
  label: definition(id).name,
  ...(detail === undefined ? {} : { detail }),
  icon: definition(id).icon,
  message: Message.ClickedStartApp({ app: id }),
})

const at = (label: string, path: string, icon: IconName): Entry => ({ label, icon, message: Message.ClickedStartPath({ path: FilePath.make(path) }) })

const pinned: ReadonlyArray<Entry> = [app("browser", "gitlab.heron.local"), app("cmd", "heron --help")]

const recent: ReadonlyArray<Entry> = [
  { label: "Notepad", detail: "README.txt", icon: "notepad", message: Message.ClickedStartPath({ path: readmePath }) },
  app("editor"),
  { label: "Diagram Viewer", detail: "How Heron works.vsd", icon: "diagram", message: Message.ClickedStartPath({ path: FilePath.make("/Desktop/How Heron works.vsd") }) },
  app("welcome"),
  app("explorer"),
]

/** Every program, by name, as the All Programs list shows them. The Recycle Bin dialogs are not programs. */
const allPrograms: ReadonlyArray<Entry> = apps
  .filter((entry) => entry.id !== "dialog")
  .map((entry) => app(entry.id))
  .toSorted((a, b) => a.label.localeCompare(b.label))

const places: ReadonlyArray<Entry | "separator"> = [
  at("Visitor", "/Heron", "heron-folder"),
  at("Documents", "/Heron/docs", "folder"),
  at("Source", "/Heron/src", "folder"),
  at("Computer", "/", "computer"),
  at("Recycle Bin", "/Recycle Bin", "recycle-bin"),
  "separator",
  app("welcome"),
  app("help"),
]

const programView = (h: HtmlBuilder<Message>, entry: Entry, isLarge: boolean): Html =>
  h.button(
    [h.Class(`sm-program${isLarge ? " is-pinned" : ""}`), h.Role("menuitem"), h.OnClick(entry.message)],
    [
      h.img([h.Src(iconUrl(entry.icon, 32)), h.Alt(""), h.Width(isLarge ? "32" : "32"), h.Height("32")]),
      h.span([h.Class("sm-program-text")], [h.span([h.Class("sm-program-name")], [entry.label]), ...(entry.detail === undefined ? [] : [h.span([h.Class("sm-program-detail")], [entry.detail])])]),
    ],
  )

const placeView = (h: HtmlBuilder<Message>, entry: Entry | "separator"): Html =>
  entry === "separator"
    ? h.div([h.Class("sm-place-separator"), h.Role("separator")])
    : h.button([h.Class("sm-place"), h.Role("menuitem"), h.OnClick(entry.message)], [entry.label])

export const startMenuView = (model: Model, h: HtmlBuilder<Message>): Html =>
  model.isStartMenuOpen
    ? h.nav(
        [h.Class("start-menu"), h.DataAttribute("glass-root", ""), h.Role("menu"), h.AriaLabel("Start menu")],
        [
          glassLayer(model, h, 8),
          h.div(
            [h.Class("sm-user-frame")],
            [h.img([h.Src(iconUrl("user")), h.Alt("Visitor")])],
          ),
          h.div(
            [h.Class("sm-left")],
            [
              model.isAllProgramsShown
                ? h.div([h.Class("sm-programs is-all")], allPrograms.map((entry) => programView(h, entry, false)))
                : h.div([h.Class("sm-programs")], [...pinned.map((entry) => programView(h, entry, true)), h.div([h.Class("sm-separator")]), ...recent.map((entry) => programView(h, entry, false))]),
              h.button(
                [h.Class(`sm-all-programs${model.isAllProgramsShown ? " is-back" : ""}`), h.AriaExpanded(model.isAllProgramsShown), h.OnClick(Message.ClickedAllPrograms())],
                [h.span([h.Class("sm-arrow")]), model.isAllProgramsShown ? "Back" : "All Programs"],
              ),
              h.div(
                [h.Class("sm-search")],
                [h.input([h.Class("sm-search-input"), h.Placeholder("Start Search"), h.AriaLabel("Start Search"), h.Readonly(true)]), h.span([h.Class("sm-search-icon")])],
              ),
            ],
          ),
          h.div(
            [h.Class("sm-right")],
            [
              h.div([h.Class("sm-places")], places.map((entry) => placeView(h, entry))),
              h.div(
                [h.Class("sm-power")],
                [
                  h.button([h.Class("sm-power-button"), h.AriaLabel("Restart Heron OS"), h.Title("Restart Heron OS"), h.OnClick(Message.ClickedPower())], [h.span([h.Class("sm-power-glyph")])]),
                  h.button([h.Class("sm-lock-button"), h.AriaLabel("Lock"), h.Title("Lock"), h.OnClick(Message.ClickedLock())], [h.span([h.Class("sm-lock-glyph")])]),
                  h.span([h.Class("sm-power-arrow"), h.AriaHidden(true)]),
                ],
              ),
            ],
          ),
        ],
      )
    : h.empty
