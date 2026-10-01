import { Array, Option, Order, pipe, Schema } from "effect"
import { Submodel, type Update } from "foldkit"
import type { Html, HtmlBuilder } from "foldkit/html"
import { defineMessageUnion } from "foldkit/message"
import { taggedStruct } from "foldkit/schema"
import { modifyFields } from "foldkit/struct"

import { children, FilePath, lookup, type VfsNode } from "../domain/vfs"
import { type IconName, iconUrl } from "../shell/icons"
import { glyphUrl } from "./glyphs"
import { iconForNode } from "./registry"
import { Request, type ViewInputs } from "./request"

// Explorer in the Vista style: back and forward, a breadcrumb address bar, a command bar, the
// navigation pane (Favorite Links, Folders), details and icons views, a preview pane, a details pane
// and a status bar. It browses the Heron OS file system; opening a file goes through the registry.

export const Layout = Schema.Literals(["Details", "Icons"])
export type Layout = typeof Layout.Type

export const Model = taggedStruct("Explorer", {
  location: FilePath,
  back: Schema.Array(FilePath),
  forward: Schema.Array(FilePath),
  layout: Layout,
  maybeSelected: Schema.Option(FilePath),
  isViewsMenuOpen: Schema.Boolean,
  isPreviewShown: Schema.Boolean,
  isFoldersOpen: Schema.Boolean,
  expanded: Schema.Array(FilePath),
  query: Schema.String,
  isInfoBarShown: Schema.Boolean,
})
export type Model = typeof Model.Type

export const Message = defineMessageUnion({
  ClickedItem: { path: FilePath },
  OpenedItem: { path: FilePath },
  ClickedBackground: {},
  ClickedBack: {},
  ClickedForward: {},
  ClickedUp: {},
  ClickedLocation: { path: FilePath },
  ToggledFolder: { path: FilePath },
  ToggledFolders: {},
  ClickedViews: {},
  ChoseLayout: { layout: Layout },
  ToggledPreview: {},
  UpdatedQuery: { value: Schema.String },
  ClickedEmptyBin: {},
  ClosedInfoBar: {},
  ClickedApprove: {},
})
export type Message = typeof Message.Type

export const OutMessage = Request
export type OutMessage = Request

const path = (value: string): FilePath => FilePath.make(value)
const root = path("/")
const recycleBin = path("/Recycle Bin")
const mergeRequestDiff = path("/Desktop/merge-request-42.diff")

const parentOf = (at: FilePath): FilePath => path(at.slice(0, Math.max(at.lastIndexOf("/"), 0)) || "/")

const folderOf = (maybeNode: Option.Option<VfsNode>): FilePath =>
  Option.match(maybeNode, {
    onNone: () => root,
    onSome: (node) => (node._tag === "Folder" ? node.path : parentOf(node.path)),
  })

export const init = (maybeNode: Option.Option<VfsNode>): Model => {
  const location = folderOf(maybeNode)
  return Model({
    location,
    back: [],
    forward: [],
    layout: location === recycleBin ? "Details" : location.startsWith("/Heron") ? "Details" : "Icons",
    maybeSelected: Option.none(),
    isViewsMenuOpen: false,
    isPreviewShown: true,
    isFoldersOpen: true,
    expanded: [root, path("/Heron")],
    query: "",
    isInfoBarShown: false,
  })
}

const nameOf = (at: FilePath): string => Option.match(lookup(at), { onNone: () => at, onSome: (node) => node.name })

export const title = (model: Model): string => nameOf(model.location)

// ---------------------------------------------------------------------------------------------------
// Update

type UpdateReturn = Update.ReturnWithOutMessage<Model, Message, OutMessage>

const navigate = (model: Model, to: FilePath): Model =>
  to === model.location
    ? model
    : {
        ...model,
        location: to,
        back: [...model.back, model.location],
        forward: [],
        maybeSelected: Option.none(),
        query: "",
        isViewsMenuOpen: false,
        isInfoBarShown: false,
        expanded: Array.dedupe([...model.expanded, ...ancestors(to)]),
      }

