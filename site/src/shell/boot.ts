import type { Html, HtmlBuilder } from "foldkit/html"

import glyphUrl from "../assets/heron-glyph.svg?url"
import { Message } from "../message"
import { iconUrl } from "./icons"

export const bootView = (h: HtmlBuilder<Message>, stage: "Loader" | "Welcome"): Html =>
  h.div(
    [
      h.Class(`boot boot-${stage.toLowerCase()}`),
      h.Role("button"),
      h.Tabindex(0),
      h.AriaLabel("Heron OS is starting. Click or press Enter to skip."),
      h.OnClick(Message.SkippedBoot()),
    ],
    stage === "Loader"
      ? [
          h.div([h.Class("boot-mark")], [h.img([h.Src(glyphUrl), h.Alt(""), h.Class("boot-glyph")])]),
          h.div([h.Class("boot-progress")], [h.div([h.Class("boot-progress-run")])]),
          h.p([h.Class("boot-legal")], ["Heron OS"]),
          h.p([h.Class("boot-skip")], ["Click or press Enter to skip"]),
        ]
      : [
          h.div([h.Class("wallpaper welcome-wallpaper")]),
          h.div(
            [h.Class("welcome-band")],
            [
              h.div(
                [h.Class("welcome-user")],
                [
                  h.div([h.Class("user-frame")], [h.img([h.Src(iconUrl("user")), h.Alt("")])]),
                  h.p([h.Class("welcome-name")], ["Visitor"]),
                  h.p([h.Class("welcome-status")], [h.span([h.Class("welcome-spinner")]), "Welcome"]),
                ],
              ),
            ],
          ),
          h.div([h.Class("welcome-brand")], [h.img([h.Src(glyphUrl), h.Alt("")]), h.span([], ["Heron OS"])]),
        ],
  )
