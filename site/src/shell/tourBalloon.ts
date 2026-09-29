import { Array, Option } from "effect"
import type { Html, HtmlBuilder } from "foldkit/html"

import { glyphUrl } from "../apps/glyphs"
import { Message } from "../message"
import type { Model } from "../model"
import { Tour, tourSteps } from "../tour"

/** The tour speaks through a notification balloon above the clock, or a bubble above the phone's soft keys. */
export const tourBalloonView = (model: Model, h: HtmlBuilder<Message>): Html =>
  Tour.match<Html>(model.tour, {
    Off: () => h.empty,
    On: ({ step }) =>
      Option.match(Array.get(tourSteps, step), {
        onNone: () => h.empty,
        onSome: (current) => {
          const isLast = step === tourSteps.length - 1
          return h.aside(
            [h.Class("tour-balloon"), h.Role("dialog"), h.AriaLabel("Heron tour"), h.AriaLive("polite")],
            [
              h.div(
                [h.Class("tour-head")],
                [
                  h.img([h.Src(glyphUrl("dialog-info")), h.Alt(""), h.Width("16"), h.Height("16")]),
                  h.span([h.Class("tour-kicker")], [`Heron tour, step ${step + 1} of ${tourSteps.length}`]),
                  h.button([h.Class("tour-close"), h.AriaLabel("End the tour"), h.Title("End the tour"), h.OnClick(Message.ClickedTourEnd())], []),
                ],
              ),
              h.h2([h.Class("tour-title")], [current.title]),
              h.p([h.Class("tour-body")], [current.body]),
              h.div(
                [h.Class("tour-actions")],
                [
                  h.button([h.Class("vista-button"), ...(step === 0 ? [h.Disabled(true)] : [h.OnClick(Message.ClickedTourBack())])], ["Back"]),
                  h.button([h.Class("vista-button is-default"), h.OnClick(Message.ClickedTourNext())], [isLast ? "Finish" : "Next"]),
                ],
              ),
            ],
          )
        },
      }),
  })
