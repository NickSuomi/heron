import "./studio.css"

import { Array, Effect, Option, pipe, Schema } from "effect"
import { Command, Mount, Submodel, type Update } from "foldkit"
import type { Attribute, Html, HtmlBuilder } from "foldkit/html"
import { defineMessageUnion } from "foldkit/message"
import { taggedStruct } from "foldkit/schema"

import { type Finding, mr42 } from "../data/mr42"
import { Delivery, describeEvent, eventsOf, progressOf, type Review } from "../domain/review"
import { children, FilePath, lookup, lookupFile, storefrontPath, type VfsFile, type VfsNode } from "../domain/vfs"
import { highlight, languageOf, type Token } from "./highlight"
import { advisoryIcon, blockerIcon, fileIcon, folderIcon, infoIcon, projectIcon, solutionIcon, toolbarIcons } from "./studioIcons"

// Heron Studio: a code editor in the manner of a 2008 IDE. It opens the merge request's files and Heron's own
// source, lets the visitor type, and never saves. Once the shared review is Done, Heron's findings show as red
// (blocker) and blue (advisory) squiggles and in the Error List.

export const Tab = Schema.Struct({ path: FilePath, name: Schema.String, text: Schema.String, isDirty: Schema.Boolean })
export type Tab = typeof Tab.Type

export const MenuName = Schema.Literals(["File", "Edit", "View", "Heron", "Tools", "Window", "Help"])
export type MenuName = typeof MenuName.Type

export const Panel = Schema.Literals(["ErrorList", "Output"])
export type Panel = typeof Panel.Type

export const Model = taggedStruct("Studio", {
  tabs: Schema.Array(Tab),
  maybeActive: Schema.Option(FilePath),
  expanded: Schema.Array(Schema.String),
  maybeOpenMenu: Schema.Option(MenuName),
  panel: Panel,
  isShowingBlockers: Schema.Boolean,
  isShowingAdvisories: Schema.Boolean,
  maybeSelectedFinding: Schema.Option(Schema.String),
  maybeMarkedLine: Schema.Option(Schema.Number),
  isSaveDialogOpen: Schema.Boolean,
  delivery: Delivery,
})
export type Model = typeof Model.Type

export const Message = defineMessageUnion({
  ClickedMenu: { menu: MenuName },
  HoveredMenu: { menu: MenuName },
  ClosedMenu: {},
  ClickedFolder: { key: Schema.String },
  ClickedFile: { path: FilePath },
  ClickedTab: { path: FilePath },
  ClickedCloseTab: {},
  EditedText: { value: Schema.String },
  PressedSave: {},
  ClosedSaveDialog: {},
  ClickedRun: { delivery: Delivery },
  ChangedDelivery: { delivery: Delivery },
  ClickedPanel: { panel: Panel },
  ToggledBlockers: {},
  ToggledAdvisories: {},
  ClickedFinding: { id: Schema.String },
  CompletedRevealLine: {},
  CompletedLoadText: {},
  ClickedExit: {},
})
export type Message = typeof Message.Type

export const OutMessage = defineMessageUnion({
  RequestedClose: {},
  RequestedReview: { delivery: Delivery },
})
export type OutMessage = typeof OutMessage.Type

export type Context = Readonly<{ windowId: number }>

const solutionItems = "solution-items"
const defaultFile = FilePath.make(`${storefrontPath}/src/projects/archive.ts`)

/** A finding's file in the Heron OS file system: the storefront checkout at the reviewed head. */
export const findingPath = (finding: Finding): FilePath => FilePath.make(`${storefrontPath}/${finding.path}`)

const tabOf = (file: VfsFile): Tab => ({ path: file.path, name: file.name, text: file.content, isDirty: false })

const ancestors = (path: string): ReadonlyArray<string> =>
  path
    .split("/")
    .slice(1, -1)
    .map((_, index, parts) => `/${parts.slice(0, index + 1).join("/")}`)

export const init = (maybeFile: Option.Option<VfsFile>): Model => {
  const file = Option.orElse(maybeFile, () => lookupFile(defaultFile))
  return Model({
    tabs: Option.match(file, { onNone: () => [], onSome: (opened) => [tabOf(opened)] }),
    maybeActive: Option.map(file, (opened) => opened.path),
    expanded: [solutionItems, storefrontPath, `${storefrontPath}/src`, `${storefrontPath}/src/projects`, `${storefrontPath}/src/locales`],
    maybeOpenMenu: Option.none(),
    panel: "ErrorList",
    isShowingBlockers: true,
    isShowingAdvisories: true,
    maybeSelectedFinding: Option.none(),
    maybeMarkedLine: Option.none(),
    isSaveDialogOpen: false,
    delivery: "DryRun",
  })
}

