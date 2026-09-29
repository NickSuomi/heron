import { Duration, Effect, Option, Schema } from "effect"
import { Command, Submodel, type Update } from "foldkit"
import type { Html, HtmlBuilder } from "foldkit/html"
import { defineMessageUnion } from "foldkit/message"
import { taggedStruct } from "foldkit/schema"
import { modifyFields } from "foldkit/struct"

import type { VfsNode } from "../domain/vfs"
import { glyphUrl, type GlyphName } from "./glyphs"
import { Request, type ViewInputs } from "./request"

// The Recycle Bin holds approve.exe, force-push.bat and merge-without-review.lnk. Opening one shows a
// Vista-style task dialog that says, with a straight face, that Heron never does this.

export const DialogKind = Schema.Literals(["Approve", "ForcePush", "Merge"])
export type DialogKind = typeof DialogKind.Type

/** force-push.bat first pretends Heron crashed, then admits the joke. */
export const Stage = Schema.Literals(["Checking", "Punchline"])
export type Stage = typeof Stage.Type

export const Model = taggedStruct("Dialog", {
  kind: DialogKind,
  fileName: Schema.String,
  stage: Stage,
  isDetailsShown: Schema.Boolean,
})
export type Model = typeof Model.Type

export const Message = defineMessageUnion({
  ToggledDetails: {},
  ClickedClose: {},
  CompletedCheck: {},
})
export type Message = typeof Message.Type

export const OutMessage = Request
export type OutMessage = Request

const kindOf = (name: string): DialogKind =>
  name.startsWith("force-push") ? "ForcePush" : name.startsWith("merge-without-review") ? "Merge" : "Approve"

export const init = (maybeNode: Option.Option<VfsNode>): Model => {
  const fileName = Option.match(maybeNode, { onNone: () => "approve.exe", onSome: (node) => node.name })
  const kind = kindOf(fileName)
  return Model({ kind, fileName, stage: kind === "ForcePush" ? "Checking" : "Punchline", isDetailsShown: false })
}

/** The command that turns the pretend crash into the punchline; the shell runs it when the window opens. */
export const CheckForSolution = Command.define("CheckForSolution", {
  messages: [Message.CompletedCheck],
  execute: Effect.sleep(Duration.millis(2200)).pipe(Effect.as(Message.CompletedCheck())),
})

export const initCommands = (model: Model): ReadonlyArray<Command.Command<Message>> => (model.stage === "Checking" ? [CheckForSolution()] : [])

export const title = (model: Model): string => (model.kind === "ForcePush" ? "Heron" : model.fileName)

type UpdateReturn = Update.ReturnWithOutMessage<Model, Message, OutMessage>

export const update = (model: Model, message: Message): UpdateReturn =>
  Message.match<UpdateReturn>(message, {
    ToggledDetails: () => ({ model: modifyFields(model, { isDetailsShown: (shown) => !shown }) }),
    ClickedClose: () => ({ model, outMessage: Request.RequestedClose() }),
    CompletedCheck: () => ({ model: { ...model, stage: "Punchline" } }),
  })

type Copy = Readonly<{ glyph: GlyphName; instruction: string; content: ReadonlyArray<string>; details: ReadonlyArray<string>; button: string }>

// Every sentence after the joke is a fact from README.md, docs/configuration.md or docs/security.md.
const copy = (model: Model): Copy => {
  switch (model.kind) {
    case "Approve":
      return {
        glyph: "dialog-error",
        instruction: "Heron cannot run approve.exe",
        content: [
          "Heron never approves a merge request.",
          "It posts one report note and sets one verdict label. Approving stays with a person.",
        ],
        details: [
          "A PASS is one automated opinion, not a security approval.",
          "The author controls the diff and description the model reads, so merge request text can steer the model.",
        ],
        button: "Close",
      }
    case "ForcePush":
      return model.stage === "Checking"
        ? {
            glyph: "dialog-warning",
            instruction: "Heron has stopped working",
            content: ["Heron OS is checking for a solution to the problem..."],
            details: [],
            button: "Close program",
          }
        : {
            glyph: "dialog-info",
            instruction: "Heron has stopped working... just kidding.",
            content: ["It never pushes.", "It writes one note and some labels. Most of its design keeps the GitLab token away from the model and the vendor tools."],
            details: [
              "Models see the reviewed commit through three read-only tools, grep, list_files and read_file, and cannot run commands or change files.",
              "The GitLab token is never passed to a harness.",
            ],
            button: "Close program",
          }
    case "Merge":
      return {
        glyph: "dialog-warning",
        instruction: "The item this shortcut refers to has never existed",
        content: [
          "merge-without-review.lnk points to a merge nobody reviewed.",
          "Heron never merges. It reviews one merge request at its current head and writes one note.",
        ],
        details: [
          "Nothing reviews a merge request until someone runs heron review, for example from the manual CI job.",
          "Heron does not start inline discussion threads, approve, or merge.",
        ],
        button: "OK",
      }
  }
}

const detailsToggle = (h: HtmlBuilder<Message>, model: Model): Html =>
  h.button(
    [h.Class(`td-expander${model.isDetailsShown ? " is-open" : ""}`), h.AriaExpanded(model.isDetailsShown), h.OnClick(Message.ToggledDetails())],
    [h.span([h.Class("td-expander-glyph")]), model.isDetailsShown ? "Hide details" : "See details"],
  )

export const view = Submodel.defineView<Model, Message, ViewInputs>((model, inputs, h) => {
  const text = copy(model)
  return h.div(
    [h.Class(`task-dialog td-${model.kind.toLowerCase()} is-${model.stage.toLowerCase()}${inputs.form === "Phone" ? " is-phone" : ""}`), h.Role("alertdialog"), h.AriaLive("polite")],
    [
      h.div(
        [h.Class("td-main")],
        [
          h.img([h.Class("td-glyph"), h.Src(glyphUrl(text.glyph)), h.Alt(""), h.Width("32"), h.Height("32")]),
          h.div(
            [h.Class("td-text")],
            [
              h.h1([h.Class("td-instruction")], [text.instruction]),
              ...text.content.map((line) => h.p([h.Class("td-content")], [line])),
              model.stage === "Checking" ? h.div([h.Class("td-progress"), h.Role("progressbar"), h.AriaLabel("Checking for a solution")], [h.span([])]) : h.empty,
              model.isDetailsShown ? h.div([h.Class("td-details")], text.details.map((line) => h.p([], [line]))) : h.empty,
            ],
          ),
        ],
      ),
      h.div(
        [h.Class("td-footer")],
        [
          text.details.length === 0 ? h.span([]) : detailsToggle(h, model),
          h.button([h.Class("vista-button is-default"), h.Autofocus(true), h.OnClick(Message.ClickedClose())], [text.button]),
        ],
      ),
    ],
  )
})
