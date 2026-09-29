import "./cmd.css"

import { Array, Effect, Match, Option, pipe, Queue, Schema, Stream } from "effect"
import { Command, Mount, Submodel, type Update } from "foldkit"
import type { Html } from "foldkit/html"
import { defineMessageUnion } from "foldkit/message"
import { defineTaggedUnion, taggedStruct } from "foldkit/schema"
import { cliOutput } from "virtual:heron-build"

import { cliResult, Delivery, describeEvent, eventsOf, exampleMergeRequestIid, type Review } from "../domain/review"
import { children, FilePath, lookup, type VfsNode } from "../domain/vfs"

// Command Prompt: cmd.exe's look and a handful of its commands over the Heron OS file system, plus `heron`,
// whose output is the real CLI's (captured at build time) and whose review streams the shared review.

/** One block of scrollback. A review's lines come from the shared review until the run ends, then freeze here. */
export const Entry = defineTaggedUnion({
  Lines: { lines: Schema.Array(Schema.String) },
  LiveReview: { run: Schema.Number },
})
export type Entry = typeof Entry.Type

export const Model = taggedStruct("Cmd", {
  cwd: FilePath,
  entries: Schema.Array(Entry),
  input: Schema.String,
  history: Schema.Array(Schema.String),
  maybeHistoryIndex: Schema.Option(Schema.Number),
  maybeRunningCommand: Schema.Option(Schema.String),
  /** The characters the tour still has to type, then Enter. */
  maybeTyping: Schema.Option(Schema.String),
})
export type Model = typeof Model.Type

export const Message = defineMessageUnion({
  UpdatedInput: { value: Schema.String },
  SubmittedLine: { line: Schema.String },
  PressedHistory: { isOlder: Schema.Boolean },
  PressedEscape: {},
  CompletedFocusInput: {},
  CompletedSyncInput: {},
  StartedTyping: { text: Schema.String },
  TypedKey: {},
})
export type Message = typeof Message.Type

/**
 * Takes the keyboard when the window opens, as cmd.exe does, and owns Enter and Esc on the command line. They read
 * and clear the field inside the key event itself: the message queue can hand the next keystrokes to the field
 * before `update` sees Enter, so clearing it later from `update` would eat them or keep the entered line.
 */
const CommandLine = Mount.defineStream("CmdCommandLine", {
  messages: [Message.CompletedFocusInput, Message.SubmittedLine, Message.PressedEscape],
  execute: ({ element }) =>
    Stream.callback<Extract<Message, { _tag: "CompletedFocusInput" | "SubmittedLine" | "PressedEscape" }>>((queue) =>
      Effect.acquireRelease(
        Effect.sync(() => {
          if (!(element instanceof HTMLInputElement)) return () => {}
          const onKeyDown = (event: KeyboardEvent) => {
            if (event.isComposing || (event.key !== "Enter" && event.key !== "Escape")) return
            event.preventDefault()
            const line = element.value
            element.value = ""
            Queue.offerUnsafe(queue, event.key === "Enter" ? Message.SubmittedLine({ line }) : Message.PressedEscape())
          }
          element.addEventListener("keydown", onKeyDown)
          element.focus({ preventScroll: true })
          Queue.offerUnsafe(queue, Message.CompletedFocusInput())
          return () => element.removeEventListener("keydown", onKeyDown)
        }),
        (remove) => Effect.sync(remove),
      ).pipe(Effect.andThen(Effect.never)),
    ),
})

/**
 * Writes the command line's text into the input when Heron OS changes it: Enter, Esc, the history keys and the
 * tour's typing. The input is otherwise uncontrolled, because foldkit writes a controlled `value` back on every
 * render, and a clock tick that renders between a keystroke and its input message would drop the keystroke.
 */
const SyncInput = Command.define("SyncCmdInput", {
  args: { inputId: Schema.String, value: Schema.String },
  messages: [Message.CompletedSyncInput],
  execute: ({ inputId, value }) =>
    Effect.sync(() => {
      const input = document.getElementById(inputId)
      if (input instanceof HTMLInputElement) input.value = value
      return Message.CompletedSyncInput()
    }),
})