const ancestors = (at: FilePath): ReadonlyArray<FilePath> => (at === root ? [] : [...ancestors(parentOf(at)), parentOf(at)])

/** A folder, or a shortcut to a folder, opens in place; everything else goes to the shell. */
const open = (model: Model, at: FilePath): UpdateReturn =>
  Option.match(lookup(at), {
    onNone: () => ({ model }),
    onSome: (node) => {
      if (node._tag === "Folder") return { model: navigate(model, node.path) }
      if (node._tag === "Shortcut" && node.app === "explorer" && Option.isSome(node.maybeTarget)) {
        return { model: navigate(model, node.maybeTarget.value) }
      }
      return { model: { ...model, maybeSelected: Option.some(at) }, outMessage: Request.RequestedOpenPath({ path: at }) }
    },
  })

export const update = (model: Model, message: Message): UpdateReturn =>
  Message.match<UpdateReturn>(message, {
    ClickedItem: ({ path: at }) => ({ model: { ...model, maybeSelected: Option.some(at), isViewsMenuOpen: false } }),
    OpenedItem: ({ path: at }) => open(model, at),
    ClickedBackground: () => ({ model: { ...model, maybeSelected: Option.none(), isViewsMenuOpen: false } }),
    ClickedBack: () =>
      Option.match(Array.last(model.back), {
        onNone: () => ({ model }),
        onSome: (previous) => ({
          model: { ...model, location: previous, back: model.back.slice(0, -1), forward: [model.location, ...model.forward], maybeSelected: Option.none(), query: "" },
        }),
      }),
    ClickedForward: () =>
      Option.match(Array.head(model.forward), {
        onNone: () => ({ model }),
        onSome: (next) => ({
          model: { ...model, location: next, back: [...model.back, model.location], forward: model.forward.slice(1), maybeSelected: Option.none(), query: "" },
        }),
      }),
    ClickedUp: () => ({ model: model.location === root ? model : navigate(model, parentOf(model.location)) }),
    ClickedLocation: ({ path: at }) => ({ model: navigate(model, at) }),
    ToggledFolder: ({ path: at }) => ({
      model: modifyFields(model, { expanded: (open) => (open.includes(at) ? open.filter((each) => each !== at) : [...open, at]) }),
    }),
    ToggledFolders: () => ({ model: modifyFields(model, { isFoldersOpen: (open) => !open }) }),
    ClickedViews: () => ({ model: modifyFields(model, { isViewsMenuOpen: (open) => !open }) }),
    ChoseLayout: ({ layout }) => ({ model: { ...model, layout, isViewsMenuOpen: false } }),
    ToggledPreview: () => ({ model: modifyFields(model, { isPreviewShown: (shown) => !shown, isViewsMenuOpen: () => false }) }),
    UpdatedQuery: ({ value }) => ({ model: { ...model, query: value, maybeSelected: Option.none() } }),
    ClickedEmptyBin: () => ({ model: { ...model, isInfoBarShown: true } }),
    ClosedInfoBar: () => ({ model: { ...model, isInfoBarShown: false } }),
    ClickedApprove: () => ({ model, outMessage: Request.RequestedApproval() }),
  })

// ---------------------------------------------------------------------------------------------------
// Facts about a node

const extension = (name: string): string => pipe(name.split("."), Array.last, Option.getOrElse(() => "")).toLowerCase()

const typeName = (node: VfsNode): string => {
  if (node._tag === "Folder") return "File Folder"
  if (node._tag === "Shortcut") return "Shortcut"
  switch (node.type) {
    case "Text":
      return extension(node.name) === "css" ? "Cascading Style Sheet" : "Text Document"
    case "Markdown":
      return "Markdown Document"
    case "TypeScript":
      return "TypeScript File"
    case "Vue":
      return "Vue Component"
    case "Json":
      return "JSON File"
    case "Diff":
      return "Diff File"
    case "Diagram":
      return "Heron Diagram"
    case "Program":
      return ({ exe: "Application", bat: "Batch File", lnk: "Shortcut" } as Record<string, string>)[extension(node.name)] ?? "Program"
    case "Folder":
      return "File Folder"
  }
}

