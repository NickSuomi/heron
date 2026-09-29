import { Array, Match, Option, pipe } from "effect"

import type { Size } from "../domain/geometry"
import { type AppId, type FileType, lookup, type VfsFile, type VfsNode } from "../domain/vfs"
import type { IconName } from "../shell/icons"
import type { AppState } from "./appState"
import * as Diagram from "./diagram"
import * as Dialog from "./dialog"
import * as Explorer from "./explorer"
import * as Help from "./help"
import * as Notepad from "./notepad"
import * as Stub from "./stub"
import * as Welcome from "./welcome"

/**
 * What the shell needs to know about an app before it runs. An app declares the file types it opens
 * in `opens`; the shell picks the first app that declares a file's type when the file is opened.
 * `launch` builds the app's state for a window, given the file or folder it was opened on.
 */
export type AppDefinition = Readonly<{
  id: AppId
  name: string
  icon: IconName
  opens: ReadonlyArray<FileType>
  size: Size
  isSingleInstance: boolean
  launch: (maybeNode: Option.Option<VfsNode>) => AppState
}>

const stub =
  (app: Stub.StubAppId) =>
  (maybeNode: Option.Option<VfsNode>): AppState =>
    Stub.Model({ app, maybePath: Option.map(maybeNode, (node) => node.path) })

const fileOf = (maybeNode: Option.Option<VfsNode>): Option.Option<VfsFile> =>
  Option.filter(maybeNode, (node): node is VfsFile => node._tag === "File")

// `launch` is always a function literal: explorer.ts imports this module, so reading an app module's
// export while this array is built could run before that module has finished loading.
export const apps: ReadonlyArray<AppDefinition> = [
  { id: "notepad", name: "Notepad", icon: "notepad", opens: ["Text", "Markdown"], size: { width: 680, height: 500 }, isSingleInstance: false, launch: (node) => Notepad.init(fileOf(node)) },
  { id: "editor", name: "Heron Studio", icon: "studio", opens: ["TypeScript", "Json", "Diff"], size: { width: 900, height: 600 }, isSingleInstance: false, launch: stub("editor") },
  { id: "diagram", name: "Diagram Viewer", icon: "diagram", opens: ["Diagram"], size: { width: 1120, height: 690 }, isSingleInstance: false, launch: (node) => Diagram.init(node) },
  { id: "cmd", name: "Command Prompt", icon: "cmd", opens: [], size: { width: 680, height: 400 }, isSingleInstance: false, launch: stub("cmd") },
  { id: "explorer", name: "Explorer", icon: "folder", opens: ["Folder"], size: { width: 860, height: 560 }, isSingleInstance: false, launch: (node) => Explorer.init(node) },
  { id: "browser", name: "Internet Explorer", icon: "browser", opens: [], size: { width: 960, height: 640 }, isSingleInstance: false, launch: stub("browser") },
  { id: "welcome", name: "Welcome Center", icon: "welcome", opens: [], size: { width: 700, height: 545 }, isSingleInstance: true, launch: () => Welcome.init() },
  { id: "dialog", name: "Heron OS", icon: "program", opens: ["Program"], size: { width: 480, height: 300 }, isSingleInstance: false, launch: (node) => Dialog.init(node) },
  { id: "help", name: "Help and Support", icon: "help", opens: [], size: { width: 900, height: 620 }, isSingleInstance: true, launch: () => Help.init() },
]

export const definition = (id: AppId): AppDefinition =>
  pipe(
    apps,
    Array.findFirst((app) => app.id === id),
    Option.getOrThrowWith(() => new Error(`no app ${id}`)),
  )

export const appIdOf = (state: AppState): AppId =>
  Match.value(state).pipe(
    Match.tagsExhaustive({
      Notepad: () => "notepad" as const,
      Stub: (model) => model.app,
      Diagram: () => "diagram" as const,
      Explorer: () => "explorer" as const,
      Welcome: () => "welcome" as const,
      Help: () => "help" as const,
      Dialog: () => "dialog" as const,
    }),
  )

export const titleOf = (state: AppState): string =>
  Match.value(state).pipe(
    Match.tagsExhaustive({
      Notepad: Notepad.title,
      Stub: (model) =>
        Option.match(model.maybePath, {
          onNone: () => definition(model.app).name,
          onSome: (path) => `${Option.match(lookup(path), { onNone: () => path, onSome: (node) => node.name })} - ${definition(model.app).name}`,
        }),
      Diagram: Diagram.title,
      Explorer: Explorer.title,
      Welcome: Welcome.title,
      Help: Help.title,
      Dialog: Dialog.title,
    }),
  )

export const iconOf = (state: AppState): IconName => definition(appIdOf(state)).icon

const nodeType = (node: VfsNode): FileType => (node._tag === "File" ? node.type : "Folder")

/** The file-type registry: the first app that declares the type opens it. */
export const openerFor = (type: FileType): Option.Option<AppDefinition> => Array.findFirst(apps, (app) => app.opens.includes(type))

export type Launch = Readonly<{ app: AppDefinition; maybeNode: Option.Option<VfsNode> }>

/** What double-clicking a node starts: a shortcut runs its app, anything else goes through the registry. */
export const launchFor = (node: VfsNode): Option.Option<Launch> =>
  node._tag === "Shortcut"
    ? Option.some({ app: definition(node.app), maybeNode: Option.flatMap(node.maybeTarget, lookup) })
    : Option.map(openerFor(nodeType(node)), (app) => ({ app, maybeNode: Option.some(node) }))

export const iconForNode = (node: VfsNode): IconName =>
  Match.value(node).pipe(
    Match.tagsExhaustive({
      Shortcut: (shortcut) =>
        Match.value(shortcut.name).pipe(
          Match.when("Computer", () => "computer" as const),
          Match.when("Heron", () => "heron-folder" as const),
          Match.when("Recycle Bin", () => "recycle-bin" as const),
          Match.orElse(() => definition(shortcut.app).icon),
        ),
      Folder: () => "folder" as const,
      File: (file) =>
        Match.value(file.type).pipe(
          Match.withReturnType<IconName>(),
          Match.when("Text", () => "text"),
          Match.when("Markdown", () => "text"),
          Match.when("TypeScript", () => "code"),
          Match.when("Json", () => "json"),
          Match.when("Diff", () => "diff"),
          Match.when("Diagram", () => "diagram"),
          Match.when("Program", () => "program"),
          Match.when("Folder", () => "folder"),
          Match.exhaustive,
        ),
    }),
  )

