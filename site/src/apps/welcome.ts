import { Array, Option, Schema } from "effect"
import { Submodel, type Update } from "foldkit"
import type { Html, HtmlBuilder } from "foldkit/html"
import { defineMessageUnion } from "foldkit/message"
import { taggedStruct } from "foldkit/schema"
import { modifyFields } from "foldkit/struct"

import { FilePath, readmePath } from "../domain/vfs"
import { iconUrl } from "../shell/icons"
import { glyphUrl } from "./glyphs"
import { type Form, Request } from "./request"

// Welcome Center, opened on start: a header about this computer, "Get started with Heron OS" tiles,
// a "Take the tour" button and "Show this at startup". A click selects a tile and shows what it does
// in the header, as Vista's Welcome Center did; a double-click, or the header link, opens it.

export const TileId = Schema.Literals(["about", "diagram", "readme", "cmd", "gitlab", "book", "computer", "config", "bin"])
export type TileId = typeof TileId.Type

export const Model = taggedStruct("Welcome", {
  maybeSelected: Schema.Option(TileId),
  isMoreShown: Schema.Boolean,
})
export type Model = typeof Model.Type

export const Message = defineMessageUnion({
  ClickedTile: { tile: TileId },
  OpenedTile: { tile: TileId },
  ClickedMoreDetails: {},
  ClickedTour: {},
  ToggledStartup: { isShown: Schema.Boolean },
})
export type Message = typeof Message.Type

export const OutMessage = Request
export type OutMessage = Request

export type WelcomeViewInputs = Readonly<{ form: Form; isShownAtStartup: boolean }>

export const init = (): Model => Model({ maybeSelected: Option.none(), isMoreShown: false })

export const title = (): string => "Welcome Center"

type Tile = Readonly<{
  id: TileId
  label: string
  picture: string
  summary: string
  description: ReadonlyArray<string>
  action: string
  request: Request
  section: "GetStarted" | "Explore"
}>

const diagramPath = FilePath.make("/Desktop/How Heron works.vsd")

// Descriptions quote README.md.
const tiles: ReadonlyArray<Tile> = [
  {
    id: "about",
    label: "What is Heron?",
    picture: iconUrl("user"),
    summary: "A self-hosted code-review bot for GitLab merge requests",
    description: [
      "Heron is a self-hosted code-review bot for GitLab merge requests. It runs on your own runner with your own model credentials, posts one report note per merge request, and never pushes, approves, or merges.",
      "Code decides the verdict, not the model. The verdict is one of four fixed words: PASS, CHANGES REQUESTED, BLOCKED, or SUPERSEDED.",
    ],
    action: "Take the tour",
    request: Request.RequestedTour(),
    section: "GetStarted",
  },
  {
    id: "diagram",
    label: "How Heron works",
    picture: iconUrl("diagram"),
    summary: "Lanes, gates, supervisor and judge, drawn",
    description: [
      "Path rules in the config pick a lane: one reviewer for a docs change, gates with a supervisor for most changes, or two independent branches and a judge for sensitive paths.",
      "Open the drawing, switch lanes, and press Play to watch a review flow through it.",
    ],
    action: "Open How Heron works.vsd",
    request: Request.RequestedOpenPath({ path: diagramPath }),
    section: "GetStarted",
  },
  {
    id: "readme",
    label: "Read the README",
    picture: iconUrl("notepad"),
    summary: "The repository's own README, in Notepad",
    description: [
      "README.txt on the desktop is the README.md of the Heron repository, bundled when this site was built.",
      "It covers what Heron is, how it works, the quick start, and its known limitations.",
    ],
    action: "Open README.txt",
    request: Request.RequestedOpenPath({ path: readmePath }),
    section: "GetStarted",
  },
  {
    id: "cmd",
    label: "Command Prompt",
    picture: iconUrl("cmd"),
    summary: "heron review --mr 42 --dry-run",
    description: [
      "Run heron --help, heron config check, or a review of the fictional merge request !42.",
      "With --dry-run Heron prints the report and posts nothing. Without it, Heron posts the note and sets labels.",
    ],
    action: "Open Command Prompt",
    request: Request.RequestedStartApp({ app: "cmd" }),
    section: "GetStarted",
  },
  {
    id: "gitlab",
    label: "GitLab",
    picture: iconUrl("browser"),
    summary: "Merge request !42 at gitlab.heron.local",
    description: [
      "A fictional GitLab with the example project acme/storefront. Sign in with anything: nothing leaves the page.",
      "When a review posts, Heron's report note appears on merge request !42 and its labels change.",
    ],
    action: "Open Internet Explorer",
    request: Request.RequestedStartApp({ app: "browser" }),
    section: "GetStarted",
  },
  {
    id: "book",
    label: "Design book",
    picture: iconUrl("help"),
    summary: "How Heron OS looks, sounds and speaks",
    description: [
      "Help and Support holds the Heron OS design book: the palette, the Aero glass recipe, type, icons, window measurements, sound, voice, and accessibility.",
    ],
    action: "Open Help and Support",
    request: Request.RequestedStartApp({ app: "help" }),
    section: "GetStarted",
  },
  {
    id: "computer",
    label: "Browse the Heron source",
    picture: iconUrl("heron-folder"),
    summary: "src/, docs/ and README.md, read-only",
    description: [
      "The Heron folder is the repository itself: src/, docs/, README.md and the example config, bundled when this site was built.",
      "Explorer opens every file through the file-type registry, as a double-click on the desktop does.",
    ],
    action: "Open the Heron folder",
    request: Request.RequestedOpenPath({ path: FilePath.make("/Desktop/Heron") }),
    section: "Explore",
  },
  {
    id: "config",
    label: "heron.config.json",
    picture: iconUrl("json"),
    summary: "The example config: lanes, gates, rules",
    description: [
      "This is the repository's heron.config.example.json. Path rules in it pick a lane, and the lane sets the gates and the sessions that run them.",
      "Unknown keys are errors, so a typo fails the load.",
    ],
    action: "Open heron.config.json",
    request: Request.RequestedOpenPath({ path: FilePath.make("/Desktop/heron.config.json") }),
    section: "Explore",
  },
  {
    id: "bin",
    label: "Recycle Bin",
    picture: iconUrl("recycle-bin"),
    summary: "Three things Heron never does",
    description: ["approve.exe, force-push.bat and merge-without-review.lnk. Open one to find out why it stays in the bin."],
    action: "Open the Recycle Bin",
    request: Request.RequestedOpenPath({ path: FilePath.make("/Desktop/Recycle Bin") }),
    section: "Explore",
  },
]

