import { Array, Option, pipe, Record, Schema } from "effect"
import { heronPaths } from "virtual:heron-files"

import { mr42 } from "../data/mr42"

/** An absolute path in the Heron OS file system, such as `/Desktop/README.txt`. */
export const FilePath = Schema.String.pipe(Schema.brand("FilePath"))
export type FilePath = typeof FilePath.Type

/** What a file is, decided by its extension. Apps declare the types they open. */
export const FileType = Schema.Literals(["Text", "Markdown", "TypeScript", "Vue", "Json", "Diff", "Diagram", "Program", "Folder"])
export type FileType = typeof FileType.Type

export const AppId = Schema.Literals(["notepad", "editor", "diagram", "cmd", "explorer", "browser", "welcome", "dialog", "help"])
export type AppId = typeof AppId.Type

export type VfsFile = Readonly<{ _tag: "File"; path: FilePath; name: string; type: FileType; content: string }>
export type VfsFolder = Readonly<{ _tag: "Folder"; path: FilePath; name: string; children: ReadonlyArray<FilePath> }>
/** A desktop or Start menu entry that starts an app, optionally on a path. */
export type VfsShortcut = Readonly<{ _tag: "Shortcut"; path: FilePath; name: string; app: AppId; maybeTarget: Option.Option<FilePath> }>
export type VfsNode = VfsFile | VfsFolder | VfsShortcut

const extensionTypes: Record<string, FileType> = {
  txt: "Text",
  md: "Markdown",
  ts: "TypeScript",
  vue: "Vue",
  json: "Json",
  css: "Text",
  diff: "Diff",
  vsd: "Diagram",
  exe: "Program",
  bat: "Program",
  lnk: "Program",
}

export const fileTypeOf = (name: string): FileType =>
  pipe(
    name.split("."),
    Array.last,
    Option.flatMap((extension) => Record.get(extensionTypes, extension.toLowerCase())),
    Option.getOrElse(() => "Text" as const),
  )

const path = (value: string): FilePath => FilePath.make(value)
const baseName = (value: string): string => pipe(value.split("/"), Array.last, Option.getOrElse(() => value))
const parentOf = (value: string): string => value.slice(0, Math.max(value.lastIndexOf("/"), 0)) || "/"

// The text of the repository files arrives after the first paint (see `loadFileContents`). A file made with
// `lazyFile` reads its text from that store when asked, so nothing reads it early: the shell holds the boot
// screen until the store is full.
let fileContents: ReadonlyMap<string, string> = new Map()
let areFileContentsLoaded = false

export const loadFileContents = (): Promise<void> =>
  import("virtual:heron-file-contents").then((loaded) => {
    fileContents = new Map([...loaded.heronFiles.map((entry) => [entry.path, entry.content] as const), ["README.txt", loaded.readmeText]])
  }).catch((error: unknown) => {
    // Without the text the folder still lists its files, each empty; say so rather than hold the boot screen forever.
    console.error("Heron OS could not load its file contents", error)
  }).finally(() => {
    areFileContentsLoaded = true
  })

export const fileContentsAreLoaded = (): boolean => areFileContentsLoaded

const file = (at: string, content: string): VfsFile => ({
  _tag: "File",
  path: path(at),
  name: baseName(at),
  type: fileTypeOf(at),
  content,
})

/** A file whose text is `fileContents[key]`, read when the file is used. */
const lazyFile = (at: string, key: string): VfsFile => ({
  ...file(at, ""),
  get content() {
    return fileContents.get(key) ?? ""
  },
})

const shortcut = (at: string, app: AppId, target?: string): VfsShortcut => ({
  _tag: "Shortcut",
  path: path(at),
  name: baseName(at),
  app,
  maybeTarget: Option.map(Option.fromUndefinedOr(target), path),
})

/** Where the fictional acme/storefront repository is checked out, at the head of merge request !42. */
export const storefrontPath = "/storefront"

const leaves: ReadonlyArray<VfsFile | VfsShortcut> = [
  shortcut("/Desktop/Computer", "explorer", "/"),
  shortcut("/Desktop/Heron", "explorer", "/Heron"),
  lazyFile("/Desktop/README.txt", "README.txt"),
  file("/Desktop/How Heron works.vsd", ""),
  file("/Desktop/merge-request-42.diff", mr42.diff),
  lazyFile("/Desktop/heron.config.json", "heron.config.example.json"),
  shortcut("/Desktop/Command Prompt", "cmd"),
  shortcut("/Desktop/Internet Explorer", "browser"),
  shortcut("/Desktop/Recycle Bin", "explorer", "/Recycle Bin"),
  file("/Recycle Bin/approve.exe", ""),
  file("/Recycle Bin/force-push.bat", ""),
  file("/Recycle Bin/merge-without-review.lnk", ""),
  ...heronPaths.map((entry) => lazyFile(`/Heron/${entry}`, entry)),
  // The fictional acme/storefront checkout at the head of merge request !42.
  ...mr42.files.map((changed) => file(`${storefrontPath}/${changed.path}`, changed.after)),
]

const folderPaths = (at: string): ReadonlyArray<string> =>
  at === "/" ? [] : [...folderPaths(parentOf(at)), parentOf(at)]

const buildTree = (entries: ReadonlyArray<VfsFile | VfsShortcut>): Readonly<Record<string, VfsNode>> => {
  const children = new Map<string, Array<FilePath>>()
  const link = (parent: string, child: FilePath) => {
    const list = children.get(parent) ?? []
    if (!list.includes(child)) list.push(child)
    children.set(parent, list)
  }
  for (const entry of entries) {
    const chain = [...folderPaths(entry.path), entry.path]
    chain.forEach((at, index) => index > 0 && link(chain[index - 1] ?? "/", path(at)))
  }
  const folders = Array.fromIterable(children.keys()).map(
    (at): VfsFolder => ({ _tag: "Folder", path: path(at), name: at === "/" ? "Computer" : baseName(at), children: children.get(at) ?? [] }),
  )
  return Object.fromEntries([...entries, ...folders].map((node) => [node.path, node]))
}

const tree = buildTree(leaves)

export const lookup = (at: FilePath): Option.Option<VfsNode> => Record.get(tree, at)

export const children = (at: FilePath): ReadonlyArray<VfsNode> =>
  pipe(
    lookup(at),
    Option.map((node) => (node._tag === "Folder" ? Array.getSomes(node.children.map(lookup)) : [])),
    Option.getOrElse(() => []),
  )

export const lookupFile = (at: FilePath): Option.Option<VfsFile> =>
  Option.filter(lookup(at), (node): node is VfsFile => node._tag === "File")

export const desktopPath = path("/Desktop")
export const readmePath = path("/Desktop/README.txt")