export const title = (model: Model): string =>
  pipe(
    activeTab(model),
    Option.match({ onNone: () => "Heron Studio", onSome: (tab) => `${tab.name}${tab.isDirty ? "*" : ""} - Heron Studio` }),
  )

const activeTab = (model: Model): Option.Option<Tab> =>
  Option.flatMap(model.maybeActive, (path) => Array.findFirst(model.tabs, (tab) => tab.path === path))

const open = (model: Model, path: FilePath): Model => {
  const isOpen = model.tabs.some((tab) => tab.path === path)
  return Option.match(isOpen ? Option.none() : lookupFile(path), {
    onNone: () => ({ ...model, maybeActive: isOpen ? Option.some(path) : model.maybeActive, maybeMarkedLine: Option.none() }),
    onSome: (file) => ({ ...model, tabs: [...model.tabs, tabOf(file)], maybeActive: Option.some(path), maybeMarkedLine: Option.none() }),
  })
}

export const lineId = (windowId: number, line: number): string => `studio-${windowId}-line-${line}`
export const inputId = (windowId: number): string => `studio-${windowId}-input`

/** Puts the caret at the start of a line and scrolls it to the middle of the editor, after the tab has rendered. */
const RevealLine = Command.define("RevealLine", {
  args: { lineId: Schema.String, inputId: Schema.String, offset: Schema.Number },
  messages: [Message.CompletedRevealLine],
  execute: ({ lineId, inputId, offset }) =>
    Effect.promise(() => new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done())))).pipe(
      Effect.map(() => {
        const input = document.getElementById(inputId)
        if (input instanceof HTMLTextAreaElement) {
          input.focus({ preventScroll: true })
          input.setSelectionRange(offset, offset)
        }
        const line = document.getElementById(lineId)
        const scroller = line?.closest(".code-scroll")
        if (line instanceof HTMLElement && scroller instanceof HTMLElement) {
          scroller.scrollTop = Math.max(line.offsetTop - scroller.clientHeight / 2, 0)
        }
        return Message.CompletedRevealLine()
      }),
    ),
})

/**
 * Puts a tab's text into its editor once, when the editor mounts. The editor is uncontrolled: foldkit writes a
 * controlled `value` back on every render, and a clock tick that renders between a keystroke and its input message
 * would drop the keystroke. Each tab gets its own keyed editor, so switching tabs mounts the other tab's text.
 */
const LoadText = Mount.define("LoadStudioText", {
  args: { text: Schema.String },
  messages: [Message.CompletedLoadText],
  execute: ({ text, element }) =>
    Effect.sync(() => {
      if (element instanceof HTMLTextAreaElement) element.value = text
      return Message.CompletedLoadText()
    }),
})

const closeMenu = (model: Model): Model => ({ ...model, maybeOpenMenu: Option.none() })

type Return = Update.ReturnWithOutMessage<Model, Message, OutMessage>