const tileOf = (id: TileId): Option.Option<Tile> => Array.findFirst(tiles, (tile) => tile.id === id)

type UpdateReturn = Update.ReturnWithOutMessage<Model, Message, OutMessage>

export const update = (model: Model, message: Message): UpdateReturn =>
  Message.match<UpdateReturn>(message, {
    ClickedTile: ({ tile }) => ({ model: { ...model, maybeSelected: Option.some(tile) } }),
    OpenedTile: ({ tile }) =>
      Option.match(tileOf(tile), {
        onNone: () => ({ model }),
        onSome: (each) => ({ model: { ...model, maybeSelected: Option.some(tile) }, outMessage: each.request }),
      }),
    ClickedMoreDetails: () => ({ model: modifyFields(model, { isMoreShown: (shown) => !shown }) }),
    ClickedTour: () => ({ model, outMessage: Request.RequestedTour() }),
    ToggledStartup: ({ isShown }) => ({ model, outMessage: Request.RequestedWelcomeAtStartup({ isShown }) }),
  })

// ---------------------------------------------------------------------------------------------------
// View

const facts: ReadonlyArray<readonly [label: string, value: string]> = [
  ["Heron", "0.0.0, alpha, install from source"],
  ["Licence", "Apache License 2.0"],
  ["Requires", "Node 24 or later, pnpm 11, git"],
]

const moreFacts: ReadonlyArray<readonly [label: string, value: string]> = [
  ["Forge", "GitLab only"],
  ["Backends", "ai-sdk, claude-cli, codex-cli"],
  ["Model tools", "grep, list_files, read_file (read-only)"],
  ["State", "One hidden marker in the report note. No database."],
]

