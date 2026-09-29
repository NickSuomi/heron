import { Option, Schema } from "effect"
import type { Html, HtmlBuilder } from "foldkit/html"
import { taggedStruct } from "foldkit/schema"

import { FilePath } from "../domain/vfs"

/** The apps unit 2 builds. Each becomes its own module with the Notepad shape. */
export const StubAppId = Schema.Literals(["editor", "diagram", "cmd", "explorer", "browser", "welcome", "uac", "help"])
export type StubAppId = typeof StubAppId.Type

export const Model = taggedStruct("Stub", { app: StubAppId, maybePath: Schema.Option(FilePath) })
export type Model = typeof Model.Type

export const view = <Message>(h: HtmlBuilder<Message>, name: string, model: Model): Html =>
  h.div(
    [h.Class(`stub stub-${model.app}`)],
    [
      h.h1([h.Class("stub-title")], [name]),
      ...Option.match(model.maybePath, {
        onNone: () => [],
        onSome: (path) => [h.p([h.Class("stub-path")], [path])],
      }),
      h.p([h.Class("stub-body")], ["Coming in unit 2."]),
    ],
  )