export const update = (model: Model, message: Message, context: Context): Return =>
  Message.match<Return>(message, {
    ClickedMenu: ({ menu }) => ({
      model: { ...model, maybeOpenMenu: Option.contains(model.maybeOpenMenu, menu) ? Option.none() : Option.some(menu) },
    }),
    HoveredMenu: ({ menu }) => ({ model: { ...model, maybeOpenMenu: Option.map(model.maybeOpenMenu, () => menu) } }),
    ClosedMenu: () => ({ model: closeMenu(model) }),
    ClickedFolder: ({ key }) => ({
      model: {
        ...model,
        expanded: model.expanded.includes(key) ? model.expanded.filter((open) => open !== key) : [...model.expanded, key],
      },
    }),
    ClickedFile: ({ path }) => ({ model: open(closeMenu(model), path) }),
    ClickedTab: ({ path }) => ({ model: { ...model, maybeActive: Option.some(path), maybeMarkedLine: Option.none() } }),
    ClickedCloseTab: () => {
      const remaining = model.tabs.filter((tab) => !Option.contains(model.maybeActive, tab.path))
      return { model: { ...closeMenu(model), tabs: remaining, maybeActive: Option.map(Array.last(remaining), (tab) => tab.path) } }
    },
    EditedText: ({ value }) => ({
      model: {
        ...model,
        tabs: model.tabs.map((tab) => (Option.contains(model.maybeActive, tab.path) ? { ...tab, text: value, isDirty: true } : tab)),
      },
    }),
    PressedSave: () => ({ model: { ...closeMenu(model), isSaveDialogOpen: true } }),
    ClosedSaveDialog: () => ({ model: { ...model, isSaveDialogOpen: false } }),
    ClickedRun: ({ delivery }) => ({
      model: { ...closeMenu(model), delivery, panel: "Output" },
      outMessage: OutMessage.RequestedReview({ delivery }),
    }),
    ChangedDelivery: ({ delivery }) => ({ model: { ...model, delivery } }),
    ClickedPanel: ({ panel }) => ({ model: { ...closeMenu(model), panel } }),
    ToggledBlockers: () => ({ model: { ...model, isShowingBlockers: !model.isShowingBlockers } }),
    ToggledAdvisories: () => ({ model: { ...model, isShowingAdvisories: !model.isShowingAdvisories } }),
    ClickedFinding: ({ id }) =>
      pipe(
        Array.findFirst(mr42.findings, (finding) => finding.id === id),
        Option.match({
          onNone: () => ({ model }),
          onSome: (finding) => {
            const path = findingPath(finding)
            const opened = open(model, path)
            const text = Option.match(Array.findFirst(opened.tabs, (tab) => tab.path === path), { onNone: () => "", onSome: (tab) => tab.text })
            const offset = text.split("\n").slice(0, finding.line - 1).reduce((total, line) => total + line.length + 1, 0)
            return {
              model: { ...opened, maybeSelectedFinding: Option.some(id), maybeMarkedLine: Option.some(finding.line) },
              commands: [RevealLine({ lineId: lineId(context.windowId, finding.line), inputId: inputId(context.windowId), offset })],
            }
          },
        }),
      ),
    CompletedRevealLine: () => ({ model }),
    CompletedLoadText: () => ({ model }),
    ClickedExit: () => ({ model: closeMenu(model), outMessage: OutMessage.RequestedClose() }),
  })

/** When a run ends, the Error List comes forward, as an IDE shows it after a build. */
export const settle = (model: Model): Model => ({ ...model, panel: "ErrorList" })

// View

export type ViewInputs = Readonly<{ review: Review; windowId: number; isPhone: boolean }>

type H = HtmlBuilder<Message>

const visibleFindings = (review: Review): ReadonlyArray<Finding> => (review._tag === "Done" ? mr42.findings : [])

type MenuItem = Readonly<{ label: string; shortcut?: string; maybeMessage: Option.Option<Message> }>
type MenuEntry = MenuItem | "separator"

const item = (label: string, message?: Message, shortcut?: string): MenuItem => ({ label, shortcut, maybeMessage: Option.fromUndefinedOr(message) })

const menus = (isRunning: boolean): Record<MenuName, ReadonlyArray<MenuEntry>> => ({
  File: [item("New Project...", undefined, "Ctrl+Shift+N"), item("Open File...", undefined, "Ctrl+O"), "separator", item("Close", Message.ClickedCloseTab()), item("Save", Message.PressedSave(), "Ctrl+S"), item("Save All", Message.PressedSave(), "Ctrl+Shift+S"), "separator", item("Exit", Message.ClickedExit())],
  Edit: [item("Undo", undefined, "Ctrl+Z"), item("Redo", undefined, "Ctrl+Y"), "separator", item("Cut", undefined, "Ctrl+X"), item("Copy", undefined, "Ctrl+C"), item("Paste", undefined, "Ctrl+V")],
  View: [item("Solution Explorer", undefined, "Ctrl+Alt+L"), item("Error List", Message.ClickedPanel({ panel: "ErrorList" }), "Ctrl+\\, E"), item("Output", Message.ClickedPanel({ panel: "Output" }), "Ctrl+Alt+O")],
  Heron: [
    item("Run Heron (dry run)", isRunning ? undefined : Message.ClickedRun({ delivery: "DryRun" }), "F5"),
    item("Run Heron and Post the Note", isRunning ? undefined : Message.ClickedRun({ delivery: "Post" }), "Ctrl+F5"),
    "separator",
    item("Approve Merge Request"),
    item("Merge"),
  ],
  Tools: [item("Options...")],
  Window: [item("Close All Documents")],
  Help: [item("About Heron Studio")],
})

const menuItemView = (h: H, entry: MenuEntry): Html =>
  entry === "separator"
    ? h.div([h.Class("menu-separator"), h.Role("separator")])
    : h.button(
        [
          h.Class("menu-item"),
          h.Role("menuitem"),
          ...Option.match(entry.maybeMessage, { onNone: () => [h.Disabled(true)], onSome: (message) => [h.OnClick(message)] }),
        ],
        [h.span([h.Class("menu-label")], [entry.label]), h.span([h.Class("menu-shortcut")], [entry.shortcut ?? ""])],
      )