/** The tour types at about the pace of a person who knows the command. */
const TypeKey = Command.define("TypeCmdKey", {
  messages: [Message.TypedKey],
  execute: Effect.sleep("45 millis").pipe(Effect.as(Message.TypedKey())),
})

export const OutMessage = defineMessageUnion({
  RequestedClose: {},
  RequestedReview: { delivery: Delivery },
})
export type OutMessage = typeof OutMessage.Type

/** What the Command Prompt reads from the rest of the system when it runs a command. */
export type Context = Readonly<{ review: Review; now: number; inputId: string }>

export const inputIdFor = (windowId: number): string => `cmd-input-${windowId}`

const home = "C:\\Users\\Visitor"
const root = FilePath.make("/")

const header: ReadonlyArray<string> = ["Heron OS [Version 1.0]", "Copyright (c) 2026 NickSuomi. Heron is licensed under Apache-2.0.", ""]

export const init = (): Model =>
  Model({
    cwd: root,
    entries: [Entry.Lines({ lines: header })],
    input: "",
    history: [],
    maybeHistoryIndex: Option.none(),
    maybeRunningCommand: Option.none(),
    maybeTyping: Option.none(),
  })

export const title = (model: Model): string =>
  Option.match(model.maybeRunningCommand, { onNone: () => "Command Prompt", onSome: (command) => `Command Prompt - ${command}` })

const windowsPath = (path: FilePath): string => (path === root ? home : `${home}${path.replaceAll("/", "\\")}`)

const prompt = (model: Model): string => `${windowsPath(model.cwd)}>`

// Paths

const joinPath = (base: string, name: string): string => (base === "/" ? `/${name}` : `${base}/${name}`)

const childNamed = (folder: string, name: string): Option.Option<VfsNode> =>
  Array.findFirst(children(FilePath.make(folder)), (node) => node.name.toLowerCase() === name.toLowerCase())

/** Resolves a cmd path (relative, `..`, backslashes, or under C:\Users\Visitor) to a node. `None` leaves the home. */
const resolve = (cwd: FilePath, argument: string): Option.Option<Option.Option<VfsNode>> => {
  const text = argument.replaceAll("/", "\\")
  const lower = text.toLowerCase()
  const [start, rest] = lower.startsWith(home.toLowerCase())
    ? ["/", text.slice(home.length)]
    : text.startsWith("\\")
      ? ["/", text]
      : [cwd as string, text]
  const segments = rest.split("\\").filter((segment) => segment !== "" && segment !== ".")
  let at: Option.Option<string> = Option.some(start)
  for (const segment of segments) {
    if (Option.isNone(at)) return Option.some(Option.none())
    const current = at.value
    if (segment === "..") {
      if (current === "/") return Option.none()
      at = Option.some(current.slice(0, current.lastIndexOf("/")) || "/")
    } else {
      at = Option.map(
        Option.filter(childNamed(current, segment), (node) => node._tag === "Folder" || segment === segments[segments.length - 1]),
        (node) => joinPath(current, node.name),
      )
    }
  }
  return Option.some(Option.flatMap(at, (path) => (path === "/" ? lookup(root) : lookup(FilePath.make(path)))))
}

// Commands

const help: ReadonlyArray<string> = [
  "For more information on the heron command, type HERON --HELP",
  "CD             Shows or changes the current directory.",
  "CLS            Clears the screen.",
  "DIR            Lists the files and folders in a directory.",
  "EXIT           Closes the Command Prompt.",
  "HELP           Shows this list.",
  "HERON          Reviews a merge request. Try HERON REVIEW --MR 42 --DRY-RUN",
  "TYPE           Shows the contents of a text file.",
  "",
]

const two = (value: number) => String(value).padStart(2, "0")