const byteLength = (text: string): number => new TextEncoder().encode(text).length

const sizeText = (node: VfsNode): string =>
  node._tag === "File" ? `${byteLength(node.content) === 0 ? 0 : Math.max(1, Math.ceil(byteLength(node.content) / 1024))} KB` : ""

const nodeOrder: Order.Order<VfsNode> = Order.combine(
  Order.mapInput(Order.Number, (node: VfsNode) => (node._tag === "Folder" ? 0 : 1)),
  Order.mapInput(Order.String, (node: VfsNode) => node.name.toLowerCase()),
)

const isInBin = (model: Model): boolean => model.location === recycleBin

const visibleItems = (model: Model): ReadonlyArray<VfsNode> =>
  pipe(
    children(model.location),
    Array.filter((node) => model.query === "" || node.name.toLowerCase().includes(model.query.toLowerCase())),
    model.location === path("/Desktop") ? (nodes) => nodes : Array.sort(nodeOrder),
  )

const itemCount = (count: number): string => `${count} ${count === 1 ? "item" : "items"}`

const originalLocation = "Never in Heron"

const whereFrom = (node: VfsNode): string =>
  node.path.startsWith("/Heron/")
    ? "Read-only copy of the Heron repository, bundled when the site was built"
    : node.path.startsWith("/Recycle Bin/")
      ? `Original location: ${originalLocation}`
      : node.path === mergeRequestDiff
        ? "Fictional example: acme/storefront !42"
        : "Heron OS desktop"

// ---------------------------------------------------------------------------------------------------
// View pieces

/** The folders the desktop has shortcuts to wear the shortcut's icon here too. */
const iconName = (node: VfsNode): IconName =>
  node._tag !== "Folder"
    ? iconForNode(node)
    : node.path === root
      ? "computer"
      : node.path === recycleBin
        ? "recycle-bin"
        : node.path === path("/Heron")
          ? "heron-folder"
          : "folder"

const icon = <M>(h: HtmlBuilder<M>, node: VfsNode, size: number): Html =>
  h.img([h.Src(iconUrl(iconName(node), size)), h.Alt(""), h.Width(String(size)), h.Height(String(size)), h.Draggable(false)])

const segments = (at: FilePath): ReadonlyArray<FilePath> => [...ancestors(at), at]

const navButtons = (h: HtmlBuilder<Message>, model: Model): Html =>
  h.div(
    [h.Class("ex-travel")],
    [
      h.button(
        [h.Class("ex-travel-back"), h.AriaLabel("Back"), h.Title("Back"), ...(model.back.length === 0 ? [h.Disabled(true)] : [h.OnClick(Message.ClickedBack())])],
        [h.span([h.Class("ex-arrow")])],
      ),
      h.button(
        [h.Class("ex-travel-forward"), h.AriaLabel("Forward"), h.Title("Forward"), ...(model.forward.length === 0 ? [h.Disabled(true)] : [h.OnClick(Message.ClickedForward())])],
        [h.span([h.Class("ex-arrow")])],
      ),
    ],
  )

const addressBar = (h: HtmlBuilder<Message>, model: Model): Html =>
  h.nav(
    [h.Class("ex-address"), h.AriaLabel("Address")],
    [
      Option.match(lookup(model.location), { onNone: () => h.empty, onSome: (node) => h.span([h.Class("ex-address-icon")], [icon(h, node, 16)]) }),
      h.span([h.Class("ex-crumb-sep is-root"), h.AriaHidden(true)]),
      ...segments(model.location).flatMap((at, index, all) => [
        h.button(
          [h.Class("ex-crumb"), h.OnClick(Message.ClickedLocation({ path: at })), ...(index === all.length - 1 ? [h.AriaCurrent("location")] : [])],
          [nameOf(at)],
        ),
        index < all.length - 1 ? h.span([h.Class("ex-crumb-sep"), h.AriaHidden(true)]) : h.empty,
      ]),
      h.span([h.Class("ex-address-spacer")]),
      h.button([h.Class("ex-address-up"), h.AriaLabel("Up one level"), h.Title("Up one level"), h.OnClick(Message.ClickedUp())], []),
    ],
  )