const menuBar = (model: Model, h: H, isRunning: boolean): Html =>
  h.div(
    [h.Class("menubar studio-menubar"), h.Role("menubar")],
    MenuName.literals.map((menu) =>
      h.div(
        [h.Class("menubar-slot")],
        [
          h.button(
            [
              h.Class(`menubar-item${Option.contains(model.maybeOpenMenu, menu) ? " is-open" : ""}`),
              h.AriaHasPopup("menu"),
              h.AriaExpanded(Option.contains(model.maybeOpenMenu, menu)),
              h.OnClick(Message.ClickedMenu({ menu })),
              h.OnMouseEnter(Message.HoveredMenu({ menu })),
            ],
            [menu],
          ),
          Option.contains(model.maybeOpenMenu, menu)
            ? h.div([h.Class("menu-popup"), h.Role("menu")], menus(isRunning)[menu].map((entry) => menuItemView(h, entry)))
            : h.empty,
        ],
      ),
    ),
  )

const toolButton = (h: H, icon: string, label: string, maybeMessage: Option.Option<Message>, text?: string): Html =>
  h.button(
    [
      h.Class(`tool-button${text === undefined ? "" : " has-text"}`),
      h.Title(label),
      h.AriaLabel(label),
      ...Option.match(maybeMessage, { onNone: () => [h.Disabled(true)], onSome: (message) => [h.OnClick(message)] }),
    ],
    [h.img([h.Src(icon), h.Alt("")]), ...(text === undefined ? [] : [h.span([], [text])])],
  )

const toolbar = (model: Model, h: H, isRunning: boolean): Html =>
  h.div(
    [h.Class("studio-toolbar"), h.Role("toolbar")],
    [
      h.span([h.Class("tool-gripper"), h.AriaHidden(true)]),
      toolButton(h, toolbarIcons.newItem, "New Project", Option.none()),
      toolButton(h, toolbarIcons.open, "Open File", Option.none()),
      toolButton(h, toolbarIcons.save, "Save (Ctrl+S)", Option.some(Message.PressedSave())),
      toolButton(h, toolbarIcons.saveAll, "Save All", Option.some(Message.PressedSave())),
      h.span([h.Class("tool-separator")]),
      toolButton(h, toolbarIcons.cut, "Cut", Option.none()),
      toolButton(h, toolbarIcons.copy, "Copy", Option.none()),
      toolButton(h, toolbarIcons.paste, "Paste", Option.none()),
      h.span([h.Class("tool-separator")]),
      toolButton(h, toolbarIcons.undo, "Undo", Option.none()),
      toolButton(h, toolbarIcons.redo, "Redo", Option.none()),
      h.span([h.Class("tool-separator")]),
      toolButton(
        h,
        toolbarIcons.run,
        model.delivery === "DryRun" ? "Run Heron with --dry-run (F5)" : "Run Heron and post the note",
        isRunning ? Option.none() : Option.some(Message.ClickedRun({ delivery: model.delivery })),
        "Run Heron",
      ),
      h.select(
        [
          h.Class("tool-combo"),
          h.AriaLabel("Delivery"),
          h.Disabled(isRunning),
          h.OnChange((value) => Message.ChangedDelivery({ delivery: value === "Post" ? "Post" : "DryRun" })),
        ],
        [
          h.option([h.Value("DryRun"), h.Selected(model.delivery === "DryRun")], ["--dry-run"]),
          h.option([h.Value("Post"), h.Selected(model.delivery === "Post")], ["Post the note"]),
        ],
      ),
      h.span([h.Class("tool-separator")]),
      toolButton(h, toolbarIcons.solution, "Solution Explorer", Option.none()),
      toolButton(h, toolbarIcons.errorList, "Error List", Option.some(Message.ClickedPanel({ panel: "ErrorList" }))),
      toolButton(h, toolbarIcons.output, "Output", Option.some(Message.ClickedPanel({ panel: "Output" }))),
    ],
  )

// Solution Explorer

const treeRow = (
  h: H,
  depth: number,
  icon: string,
  label: string,
  attributes: ReadonlyArray<Attribute<Message>>,
  toggle: "open" | "closed" | "none",
  modifier = "",
): Html =>
  h.div(
    [h.Class(`tree-row${modifier === "" ? "" : ` ${modifier}`}`), h.Style({ "padding-left": `${4 + depth * 16}px` }), ...attributes],
    [
      h.span([h.Class(`tree-toggle is-${toggle}`), h.AriaHidden(true)]),
      h.img([h.Class("tree-icon"), h.Src(icon), h.Alt("")]),
      h.span([h.Class("tree-label")], [label]),
    ],
  )

