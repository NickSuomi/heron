import { Option } from "effect"
import type { Document, HtmlBuilder } from "foldkit/html"

import { titleOf } from "./apps/registry"
import * as Desk from "./domain/window"
import type { Message } from "./message"
import { isPhone, type Model, Session } from "./model"
import { bootView } from "./shell/boot"
import { desktopView } from "./shell/desktop"
import { phoneView } from "./shell/phone"

const documentTitle = (model: Model): string =>
  Option.match(Option.flatMap(model.desk.maybeFocused, (id) => Desk.find(model.desk, id)), {
    onNone: () => "Heron OS",
    onSome: (win) => `${titleOf(win.app)} | Heron OS`,
  })

export const view = (model: Model, h: HtmlBuilder<Message>): Document => ({
  title: documentTitle(model),
  body: Session.match(model.session, {
    Booting: ({ stage }) => bootView(h, stage),
    Desktop: () => (isPhone(model) ? phoneView(model, h) : desktopView(model, h)),
  }),
})
