import type { Html, HtmlBuilder } from "foldkit/html"

import glyphUrl from "../assets/heron-glyph.svg?url"
import { Message } from "../message"
import { type Model, Uac } from "../model"
import { iconUrl } from "./icons"

// The User Account Control joke. The desktop dims behind a secure-desktop dialog that asks to approve
// merge request !42 with Cancel focused. Whichever button is pressed, Heron cancels itself.

const programRow = (h: HtmlBuilder<Message>): Html =>
  h.div(
    [h.Class("uac-program")],
    [
      h.span([h.Class("uac-program-icon")], [h.img([h.Src(glyphUrl), h.Alt(""), h.Width("32"), h.Height("32")])]),
      h.dl(
        [],
        [
          h.dt([h.Class("uac-sr")], ["Action"]),
          h.dd([h.Class("uac-program-name")], ["Approve merge request !42"]),
          h.dt([], ["Program:"]),
          h.dd([], ["heron review --mr 42"]),
          h.dt([], ["Publisher:"]),
          h.dd([], ["NickSuomi, Apache License 2.0"]),
        ],
      ),
    ],
  )

const asking = (h: HtmlBuilder<Message>, isDetailsShown: boolean): ReadonlyArray<Html> => [
  h.div(
    [h.Class("uac-banner is-asking")],
    [
      h.img([h.Src(iconUrl("shield")), h.Alt(""), h.Width("32"), h.Height("32")]),
      h.h1([h.Id("uac-title")], ["Heron wants to approve this merge request"]),
    ],
  ),
  h.div(
    [h.Class("uac-body")],
    [
      h.p([h.Class("uac-lead")], ["Approving is a person's decision. Continue only if you are that person and you read the change."]),
      programRow(h),
      isDetailsShown
        ? h.div(
            [h.Class("uac-details")],
            [
              h.p([], ["Merge request: acme/storefront !42 (a fictional example)"]),
              h.p([], ["Requested by: a review that has just finished"]),
            ],
          )
        : h.empty,
    ],
  ),
  h.div(
    [h.Class("uac-actions")],
    [
      h.button(
        [h.Class(`uac-expander${isDetailsShown ? " is-open" : ""}`), h.AriaExpanded(isDetailsShown), h.OnClick(Message.ToggledUacDetails())],
        [h.span([h.Class("td-expander-glyph")]), "Details"],
      ),
      h.span([h.Class("uac-spacer")]),
      h.button([h.Class("vista-button"), h.OnClick(Message.ClickedUacContinue())], ["Continue"]),
      h.button([h.Class("vista-button is-default"), h.Id("uac-cancel"), h.OnClick(Message.ClickedUacCancel())], ["Cancel"]),
    ],
  ),
]

const refused = (h: HtmlBuilder<Message>, clicked: "Continue" | "Cancel"): ReadonlyArray<Html> => [
  h.div(
    [h.Class("uac-banner is-refused")],
    [
      h.img([h.Src(iconUrl("shield")), h.Alt(""), h.Width("32"), h.Height("32")]),
      h.h1([h.Id("uac-title")], ["Heron cancelled this itself"]),
    ],
  ),
  h.div(
    [h.Class("uac-body")],
    [
      h.p([h.Class("uac-never")], ["Heron never approves."]),
      h.p([], [clicked === "Continue" ? "You chose Continue. Heron cancelled anyway." : "You chose Cancel. Heron agrees."]),
      h.p([], ["It posts one report note and sets one verdict label. Approving merge request !42 stays with a person."]),
    ],
  ),
  h.div(
    [h.Class("uac-actions")],
    [h.span([h.Class("uac-spacer")]), h.button([h.Class("vista-button is-default"), h.Id("uac-cancel"), h.OnClick(Message.ClickedUacClose())], ["OK"])],
  ),
]

export const secureDesktopView = (model: Model, h: HtmlBuilder<Message>): Html =>
  Uac.match<Html>(model.uac, {
    Hidden: () => h.empty,
    Asking: ({ isDetailsShown }) => frame(h, asking(h, isDetailsShown)),
    Refused: ({ clicked }) => frame(h, refused(h, clicked)),
  })

const frame = (h: HtmlBuilder<Message>, content: ReadonlyArray<Html>): Html =>
  h.div(
    [h.Class("secure-desktop")],
    [
      h.section(
        [h.Class("uac"), h.Role("alertdialog"), h.AriaModal(true), h.AriaLabelledBy("uac-title")],
        [
          h.div([h.Class("uac-caption")], [h.span([], ["User Account Control"])]),
          h.div([h.Class("uac-client")], content),
          h.p([h.Class("uac-footer")], ["Heron OS asks before anything approves a merge request. Heron itself never does."]),
        ],
      ),
    ],
  )