const treeNode = (model: Model, h: H, node: VfsNode, depth: number): ReadonlyArray<Html> => {
  if (node._tag === "Folder") {
    const isOpen = model.expanded.includes(node.path)
    return [
      treeRow(h, depth, folderIcon(isOpen), node.name, [h.OnClick(Message.ClickedFolder({ key: node.path })), h.AriaExpanded(isOpen), h.Role("treeitem")], isOpen ? "open" : "closed"),
      ...(isOpen ? sortedChildren(node.path).flatMap((child) => treeNode(model, h, child, depth + 1)) : []),
    ]
  }
  if (node._tag === "File")
    return [
      treeRow(
        h,
        depth,
        fileIcon(node.name),
        node.name,
        [h.OnClick(Message.ClickedFile({ path: node.path })), h.Role("treeitem")],
        "none",
        Option.contains(model.maybeActive, node.path) ? "is-selected" : "",
      ),
    ]
  return []
}

const sortedChildren = (path: FilePath): ReadonlyArray<VfsNode> =>
  [...children(path)].sort((a, b) => (a._tag === b._tag ? a.name.localeCompare(b.name) : a._tag === "Folder" ? -1 : 1))

const project = (model: Model, h: H, path: FilePath, label: string): ReadonlyArray<Html> => {
  const isOpen = model.expanded.includes(path)
  return [
    treeRow(h, 1, projectIcon, label, [h.OnClick(Message.ClickedFolder({ key: path })), h.AriaExpanded(isOpen), h.Role("treeitem")], isOpen ? "open" : "closed", "is-project"),
    ...(isOpen ? sortedChildren(path).flatMap((child) => treeNode(model, h, child, 2)) : []),
  ]
}

const solutionExplorer = (model: Model, h: H): Html => {
  const itemsOpen = model.expanded.includes(solutionItems)
  const items = Array.getSomes([lookup(FilePath.make("/Desktop/merge-request-42.diff")), lookup(FilePath.make("/Desktop/heron.config.json"))])
  return h.section(
    [h.Class("tool-window studio-explorer"), h.AriaLabel("Solution Explorer")],
    [
      h.header([h.Class("tool-caption is-active")], [h.span([], ["Solution Explorer"]), h.span([h.Class("tool-pin"), h.AriaHidden(true)])]),
      h.div(
        [h.Class("tree"), h.Role("tree")],
        [
          treeRow(h, 0, solutionIcon, "Solution 'storefront' (2 projects)", [], "none", "is-solution"),
          treeRow(h, 1, folderIcon(itemsOpen), "Solution Items", [h.OnClick(Message.ClickedFolder({ key: solutionItems })), h.Role("treeitem")], itemsOpen ? "open" : "closed"),
          ...(itemsOpen ? items.flatMap((node) => treeNode(model, h, node, 2)) : []),
          ...project(model, h, FilePath.make(storefrontPath), `storefront (!${mr42.iid}, fictional)`),
          ...project(model, h, FilePath.make("/Heron"), "Heron (read-only)"),
        ],
      ),
    ],
  )
}

// The document well

const tabStrip = (model: Model, h: H): Html =>
  h.div(
    [h.Class("doc-tabs"), h.Role("tablist")],
    [
      ...model.tabs.map((tab) =>
        h.button(
          [
            h.Class(`doc-tab${Option.contains(model.maybeActive, tab.path) ? " is-active" : ""}`),
            h.Role("tab"),
            h.AriaSelected(Option.contains(model.maybeActive, tab.path)),
            h.Title(tab.path),
            h.OnClick(Message.ClickedTab({ path: tab.path })),
          ],
          [`${tab.name}${tab.isDirty ? "*" : ""}`],
        ),
      ),
      h.span([h.Class("doc-tabs-fill")]),
      h.button([h.Class("doc-tabs-close"), h.AriaLabel("Close document"), h.Title("Close"), h.OnClick(Message.ClickedCloseTab())], []),
    ],
  )

type Mark = Readonly<{ finding: Finding; line: number; column: number; length: number }>

const marksFor = (tab: Tab, findings: ReadonlyArray<Finding>): ReadonlyArray<Mark> => {
  const lines = tab.text.split("\n")
  // Findings describe the reviewed head. After the visitor edits, a squiggle follows its excerpt to the nearest
  // line that still holds it, and disappears when no line does.
  return findings
    .filter((finding) => findingPath(finding) === tab.path)
    .flatMap((finding): ReadonlyArray<Mark> => {
      const nearest = lines.reduce<number | undefined>(
        (best, text, index) =>
          text.includes(finding.excerpt) && (best === undefined || Math.abs(index + 1 - finding.line) < Math.abs(best - finding.line)) ? index + 1 : best,
        undefined,
      )
      return nearest === undefined
        ? []
        : [{ finding, line: nearest, column: (lines[nearest - 1] ?? "").indexOf(finding.excerpt), length: finding.excerpt.length }]
    })
}