const stamp = (now: number): string => {
  const date = new Date(now)
  const hours = date.getHours() % 12 === 0 ? 12 : date.getHours() % 12
  return `${two(date.getMonth() + 1)}/${two(date.getDate())}/${date.getFullYear()}  ${two(hours)}:${two(date.getMinutes())} ${date.getHours() < 12 ? "AM" : "PM"}`
}

const grouped = (value: number): string => value.toLocaleString("en-US")

const sizeOf = (node: VfsNode): number => (node._tag === "File" ? new TextEncoder().encode(node.content).length : 1024)

const dirName = (node: VfsNode): string => (node._tag === "Shortcut" ? `${node.name}.lnk` : node.name)

const dir = (folder: VfsNode, now: number): ReadonlyArray<string> => {
  const nodes = children(folder.path)
  const files = nodes.filter((node) => node._tag !== "Folder")
  const folders = nodes.filter((node) => node._tag === "Folder")
  const row = (node: VfsNode | "." | "..") =>
    typeof node === "string" || node._tag === "Folder"
      ? `${stamp(now)}    <DIR>          ${typeof node === "string" ? node : node.name}`
      : `${stamp(now)}    ${grouped(sizeOf(node)).padStart(14)} ${dirName(node)}`
  return [
    " Volume in drive C is HERON",
    " Volume Serial Number is 0042-2026",
    "",
    ` Directory of ${windowsPath(folder.path)}`,
    "",
    row("."),
    row(".."),
    ...nodes.map(row),
    `${String(files.length).padStart(16)} File(s) ${grouped(files.reduce((total, node) => total + sizeOf(node), 0)).padStart(14)} bytes`,
    `${String(folders.length + 2).padStart(16)} Dir(s) ${"41,428,992,000".padStart(15)} bytes free`,
    "",
  ]
}

const notFound = "The system cannot find the path specified."

/** Splits a command line into words, keeping quoted text together. */
const words = (line: string): ReadonlyArray<string> =>
  Array.fromIterable(line.matchAll(/"([^"]*)"|(\S+)/g)).map((match) => match[1] ?? match[2] ?? "")

type Outcome = Update.ReturnWithOutMessage<Model, Message, OutMessage>

const print = (model: Model, lines: ReadonlyArray<string>): Outcome => ({
  model: { ...model, entries: [...model.entries, Entry.Lines({ lines })] },
})

const heronOs = (line: string) => `Heron OS: ${line}`

const heron = (model: Model, args: ReadonlyArray<string>, command: string, context: Context): Outcome => {
  const lower = args.map((arg) => arg.toLowerCase())
  if (lower[0] === "review" && lower.includes("--mr") && !lower.includes("--help") && !lower.includes("-h")) {
    const iid = Number(lower[lower.indexOf("--mr") + 1])
    if (iid !== exampleMergeRequestIid)
      return print(model, [heronOs(`this machine can only reach one merge request, !${exampleMergeRequestIid} (a fictional example).`), heronOs("try heron review --mr 42 --dry-run"), ""])
    if (context.review._tag === "Running")
      return print(model, [heronOs("Heron is already reviewing !42 in another window. Run it again when that review is done."), ""])
    const run = context.review._tag === "Done" ? context.review.run + 1 : 1
    return {
      model: { ...model, entries: [...model.entries, Entry.LiveReview({ run })], maybeRunningCommand: Option.some(command) },
      outMessage: OutMessage.RequestedReview({ delivery: lower.includes("--dry-run") ? "DryRun" : "Post" }),
    }
  }
  const withoutConfig = lower[0] === "config" && lower[1] === "check" ? ["config", "check"] : lower
  return pipe(
    Option.fromUndefinedOr(cliOutput[withoutConfig.join(" ")]),
    Option.match({
      onSome: (output) => print(model, [...output.split("\n"), ""]),
      onNone: () =>
        print(model, [heronOs("this machine knows heron --help, heron config check, and heron review --mr 42 with or without --dry-run."), ""]),
    }),
  )
}

