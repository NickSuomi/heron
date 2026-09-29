import { Array, Effect, Option, Schema } from "effect"
import { Mount, Submodel, type Update } from "foldkit"
import type { Html, HtmlBuilder } from "foldkit/html"
import { defineMessageUnion } from "foldkit/message"
import { taggedStruct } from "foldkit/schema"
import { modifyFields } from "foldkit/struct"

import { FilePath, type VfsFile } from "../domain/vfs"

// The simplest app, and the pattern for the others: its own Model, Messages, update and view,
// embedded by the shell with `h.submodel`, talking back through an OutMessage.

export const MenuName = Schema.Literals(["File", "Edit", "Format", "View", "Help"])
export type MenuName = typeof MenuName.Type

export const Model = taggedStruct("Notepad", {
  maybePath: Schema.Option(FilePath),
  name: Schema.String,
  text: Schema.String,
  isWordWrap: Schema.Boolean,
  maybeOpenMenu: Schema.Option(MenuName),
})
export type Model = typeof Model.Type

export const Message = defineMessageUnion({
  ClickedMenu: { menu: MenuName },
  HoveredMenu: { menu: MenuName },
  ClosedMenu: {},
  ToggledWordWrap: {},
  ClickedExit: {},
  UpdatedText: { value: Schema.String },
  CompletedLoadText: {},
})
export type Message = typeof Message.Type

/**
 * Puts the file's text into the page once, when it mounts. The page is uncontrolled: foldkit writes a controlled
 * `value` back on every render, and a clock tick that renders between a keystroke and its input message would drop it.
 */
const LoadText = Mount.define("LoadNotepadText", {
  args: { text: Schema.String },
  messages: [Message.CompletedLoadText],
  execute: ({ text, element }) =>
    Effect.sync(() => {
      if (element instanceof HTMLTextAreaElement) element.value = text
      return Message.CompletedLoadText()
    }),
})

export const OutMessage = defineMessageUnion({ RequestedClose: {} })
export type OutMessage = typeof OutMessage.Type

export const init = (maybeFile: Option.Option<VfsFile>): Model =>
  Model({
    maybePath: Option.map(maybeFile, (file) => file.path),
    name: Option.match(maybeFile, { onNone: () => "Untitled", onSome: (file) => file.name }),
    text: Option.match(maybeFile, { onNone: () => "", onSome: (file) => file.content }),
    isWordWrap: true,
    maybeOpenMenu: Option.none(),
  })

export const title = (model: Model): string => `${model.name} - Notepad`

export const update = (model: Model, message: Message) =>
  Message.match<Update.ReturnWithOutMessage<Model, Message, OutMessage>>(message, {
    ClickedMenu: ({ menu }) => ({
      model: modifyFields(model, {
        maybeOpenMenu: (open) => (Option.contains(open, menu) ? Option.none() : Option.some(menu)),
      }),
    }),
    HoveredMenu: ({ menu }) => ({
      model: modifyFields(model, { maybeOpenMenu: (open) => Option.map(open, () => menu) }),
    }),
    ClosedMenu: () => ({ model: modifyFields(model, { maybeOpenMenu: () => Option.none() }) }),
    ToggledWordWrap: () => ({
      model: modifyFields(model, { isWordWrap: (wrap) => !wrap, maybeOpenMenu: () => Option.none() }),
    }),
    ClickedExit: () => ({
      model: modifyFields(model, { maybeOpenMenu: () => Option.none() }),
      outMessage: OutMessage.RequestedClose(),
    }),
    UpdatedText: ({ value }) => ({ model: modifyFields(model, { text: () => value }) }),
    CompletedLoadText: () => ({ model }),
  })

type MenuItem = Readonly<{ label: string; shortcut?: string; maybeMessage: Option.Option<Message>; isChecked?: boolean }>
type MenuEntry = MenuItem | "separator"

const menus = (model: Model): Record<MenuName, ReadonlyArray<MenuEntry>> => ({
  File: [
    { label: "New", shortcut: "Ctrl+N", maybeMessage: Option.none() },
    { label: "Open...", shortcut: "Ctrl+O", maybeMessage: Option.none() },
    { label: "Save", shortcut: "Ctrl+S", maybeMessage: Option.none() },
    { label: "Save As...", maybeMessage: Option.none() },
    "separator",
    { label: "Exit", maybeMessage: Option.some(Message.ClickedExit()) },
  ],
  Edit: [
    { label: "Undo", shortcut: "Ctrl+Z", maybeMessage: Option.none() },
    "separator",
    { label: "Cut", shortcut: "Ctrl+X", maybeMessage: Option.none() },
    { label: "Copy", shortcut: "Ctrl+C", maybeMessage: Option.none() },
    { label: "Paste", shortcut: "Ctrl+V", maybeMessage: Option.none() },
  ],
  Format: [
    { label: "Word Wrap", maybeMessage: Option.some(Message.ToggledWordWrap()), isChecked: model.isWordWrap },
    { label: "Font...", maybeMessage: Option.none() },
  ],
  View: [{ label: "Status Bar", maybeMessage: Option.none() }],
  Help: [{ label: "About Notepad", maybeMessage: Option.none() }],
})

const menuItemView = (h: HtmlBuilder<Message>, entry: MenuEntry): Html =>
  entry === "separator"
    ? h.div([h.Class("menu-separator"), h.Role("separator")])
    : h.button(
        [
          h.Class(`menu-item${entry.isChecked ? " is-checked" : ""}`),
          h.Role(entry.isChecked === undefined ? "menuitem" : "menuitemcheckbox"),
          ...(entry.isChecked === undefined ? [] : [h.AriaChecked(entry.isChecked )]),
          ...Option.match(entry.maybeMessage, {
            onNone: () => [h.Disabled(true)],
            onSome: (message) => [h.OnClick(message)],
          }),
        ],
        [h.span([h.Class("menu-label")], [entry.label]), h.span([h.Class("menu-shortcut")], [entry.shortcut ?? ""])],
      )

export const view = Submodel.defineView<Model, Message>((model, h) => {
  const menuBar = h.div(
    [h.Class("menubar"), h.Role("menubar")],
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
            ? h.div([h.Class("menu-popup"), h.Role("menu")], Array.map(menus(model)[menu], (entry) => menuItemView(h, entry)))
            : h.empty,
        ],
     ),
   ),
  )
  return h.div(
    [h.Class("notepad")],
    [
      menuBar,
      h.textarea([
        h.Class(`notepad-text${model.isWordWrap ? "" : " is-nowrap"}`),
        h.AriaLabel(title(model)),
        h.Spellcheck(false),
        h.OnMount(LoadText({ text: model.text })),
        h.OnInput((value) => Message.UpdatedText({ value })),
        h.OnFocus(Message.ClosedMenu()),
      ]),
    ],
  )
})