const tokenClass = (token: Token): string => (token.kind === "plain" ? "" : `tk-${token.kind}`)

const severityWord = (finding: Finding) => (finding.severity === "blocker" ? "Blocker" : "Advisory")

const markView = (h: H, mark: Mark): Html =>
  h.span(
    [
      h.Class(`squiggle is-${mark.finding.severity}`),
      h.Style({ top: `${(mark.line - 1) * 16}px`, left: `${mark.column}ch`, width: `${mark.length}ch` }),
      h.OnClick(Message.ClickedFinding({ id: mark.finding.id })),
    ],
    [
      h.span(
        [h.Class("squiggle-tip"), h.Role("tooltip")],
        [
          h.img([h.Src(mark.finding.severity === "blocker" ? blockerIcon : advisoryIcon), h.Alt("")]),
          h.span(
            [],
            [
              h.strong([], [`${severityWord(mark.finding)} (${mark.finding.gate}): `]),
              mark.finding.title,
              h.span([h.Class("squiggle-tip-body")], [mark.finding.body]),
            ],
          ),
        ],
      ),
    ],
  )

const codeView = (model: Model, h: H, tab: Tab, review: Review, windowId: number): Html => {
  const lines = highlight(tab.text, languageOf(tab.name))
  const columns = Math.max(...tab.text.split("\n").map((line) => line.length), 40)
  const marks = marksFor(tab, visibleFindings(review))
  const marked = new Map(marks.map((mark) => [mark.line, mark.finding.severity]))
  return h.div(
    [h.Class("code-scroll")],
    [
      h.div(
        [h.Class("code-gutter"), h.AriaHidden(true)],
        lines.map((_, index) =>
          h.div([h.Class(`gutter-line${marked.has(index + 1) ? ` has-${marked.get(index + 1)}` : ""}`)], [String(index + 1)]),
        ),
      ),
      h.div(
        [h.Class("code-body"), h.Style({ width: `calc(${columns + 2}ch + 8px)`, height: `${lines.length * 16 + 4}px` })],
        [
          h.pre(
            [h.Class("code-highlight"), h.AriaHidden(true)],
            lines.map((tokens, index) =>
              h.div(
                [h.Id(lineId(windowId, index + 1)), h.Class(`code-line${Option.contains(model.maybeMarkedLine, index + 1) ? " is-marked" : ""}`)],
                tokens.length === 0 ? ["​"] : tokens.map((token) => (tokenClass(token) === "" ? token.text : h.span([h.Class(tokenClass(token))], [token.text]))),
              ),
            ),
          ),
          h.keyed("textarea")(`${windowId}:${tab.path}`, [
            h.Id(inputId(windowId)),
            h.Class("code-input"),
            h.AriaLabel(`${tab.name} editor`),
            h.Spellcheck(false),
            h.Wrap("off"),
            h.Autocomplete("off"),
            h.OnMount(LoadText({ text: tab.text })),
            h.OnInput((value) => Message.EditedText({ value })),
            h.OnFocus(Message.ClosedMenu()),
            h.OnKeyDownPreventDefault((key, modifiers) => (modifiers.ctrlKey && key.toLowerCase() === "s" ? Option.some(Message.PressedSave()) : Option.none())),
          ]),
          h.div([h.Class("code-marks")], marks.map((mark) => markView(h, mark))),
        ],
      ),
    ],
  )
}

const emptyWell = (h: H): Html =>
  h.div([h.Class("doc-empty")], [h.p([], ["Open a file from Solution Explorer."])])

// Error List and Output