const searchBox = (h: HtmlBuilder<Message>, model: Model): Html =>
  h.div(
    [h.Class("ex-search")],
    [
      h.keyed("input")(`search-${model.location}`, [
        h.Type("search"),
        h.Placeholder("Search"),
        h.AriaLabel(`Search ${nameOf(model.location)}`),
        h.Attribute("value", model.query),
        h.OnInput((value) => Message.UpdatedQuery({ value })),
      ]),
      h.img([h.Src(glyphUrl("search")), h.Alt(""), h.Width("16"), h.Height("16")]),
    ],
  )

const commandButton = (h: HtmlBuilder<Message>, label: string, glyph: Parameters<typeof glyphUrl>[0], message: Option.Option<Message>, extra: ReadonlyArray<Html> = []): Html =>
  h.button(
    [h.Class("ex-command"), ...Option.match(message, { onNone: () => [h.Disabled(true)], onSome: (each) => [h.OnClick(each)] })],
    [h.img([h.Src(glyphUrl(glyph)), h.Alt(""), h.Width("16"), h.Height("16")]), h.span([], [label]), ...extra],
  )

const viewsMenu = (h: HtmlBuilder<Message>, model: Model): Html =>
  model.isViewsMenuOpen
    ? h.div(
        [h.Class("menu-popup ex-views-menu"), h.Role("menu")],
        [
          h.button(
            [h.Class(`menu-item${model.layout === "Icons" ? " is-radio" : ""}`), h.Role("menuitemradio"), h.AriaChecked(model.layout === "Icons"), h.OnClick(Message.ChoseLayout({ layout: "Icons" }))],
            [h.span([h.Class("menu-label")], ["Large Icons"]), h.span([h.Class("menu-shortcut")], [""])],
          ),
          h.button(
            [h.Class(`menu-item${model.layout === "Details" ? " is-radio" : ""}`), h.Role("menuitemradio"), h.AriaChecked(model.layout === "Details"), h.OnClick(Message.ChoseLayout({ layout: "Details" }))],
            [h.span([h.Class("menu-label")], ["Details"]), h.span([h.Class("menu-shortcut")], [""])],
          ),
        ],
      )
    : h.empty

const selectedNode = (model: Model): Option.Option<VfsNode> => Option.flatMap(model.maybeSelected, lookup)

const commandBar = (h: HtmlBuilder<Message>, model: Model): Html =>
  h.div(
    [h.Class("ex-commandbar"), h.Role("toolbar")],
    [
      commandButton(h, "Organize", "organize", Option.none(), [h.span([h.Class("ex-drop")])]),
      h.div(
        [h.Class("ex-views")],
        [
          commandButton(h, "Views", model.layout === "Details" ? "details" : "icons", Option.some(Message.ClickedViews()), [h.span([h.Class("ex-drop")])]),
          viewsMenu(h, model),
        ],
      ),
      ...Option.match(selectedNode(model), {
        onNone: () => [],
        onSome: (node) => [commandButton(h, "Open", "open", Option.some(Message.OpenedItem({ path: node.path })))],
      }),
      ...(isInBin(model) ? [commandButton(h, "Empty the Recycle Bin", "bin-empty", Option.some(Message.ClickedEmptyBin()))] : []),
      h.span([h.Class("ex-command-spacer")]),
      h.button(
        [h.Class(`ex-command ex-preview-toggle${model.isPreviewShown ? " is-pressed" : ""}`), h.AriaPressed(String(model.isPreviewShown)), h.Title("Show the preview pane"), h.OnClick(Message.ToggledPreview())],
        [h.img([h.Src(glyphUrl("preview-pane")), h.Alt(""), h.Width("16"), h.Height("16")]), h.span([h.Class("ex-sr")], ["Preview pane"])],
      ),
    ],
  )