const header = (h: HtmlBuilder<Message>, model: Model): Html =>
  Option.match(Option.flatMap(model.maybeSelected, tileOf), {
    onNone: () =>
      h.div(
        [h.Class("wc-header")],
        [
          h.img([h.Class("wc-header-picture"), h.Src(iconUrl("computer")), h.Alt(""), h.Width("64"), h.Height("64")]),
          h.div(
            [h.Class("wc-header-text")],
            [
              h.h1([h.Class("wc-title")], ["Heron OS"]),
              h.dl(
                [h.Class("wc-facts")],
                [...facts, ...(model.isMoreShown ? moreFacts : [])].flatMap(([label, value]) => [h.dt([], [label]), h.dd([], [value])]),
              ),
              h.button([h.Class("wc-link"), h.OnClick(Message.ClickedMoreDetails())], [model.isMoreShown ? "Show fewer details" : "Show more details"]),
            ],
          ),
          tourButton(h),
        ],
      ),
    onSome: (tile) =>
      h.div(
        [h.Class("wc-header is-tile")],
        [
          h.img([h.Class("wc-header-picture"), h.Src(tile.picture), h.Alt(""), h.Width("64"), h.Height("64")]),
          h.div(
            [h.Class("wc-header-text")],
            [
              h.h1([h.Class("wc-title")], [tile.label]),
              ...tile.description.map((line) => h.p([h.Class("wc-description")], [line])),
              h.button([h.Class("wc-link wc-action"), h.OnClick(Message.OpenedTile({ tile: tile.id }))], [tile.action]),
            ],
          ),
          tourButton(h),
        ],
      ),
  })

const tourButton = (h: HtmlBuilder<Message>): Html =>
  h.button(
    [h.Class("wc-tour"), h.OnClick(Message.ClickedTour())],
    [h.img([h.Src(glyphUrl("tour")), h.Alt(""), h.Width("32"), h.Height("32")]), h.span([h.Class("wc-tour-text")], [h.strong([], ["Take the tour"]), h.span([], ["Watch Heron review !42"])])],
  )

const tileView = (h: HtmlBuilder<Message>, model: Model, tile: Tile): Html =>
  h.button(
    [
      h.Class(`wc-tile${Option.contains(model.maybeSelected, tile.id) ? " is-selected" : ""}`),
      h.Title(tile.summary),
      h.OnClick(Message.ClickedTile({ tile: tile.id })),
      h.OnDoubleClick(Message.OpenedTile({ tile: tile.id })),
      h.OnKeyDownPreventDefault((key) => (key === "Enter" ? Option.some(Message.OpenedTile({ tile: tile.id })) : Option.none())),
    ],
    [h.img([h.Src(tile.picture), h.Alt(""), h.Width("32"), h.Height("32")]), h.span([h.Class("wc-tile-label")], [tile.label])],
  )

const sections: ReadonlyArray<readonly [Tile["section"], string]> = [
  ["GetStarted", "Get started with Heron OS"],
  ["Explore", "Explore this computer"],
]

const startupCheckbox = (h: HtmlBuilder<Message>, isShown: boolean): Html =>
  h.label(
    [h.Class("wc-startup")],
    [h.input([h.Type("checkbox"), h.Checked(isShown), h.OnChange(() => Message.ToggledStartup({ isShown: !isShown }))]), h.span([], ["Show this at startup"])],
  )

const phoneView = (h: HtmlBuilder<Message>, inputs: WelcomeViewInputs): Html =>
  h.div(
    [h.Class("wc-phone")],
    [
      h.button(
        [h.Class("wm-today-item wc-phone-tour"), h.OnClick(Message.ClickedTour())],
        [h.img([h.Src(glyphUrl("tour")), h.Alt("")]), h.span([h.Class("wm-today-text")], [h.span([], ["Take the tour"]), h.span([], ["Watch Heron review !42"])])],
      ),
      ...tiles.map((tile) =>
        h.button(
          [h.Class("wm-today-item"), h.OnClick(Message.OpenedTile({ tile: tile.id }))],
          [h.img([h.Src(tile.picture), h.Alt("")]), h.span([h.Class("wm-today-text")], [h.span([], [tile.label]), h.span([], [tile.summary])])],
        ),
      ),
      startupCheckbox(h, inputs.isShownAtStartup),
    ],
  )

export const view = Submodel.defineView<Model, Message, WelcomeViewInputs>((model, inputs, h) =>
  inputs.form === "Phone"
    ? phoneView(h, inputs)
    : h.div(
        [h.Class("welcome")],
        [
          header(h, model),
          h.div(
            [h.Class("wc-body")],
            [
              ...sections.flatMap(([section, heading]) => [
                h.h2([h.Class("wc-section")], [h.span([], [heading])]),
                h.div(
                  [h.Class("wc-tiles"), h.Role("group"), h.AriaLabel(heading)],
                  tiles.filter((tile) => tile.section === section).map((tile) => tileView(h, model, tile)),
                ),
              ]),
              h.p([h.Class("wc-footnote")], ["Merge request !42 and the project acme/storefront are a fictional example. Every Heron fact comes from the Heron docs."]),
            ],
          ),
          h.div([h.Class("wc-footer")], [startupCheckbox(h, inputs.isShownAtStartup)]),
        ],
      ),
)