const errorList = (model: Model, h: H, review: Review): Html => {
  const findings = visibleFindings(review)
  const blockers = findings.filter((finding) => finding.severity === "blocker")
  const advisories = findings.filter((finding) => finding.severity === "advisory")
  const shown = findings.filter((finding) => (finding.severity === "blocker" ? model.isShowingBlockers : model.isShowingAdvisories))
  const toggle = (isOn: boolean, icon: string, label: string, message: Message) =>
    h.button([h.Class(`list-toggle${isOn ? " is-on" : ""}`), h.AriaPressed(isOn ? "true" : "false"), h.OnClick(message)], [h.img([h.Src(icon), h.Alt("")]), label])
  return h.div(
    [h.Class("error-list")],
    [
      h.div(
        [h.Class("error-list-bar")],
        [
          toggle(model.isShowingBlockers, blockerIcon, `${blockers.length} Blocker${blockers.length === 1 ? "" : "s"}`, Message.ToggledBlockers()),
          h.span([h.Class("tool-separator")]),
          toggle(model.isShowingAdvisories, advisoryIcon, `${advisories.length} Advisor${advisories.length === 1 ? "y" : "ies"}`, Message.ToggledAdvisories()),
        ],
      ),
      h.table(
        [h.Class("error-grid")],
        [
          h.thead([], [h.tr([], ["", "", "Description", "File", "Line", "Gate"].map((heading) => h.th([], [heading])))]),
          h.tbody(
            [],
            shown.length === 0
              ? [
                  h.tr(
                    [h.Class("is-hint")],
                    [
                      h.td([h.Colspan(6)], [
                        review._tag === "Done" ? "No findings are shown. Turn on Blockers or Advisories above." : review._tag === "Running" ? "Heron is reviewing merge request !42..." : "Run Heron to review merge request !42 (a fictional example).",
                      ]),
                    ],
                  ),
                ]
              : shown.map((finding) =>
                  h.tr(
                    [
                      h.Class(Option.contains(model.maybeSelectedFinding, finding.id) ? "is-selected" : ""),
                      h.OnClick(Message.ClickedFinding({ id: finding.id })),
                      h.Title(finding.body),
                    ],
                    [
                      h.td([h.Class("cell-icon")], [h.img([h.Src(finding.severity === "blocker" ? blockerIcon : advisoryIcon), h.Alt(severityWord(finding))])]),
                      h.td([h.Class("cell-number")], [String(mr42.findings.indexOf(finding) + 1)]),
                      h.td([h.Class("cell-description")], [finding.title]),
                      h.td([], [finding.path.slice(finding.path.lastIndexOf("/") + 1)]),
                      h.td([h.Class("cell-number")], [String(finding.line)]),
                      h.td([], [finding.gate]),
                    ],
                  ),
                ),
          ),
        ],
      ),
    ],
  )
}

const outputLines = (review: Review): ReadonlyArray<string> => {
  if (review._tag === "Idle") return ["Heron Studio is ready. Press Run Heron to review merge request !42."]
  const header = `------ Review started: ${mr42.project} !${mr42.iid}, ${review.delivery === "DryRun" ? "--dry-run" : "posting the note"} ------`
  const lines = eventsOf(review).map(describeEvent)
  if (review._tag === "Running") return [header, ...lines]
  const blockers = mr42.findings.filter((finding) => finding.severity === "blocker").length
  return [header, ...lines, `========== Review: ${review.verdict}, ${blockers} blocker, ${mr42.findings.length - blockers} advisories ==========`]
}

const bottomPanel = (model: Model, h: H, review: Review): Html =>
  h.section(
    [h.Class("tool-window studio-bottom")],
    [
      h.header([h.Class("tool-caption")], [h.span([], [model.panel === "ErrorList" ? "Error List" : "Output"]), h.span([h.Class("tool-pin"), h.AriaHidden(true)])]),
      model.panel === "ErrorList" ? errorList(model, h, review) : h.pre([h.Class("output-text")], [outputLines(review).join("\n")]),
      h.div(
        [h.Class("panel-tabs"), h.Role("tablist")],
        Panel.literals.map((panel) =>
          h.button(
            [h.Class(`panel-tab${model.panel === panel ? " is-active" : ""}`), h.Role("tab"), h.AriaSelected(model.panel === panel), h.OnClick(Message.ClickedPanel({ panel }))],
            [h.img([h.Src(panel === "ErrorList" ? toolbarIcons.errorList : toolbarIcons.output), h.Alt("")]), panel === "ErrorList" ? "Error List" : "Output"],
          ),
        ),
      ),
    ],
  )

const statusText = (review: Review): string => {
  if (review._tag === "Idle") return "Ready"
  if (review._tag === "Done") return `Heron: ${review.verdict}`
  const last = Array.last(review.events)
  return Option.match(last, { onNone: () => "Heron: starting...", onSome: (event) => `Heron: ${describeEvent(event).replace(/\s+/g, " ")}` })
}