const favorites: ReadonlyArray<readonly [label: string, at: string]> = [
  ["Desktop", "/Desktop"],
  ["Heron", "/Heron"],
  ["Documents", "/Heron/docs"],
  ["Source", "/Heron/src"],
  ["Recycle Bin", "/Recycle Bin"],
]

const treeView = (h: HtmlBuilder<Message>, model: Model, at: FilePath, depth: number): ReadonlyArray<Html> => {
  const folders = children(at).filter((node) => node._tag === "Folder")
  const isOpen = model.expanded.includes(at)
  const row = h.div(
    [h.Class(`ex-tree-row${model.location === at ? " is-selected" : ""}`), h.Style({ "padding-left": `${4 + depth * 14}px` })],
    [
      folders.length === 0
        ? h.span([h.Class("ex-twisty is-leaf")])
        : h.button([h.Class(`ex-twisty${isOpen ? " is-open" : ""}`), h.AriaLabel(isOpen ? "Collapse" : "Expand"), h.AriaExpanded(isOpen), h.OnClick(Message.ToggledFolder({ path: at }))], []),
      h.button(
        [h.Class("ex-tree-item"), h.OnClick(Message.ClickedLocation({ path: at }))],
        [...Option.match(lookup(at), { onNone: () => [], onSome: (node) => [icon(h, node, 16)] }), h.span([], [nameOf(at)])],
      ),
    ],
  )
  return [row, ...(isOpen ? folders.flatMap((folder) => treeView(h, model, folder.path, depth + 1)) : [])]
}

const navigationPane = (h: HtmlBuilder<Message>, model: Model): Html =>
  h.aside(
    [h.Class("ex-nav"), h.AriaLabel("Navigation pane")],
    [
      h.div(
        [h.Class("ex-favorites")],
        [
          h.h2([h.Class("ex-nav-title")], ["Favorite Links"]),
          ...favorites.map(([label, at]) =>
            h.button(
              [h.Class(`ex-favorite${model.location === at ? " is-selected" : ""}`), h.OnClick(Message.ClickedLocation({ path: path(at) }))],
              [...Option.match(lookup(path(at)), { onNone: () => [], onSome: (node) => [icon(h, node, 16)] }), h.span([], [label])],
            ),
          ),
        ],
      ),
      h.div(
        [h.Class(`ex-folders${model.isFoldersOpen ? " is-open" : ""}`)],
        [
          h.button([h.Class("ex-folders-bar"), h.AriaExpanded(model.isFoldersOpen), h.OnClick(Message.ToggledFolders())], [h.span([], ["Folders"]), h.span([h.Class("ex-chevron")])]),
          model.isFoldersOpen ? h.div([h.Class("ex-tree"), h.Role("tree")], [h.div([h.Class("ex-tree-root")], treeView(h, model, root, 0))]) : h.empty,
        ],
      ),
    ],
  )

const itemAttributes = (h: HtmlBuilder<Message>, model: Model, node: VfsNode) => [
  h.Class(`ex-item${Option.contains(model.maybeSelected, node.path) ? " is-selected" : ""}`),
  h.Role("option"),
  h.AriaSelected(Option.contains(model.maybeSelected, node.path)),
  h.OnClick(Message.ClickedItem({ path: node.path }), { propagation: "Stop" }),
  h.OnDoubleClick(Message.OpenedItem({ path: node.path })),
  h.OnKeyDownPreventDefault((key) => (key === "Enter" ? Option.some(Message.OpenedItem({ path: node.path })) : Option.none())),
]