const run = (model: Model, line: string, context: Context): Outcome => {
  const [name = "", ...args] = words(line.replace(/^(cd|dir|type)(?=\.)/i, "$1 "))
  const argument = args.join(" ")
  return Match.value(name.toLowerCase()).pipe(
    Match.withReturnType<Outcome>(),
    Match.when("", () => ({ model })),
    Match.when("cls", () => ({ model: { ...model, entries: [] } })),
    Match.when("exit", () => ({ model, outMessage: OutMessage.RequestedClose() })),
    Match.when("help", () => print(model, help)),
    Match.when("cd", () =>
      argument === ""
        ? print(model, [windowsPath(model.cwd), ""])
        : Option.match(resolve(model.cwd, argument), {
            onNone: () => print(model, ["Access is denied.", ""]),
            onSome: (maybeNode) =>
              Option.match(Option.filter(maybeNode, (node) => node._tag === "Folder"), {
                onNone: () => print(model, [notFound, ""]),
                onSome: (node) => ({ model: { ...model, cwd: node.path } }),
              }),
          }),
    ),
    Match.when("chdir", () => run(model, `cd ${argument}`, context)),
    Match.when("dir", () =>
      pipe(
        argument === "" ? Option.some(lookup(model.cwd)) : resolve(model.cwd, argument),
        Option.flatten,
        Option.filter((node) => node._tag === "Folder"),
        Option.match({ onNone: () => print(model, ["File Not Found", ""]), onSome: (folder) => print(model, dir(folder, context.now)) }),
      ),
    ),
    Match.when("type", () =>
      argument === ""
        ? print(model, ["The syntax of the command is incorrect.", ""])
        : pipe(
            resolve(model.cwd, argument),
            Option.flatten,
            Option.match({
              onNone: () => print(model, ["The system cannot find the file specified.", ""]),
              onSome: (node) =>
                node._tag === "File" ? print(model, [...node.content.replace(/\n$/, "").split("\n"), ""]) : print(model, ["Access is denied.", ""]),
            }),
          ),
    ),
    Match.when("heron", () => heron(model, args, line.trim(), context)),
    Match.orElse(() =>
      print(model, [`'${name}' is not recognized as an internal or external command,`, "operable program or batch file.", ""]),
    ),
  )
}

const isAttachedTo = (model: Model, review: Review): boolean =>
  review._tag === "Running" &&
  pipe(
    Array.last(model.entries),
    Option.exists((entry) => entry._tag === "LiveReview" && entry.run === review.run),
  )

const enter = (model: Model, context: Context): Outcome => {
  if (isAttachedTo(model, context.review)) return { model }
  const line = model.input
  const echoed: Model = {
    ...model,
    entries: [...model.entries, Entry.Lines({ lines: [`${prompt(model)}${line}`] })],
    input: "",
    maybeHistoryIndex: Option.none(),
    history: line.trim() === "" || model.history[model.history.length - 1] === line ? model.history : [...model.history, line],
  }
  return run(echoed, line, context)
}

export const update = (model: Model, message: Message, context: Context) =>
  Message.match<Update.ReturnWithOutMessage<Model, Message, OutMessage>>(message, {
    UpdatedInput: ({ value }) => (Option.isSome(model.maybeTyping) ? { model } : { model: { ...model, input: value.replace(/\r?\n/g, "") } }),
    PressedEscape: () => ({ model: { ...model, input: "", maybeHistoryIndex: Option.none(), maybeTyping: Option.none() }, commands: [SyncInput({ inputId: context.inputId, value: "" })] }),
    CompletedFocusInput: () => ({ model }),
    CompletedSyncInput: () => ({ model }),
    PressedHistory: ({ isOlder }) => {
      if (model.history.length === 0) return { model }
      const last = model.history.length - 1
      const index = Option.match(model.maybeHistoryIndex, {
        onNone: () => last,
        onSome: (current) => Math.min(Math.max(current + (isOlder ? -1 : 1), 0), last),
      })
      const input = model.history[index] ?? ""
      return { model: { ...model, maybeHistoryIndex: Option.some(index), input }, commands: [SyncInput({ inputId: context.inputId, value: input })] }
    },
    SubmittedLine: ({ line }) => (Option.isSome(model.maybeTyping) ? { model } : enter({ ...model, input: line }, context)),
    StartedTyping: ({ text }) =>
      isAttachedTo(model, context.review)
        ? { model }
        : { model: { ...model, input: "", maybeTyping: Option.some(text) }, commands: [SyncInput({ inputId: context.inputId, value: "" }), TypeKey()] },
    TypedKey: () =>
      Option.match(model.maybeTyping, {
        onNone: () => ({ model }),
        onSome: (rest) => {
          if (rest === "") {
            const entered = enter({ ...model, maybeTyping: Option.none() }, context)
            return { ...entered, commands: [...(entered.commands ?? []), SyncInput({ inputId: context.inputId, value: "" })] }
          }
          const input = model.input + rest.charAt(0)
          return { model: { ...model, input, maybeTyping: Option.some(rest.slice(1)) }, commands: [SyncInput({ inputId: context.inputId, value: input }), TypeKey()] }
        },
      }),
  })