const saveDialog = (h: H): Html =>
  h.div(
    [h.Class("studio-modal")],
    [
      h.div(
        [h.Class("task-dialog"), h.Role("alertdialog"), h.AriaLabel("Heron Studio")],
        [
          h.div([h.Class("task-dialog-title")], [h.span([], ["Heron Studio"]), h.button([h.Class("task-dialog-x"), h.AriaLabel("Close"), h.OnClick(Message.ClosedSaveDialog())], [])]),
          h.div(
            [h.Class("task-dialog-body")],
            [
              h.img([h.Class("task-dialog-icon"), h.Src(infoIcon), h.Alt("")]),
              h.div(
                [],
                [
                  h.p([h.Class("task-dialog-main")], ["Heron never edits code"]),
                  h.p([], ["Heron reads a merge request at one commit and writes one note. It does not change files, push, approve or merge."]),
                  h.p([], ["Your typing stays in this window and is not saved."]),
                ],
              ),
            ],
          ),
          h.div([h.Class("task-dialog-footer")], [h.button([h.Class("vista-button"), h.OnClick(Message.ClosedSaveDialog()), h.Autofocus(true)], ["OK"])]),
        ],
      ),
    ],
  )

// Windows Mobile: a full-screen viewer for the merge request's files, with the findings under the code.

const phoneView = (model: Model, h: H, review: Review, windowId: number): Html => {
  const isRunning = review._tag === "Running"
  const findings = visibleFindings(review)
  return h.div(
    [h.Class("studio-phone")],
    [
      h.div(
        [h.Class("wm-studio-bar")],
        [
          h.select(
            [h.Class("wm-combo"), h.AriaLabel("File"), h.OnChange((value) => Message.ClickedFile({ path: FilePath.make(value) }))],
            [...mr42.files.map((file) => FilePath.make(`${storefrontPath}/${file.path}`)), ...model.tabs.map((tab) => tab.path)]
              .filter((path, index, all) => all.indexOf(path) === index)
              .map((path) => h.option([h.Value(path), h.Selected(Option.contains(model.maybeActive, path))], [path.slice(path.lastIndexOf("/") + 1)])),
          ),
          h.button([h.Class("wm-button"), h.Disabled(isRunning), h.OnClick(Message.ClickedRun({ delivery: "DryRun" }))], [isRunning ? "Reviewing..." : "Run Heron"]),
        ],
      ),
      Option.match(activeTab(model), { onNone: () => emptyWell(h), onSome: (tab) => h.div([h.Class("wm-code")], [codeView(model, h, tab, review, windowId)]) }),
      h.div(
        [h.Class("wm-findings")],
        [
          h.p([h.Class("wm-findings-title")], [review._tag === "Done" ? `Heron: ${review.verdict}` : statusText(review)]),
          ...findings.map((finding) =>
            h.button(
              [h.Class("wm-finding"), h.OnClick(Message.ClickedFinding({ id: finding.id }))],
              [
                h.img([h.Src(finding.severity === "blocker" ? blockerIcon : advisoryIcon), h.Alt(severityWord(finding))]),
                h.span([], [h.strong([], [finding.title]), h.span([h.Class("wm-finding-where")], [`${finding.path.slice(finding.path.lastIndexOf("/") + 1)}:${finding.line}`])]),
              ],
            ),
          ),
        ],
      ),
      model.isSaveDialogOpen ? saveDialog(h) : h.empty,
    ],
  )
}

export const view = Submodel.defineView<Model, Message, ViewInputs>((model, { review, windowId, isPhone }, h): Html => {
  if (isPhone) return phoneView(model, h, review, windowId)
  const isRunning = review._tag === "Running"
  return h.div(
    [h.Class("studio")],
    [
      menuBar(model, h, isRunning),
      toolbar(model, h, isRunning),
      h.div(
        [h.Class("studio-main"), h.OnClick(Message.ClosedMenu())],
        [
          h.section(
            [h.Class("doc-well")],
            [tabStrip(model, h), Option.match(activeTab(model), { onNone: () => emptyWell(h), onSome: (tab) => codeView(model, h, tab, review, windowId) })],
          ),
          bottomPanel(model, h, review),
          solutionExplorer(model, h),
        ],
      ),
      h.footer(
        [h.Class(`studio-status${isRunning ? " is-busy" : ""}`)],
        [
          ...(isRunning
            ? [h.span([h.Class("status-progress"), h.Role("progressbar")], [h.span([h.Class("status-progress-fill"), h.Style({ width: `${Math.round(progressOf(review) * 100)}%` })])])]
            : []),
          h.span([h.Class("status-text")], [statusText(review)]),
          h.span([h.Class("status-cell")], [Option.match(model.maybeMarkedLine, { onNone: () => "Ln 1", onSome: (line) => `Ln ${line}` })]),
          h.span([h.Class("status-cell")], ["Col 1"]),
          h.span([h.Class("status-cell")], ["INS"]),
        ],
      ),
      model.isSaveDialogOpen ? saveDialog(h) : h.empty,
    ],
  )
})