const detailsView = (h: HtmlBuilder<Message>, model: Model, items: ReadonlyArray<VfsNode>): Html => {
  const columns = isInBin(model) ? ["Name", "Original Location", "Size", "Item type"] : ["Name", "Type", "Size"]
  return h.div(
    [h.Class(`ex-details${isInBin(model) ? " is-bin" : ""}`), h.Role("listbox"), h.AriaLabel(nameOf(model.location))],
    [
      h.div([h.Class("ex-columns"), h.AriaHidden(true)], columns.map((column, index) => h.span([h.Class(`ex-column${index === 0 ? " is-sorted" : ""}`)], [column]))),
      ...items.map((node) =>
        h.button(itemAttributes(h, model, node), [
          h.span([h.Class("ex-cell ex-cell-name")], [icon(h, node, 16), h.span([], [node.name])]),
          ...(isInBin(model) ? [h.span([h.Class("ex-cell")], [originalLocation])] : []),
          ...(isInBin(model) ? [] : [h.span([h.Class("ex-cell")], [typeName(node)])]),
          h.span([h.Class("ex-cell ex-cell-size")], [sizeText(node)]),
          ...(isInBin(model) ? [h.span([h.Class("ex-cell")], [typeName(node)])] : []),
        ]),
      ),
    ],
  )
}

const iconsView = (h: HtmlBuilder<Message>, model: Model, items: ReadonlyArray<VfsNode>): Html =>
  h.div(
    [h.Class("ex-icons"), h.Role("listbox"), h.AriaLabel(nameOf(model.location))],
    items.map((node) => h.button(itemAttributes(h, model, node), [icon(h, node, 48), h.span([h.Class("ex-icon-label")], [node.name])])),
  )

const previewLines = (text: string): ReadonlyArray<string> => text.split("\n").slice(0, 80)

const diffLineClass = (line: string): string =>
  line.startsWith("+++") || line.startsWith("---") ? "is-file" : line.startsWith("+") ? "is-add" : line.startsWith("-") ? "is-del" : line.startsWith("@@") ? "is-hunk" : ""

const approveButton = (h: HtmlBuilder<Message>): Html =>
  h.button(
    [h.Class("vista-button ex-approve"), h.OnClick(Message.ClickedApprove())],
    [h.img([h.Src(glyphUrl("shield-small")), h.Alt(""), h.Width("16"), h.Height("16")]), "Approve merge request"],
  )

const previewPane = (h: HtmlBuilder<Message>, model: Model): Html =>
  h.aside(
    [h.Class("ex-preview"), h.AriaLabel("Preview pane")],
    [
      Option.match(selectedNode(model), {
        onNone: () => h.p([h.Class("ex-preview-empty")], ["Select a file to preview its contents."]),
        onSome: (node) => {
          if (node._tag !== "File") return h.div([h.Class("ex-preview-big")], [icon(h, node, 96), h.p([], [node.name])])
          if (node.type === "Program") {
            return h.div([h.Class("ex-preview-big")], [icon(h, node, 96), h.p([], ["No preview available. Heron never runs this."])])
          }
          if (node.type === "Diagram") {
            return h.div(
              [h.Class("ex-preview-big")],
              [icon(h, node, 96), h.p([], ["Path rules pick a lane; gates, a supervisor or a judge review; code decides the verdict; Heron writes one note."])],
            )
          }
          return h.div(
            [h.Class("ex-preview-file")],
            [
              h.pre(
                [h.Class(`ex-preview-text${node.type === "Diff" ? " is-diff" : ""}`)],
                previewLines(node.content).map((line) => h.span([h.Class(node.type === "Diff" ? diffLineClass(line) : "")], [line === "" ? " " : line])),
              ),
              node.path === mergeRequestDiff ? h.div([h.Class("ex-preview-actions")], [approveButton(h)]) : h.empty,
            ],
          )
        },
      }),
    ],
  )