// A review's lines: what Heron OS shows while the sessions run, then what the CLI prints when the run ends.

const reviewLines = (review: Review): ReadonlyArray<string> => [
  heronOs("each step is shown as it happens; the real CLI prints only its result."),
  ...eventsOf(review).map(describeEvent),
  ...Option.match(cliResult(review), { onNone: () => [], onSome: (output) => ["", ...output.split("\n"), ""] }),
]

/** Freezes the scrollback of a run that has ended, so later runs do not rewrite it. Called when the review ticks. */
export const settle = (model: Model, review: Review): Model =>
  review._tag !== "Done" || !model.entries.some((entry) => entry._tag === "LiveReview" && entry.run === review.run)
    ? model
    : {
        ...model,
        maybeRunningCommand: Option.none(),
        entries: model.entries.map((entry) =>
          entry._tag === "LiveReview" && entry.run === review.run ? Entry.Lines({ lines: reviewLines(review) }) : entry,
        ),
      }

const entryText = (entry: Entry, review: Review): ReadonlyArray<string> =>
  Entry.match(entry, {
    Lines: ({ lines }) => lines,
    LiveReview: ({ run }) => (review._tag !== "Idle" && review.run === run ? reviewLines(review) : []),
  })

const keyMessage = (key: string): Option.Option<Message> =>
  Match.value(key).pipe(
    Match.when("ArrowUp", () => Option.some(Message.PressedHistory({ isOlder: true }))),
    Match.when("ArrowDown", () => Option.some(Message.PressedHistory({ isOlder: false }))),
    Match.orElse(() => Option.none()),
  )

export type ViewInputs = Readonly<{ review: Review; inputId: string }>

export const view = Submodel.defineView<Model, Message, ViewInputs>((model, { review, inputId }, h): Html => {
  const isBusy = isAttachedTo(model, review)
  const text = model.entries.flatMap((entry) => entryText(entry, review)).join("\n")
  return h.label(
    [h.Class(`cmd${isBusy ? " is-busy" : ""}`), h.For(inputId)],
    [
      h.div(
        [h.Class("cmd-scroll")],
        [
          h.pre(
            [h.Class("cmd-buffer")],
            [
              text === "" ? "" : `${text}\n`,
              ...(isBusy
                ? [h.span([h.Class("cmd-caret")], ["_"])]
                : [prompt(model), model.input, h.span([h.Class("cmd-caret")], ["_"])]),
            ],
          ),
        ],
      ),
      h.input([
        h.Id(inputId),
        h.Class("cmd-input"),
        h.Type("text"),
        h.AriaLabel(`Command line, ${prompt(model)}`),
        h.Autocomplete("off"),
        h.Spellcheck(false),
        h.Attribute("value", model.input),
        h.OnInput((value) => Message.UpdatedInput({ value })),
        h.OnKeyDownPreventDefault(keyMessage),
        h.OnMount(CommandLine()),
      ]),
    ],
  )
})