const detailsPane = (h: HtmlBuilder<Message>, model: Model, items: ReadonlyArray<VfsNode>): Html =>
  h.div(
    [h.Class("ex-detailspane")],
    Option.match(selectedNode(model), {
      onNone: () =>
        Option.match(lookup(model.location), {
          onNone: () => [],
          onSome: (folder) => [icon(h, folder, 48), h.div([h.Class("ex-dp-text")], [h.strong([], [itemCount(items.length)]), h.span([], [whereFrom(folder)])])],
        }),
      onSome: (node) => [
        icon(h, node, 48),
        h.div(
          [h.Class("ex-dp-text")],
          [
            h.strong([], [node.name]),
            h.span([], [typeName(node)]),
            h.span([], [whereFrom(node)]),
          ],
        ),
        node._tag === "File" ? h.dl([h.Class("ex-dp-props")], [h.dt([], ["Size:"]), h.dd([], [sizeText(node)])]) : h.empty,
      ],
    }),
  )

const infoBar = (h: HtmlBuilder<Message>, model: Model): Html =>
  model.isInfoBarShown
    ? h.div(
        [h.Class("ex-infobar"), h.Role("status")],
        [
          h.img([h.Src(glyphUrl("dialog-info")), h.Alt(""), h.Width("16"), h.Height("16")]),
          h.span([], ["These three stay. They are the things Heron never does: approve, push, or merge."]),
          h.button([h.Class("ex-infobar-close"), h.AriaLabel("Close"), h.OnClick(Message.ClosedInfoBar())], []),
        ],
      )
    : h.empty

const statusBar = (h: HtmlBuilder<Message>, model: Model, items: ReadonlyArray<VfsNode>): Html =>
  h.div(
    [h.Class("ex-status")],
    [
      h.span([], [Option.isSome(model.maybeSelected) ? "1 item selected" : itemCount(items.length)]),
      h.span([h.Class("ex-status-zone")], [model.location.startsWith("/Heron") ? "Read-only" : "Heron OS"]),
    ],
  )

// ---------------------------------------------------------------------------------------------------
// Phone: File Explorer

const phoneView = (h: HtmlBuilder<Message>, model: Model, items: ReadonlyArray<VfsNode>): Html =>
  h.div(
    [h.Class("ex-phone")],
    [
      h.div(
        [h.Class("ex-phone-bar")],
        [
          h.button([h.Class("ex-phone-folder"), ...(model.location === root ? [h.Disabled(true)] : [h.OnClick(Message.ClickedUp())])], [
            h.span([], [nameOf(model.location)]),
            h.span([h.Class("ex-phone-up")], [model.location === root ? "" : "Up"]),
          ]),
          h.span([h.Class("ex-phone-sort")], ["Name"]),
        ],
      ),
      h.div(
        [h.Class("ex-phone-list"), h.Role("listbox"), h.AriaLabel(nameOf(model.location))],
        items.map((node) =>
          h.button(
            [h.Class("ex-phone-item"), h.Role("option"), h.AriaSelected(false), h.OnClick(Message.OpenedItem({ path: node.path }))],
            [icon(h, node, 32), h.span([h.Class("ex-phone-name")], [node.name]), h.span([h.Class("ex-phone-size")], [sizeText(node)])],
          ),
        ),
      ),
    ],
  )

export const view = Submodel.defineView<Model, Message, ViewInputs>((model, inputs, h) => {
  const items = visibleItems(model)
  if (inputs.form === "Phone") return phoneView(h, model, items)
  return h.div(
    [h.Class("explorer")],
    [
      h.div([h.Class("ex-top")], [navButtons(h, model), addressBar(h, model), searchBox(h, model)]),
      commandBar(h, model),
      h.div(
        [h.Class("ex-body")],
        [
          navigationPane(h, model),
          h.div(
            [h.Class("ex-content")],
            [
              infoBar(h, model),
              h.div(
                [h.Class("ex-list"), h.OnClick(Message.ClickedBackground())],
                [
                  items.length === 0
                    ? h.p([h.Class("ex-empty")], [model.query === "" ? "This folder is empty." : "No items match your search."])
                    : model.layout === "Details"
                      ? detailsView(h, model, items)
                      : iconsView(h, model, items),
                ],
              ),
            ],
          ),
          model.isPreviewShown ? previewPane(h, model) : h.empty,
        ],
      ),
      detailsPane(h, model, items),
      statusBar(h, model, items),
    ],
  )
})

