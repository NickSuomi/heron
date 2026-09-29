import { Array, Option, pipe, Schema } from "effect"
import { Submodel, type Update } from "foldkit"
import type { Html, HtmlBuilder } from "foldkit/html"
import { defineMessageUnion } from "foldkit/message"
import { taggedStruct } from "foldkit/schema"
import { modifyFields } from "foldkit/struct"

import { FilePath, lookupFile } from "../domain/vfs"
import { glyphUrl } from "./glyphs"
import { type Block, type Inline, type Topic, topicText, topicsOf } from "./markdown"
import { Request, type ViewInputs } from "./request"

// Help and Support is the Heron OS design book, read from the repository's docs/brand/README.md at
// build time: the same text GitHub shows and the /brand/ page prints.

export const bookPath = FilePath.make("/Heron/docs/brand/README.md")

const topics: ReadonlyArray<Topic> = pipe(
  lookupFile(bookPath),
  Option.match({ onNone: () => [], onSome: (file) => topicsOf(file.content) }),
)

const homeId = topics[0]?.id ?? "home"

/** A page is a topic, or the results of one search. */
export const Page = Schema.Union([
  Schema.TaggedStruct("Topic", { id: Schema.String }),
  Schema.TaggedStruct("Results", { query: Schema.String }),
])
export type Page = typeof Page.Type

const topicPage = (id: string): Page => ({ _tag: "Topic", id })

export const Model = taggedStruct("Help", {
  page: Page,
  back: Schema.Array(Page),
  forward: Schema.Array(Page),
  query: Schema.String,
  isContentsShown: Schema.Boolean,
})
export type Model = typeof Model.Type

export const Message = defineMessageUnion({
  ClickedTopic: { id: Schema.String },
  ClickedHome: {},
  ClickedBack: {},
  ClickedForward: {},
  ToggledContents: {},
  UpdatedQuery: { value: Schema.String },
  SubmittedSearch: {},
  ClickedLink: { href: Schema.String },
})
export type Message = typeof Message.Type

export const OutMessage = Request
export type OutMessage = Request

export const init = (): Model => Model({ page: topicPage(homeId), back: [], forward: [], query: "", isContentsShown: true })

export const title = (): string => "Heron OS Help and Support"

type UpdateReturn = Update.ReturnWithOutMessage<Model, Message, OutMessage>

const go = (model: Model, page: Page): Model =>
  JSON.stringify(page) === JSON.stringify(model.page) ? model : { ...model, page, back: [...model.back, model.page], forward: [] }

/** Links inside the book: a repository path opens the file, anything else is left to the browser. */
const repositoryLink = (href: string): Option.Option<FilePath> => {
  if (/^[a-z]+:/i.test(href) || href.startsWith("#")) return Option.none()
  const parts = ["docs", "brand", ...href.split("/")].reduce<Array<string>>(
    (acc, part) => (part === ".." ? acc.slice(0, -1) : part === "." || part === "" ? acc : [...acc, part]),
    [],
  )
  return Option.some(FilePath.make(`/Heron/${parts.join("/")}`))
}

export const update = (model: Model, message: Message): UpdateReturn =>
  Message.match<UpdateReturn>(message, {
    ClickedTopic: ({ id }) => ({ model: go(model, topicPage(id)) }),
    ClickedHome: () => ({ model: go(model, topicPage(homeId)) }),
    ClickedBack: () =>
      Option.match(Array.last(model.back), {
        onNone: () => ({ model }),
        onSome: (page) => ({ model: { ...model, page, back: model.back.slice(0, -1), forward: [model.page, ...model.forward] } }),
      }),
    ClickedForward: () =>
      Option.match(Array.head(model.forward), {
        onNone: () => ({ model }),
        onSome: (page) => ({ model: { ...model, page, back: [...model.back, model.page], forward: model.forward.slice(1) } }),
      }),
    ToggledContents: () => ({ model: modifyFields(model, { isContentsShown: (shown) => !shown }) }),
    UpdatedQuery: ({ value }) => ({ model: { ...model, query: value } }),
    SubmittedSearch: () => ({ model: model.query.trim() === "" ? model : go(model, { _tag: "Results", query: model.query.trim() }) }),
    ClickedLink: ({ href }) =>
      Option.match(repositoryLink(href), {
        onNone: () => ({ model }),
        onSome: (path) => ({ model, outMessage: Request.RequestedOpenPath({ path }) }),
      }),
  })

// ---------------------------------------------------------------------------------------------------
// Rendering the book

/** A colour value in the book gets a swatch beside it. */
export const isColour = (text: string): boolean => /^#[0-9a-f]{6}$/i.test(text) || /^rgba?\([\d\s.,]+\)$/.test(text)

const inlineView = (h: HtmlBuilder<Message>, part: Inline): Html | string => {
  switch (part.kind) {
    case "text":
      return part.text
    case "code":
      return isColour(part.text)
        ? h.code([], [h.span([h.Class("swatch"), h.AriaHidden(true)], [h.i([h.Style({ background: part.text })])]), part.text])
        : h.code([], [part.text])
    case "strong":
      return h.strong([], [part.text])
    case "link":
      return /^https?:/.test(part.href)
        ? h.a([h.Href(part.href), h.Target("_blank"), h.Rel("noopener")], [part.text])
        : h.button([h.Class("hp-link"), h.OnClick(Message.ClickedLink({ href: part.href }))], [part.text])
  }
}

const inlines = (h: HtmlBuilder<Message>, parts: ReadonlyArray<Inline>): ReadonlyArray<Html | string> => parts.map((part) => inlineView(h, part))

const blockView = (h: HtmlBuilder<Message>, block: Block): Html => {
  switch (block.kind) {
    case "heading":
      return block.level <= 3 ? h.h3([h.Class("hp-h3")], inlines(h, block.text)) : h.h4([h.Class("hp-h4")], inlines(h, block.text))
    case "paragraph":
      return h.p([], inlines(h, block.text))
    case "list":
      return (block.isOrdered ? h.ol : h.ul)([], block.items.map((item) => h.li([], inlines(h, item))))
    case "table":
      return h.div(
        [h.Class("hp-table-wrap")],
        [
          h.table(
            [],
            [
              h.thead([], [h.tr([], block.head.map((cell) => h.th([], inlines(h, cell))))]),
              h.tbody([], block.rows.map((row) => h.tr([], row.map((cell) => h.td([], inlines(h, cell)))))),
            ],
          ),
        ],
      )
    case "code":
      return h.pre([h.Class("hp-code")], [block.text])
  }
}

const findTopic = (id: string): Option.Option<Topic> => Array.findFirst(topics, (topic) => topic.id === id)

const search = (query: string): ReadonlyArray<Topic> => {
  const words = query.toLowerCase().split(/\s+/).filter((word) => word.length > 0)
  return topics.filter((topic) => {
    const text = topicText(topic).toLowerCase()
    return words.every((word) => text.includes(word))
  })
}

const snippet = (topic: Topic, query: string): string => {
  const text = topicText(topic).slice(topic.title.length).trim()
  const at = text.toLowerCase().indexOf(query.toLowerCase().split(/\s+/)[0] ?? "")
  const start = Math.max(0, at - 60)
  return `${start > 0 ? "..." : ""}${text.slice(start, start + 180)}...`
}

const homeTiles = (h: HtmlBuilder<Message>): Html =>
  h.div(
    [h.Class("hp-home-tiles")],
    topics.slice(1).map((topic) =>
      h.button([h.Class("hp-home-tile"), h.OnClick(Message.ClickedTopic({ id: topic.id }))], [h.img([h.Src(glyphUrl("topic")), h.Alt(""), h.Width("16"), h.Height("16")]), topic.title]),
    ),
  )

const pageView = (h: HtmlBuilder<Message>, model: Model): Html =>
  model.page._tag === "Results"
    ? pipe(search(model.page.query), (results) =>
        h.article(
          [h.Class("hp-page")],
          [
            h.h2([h.Class("hp-title")], [`${results.length === 0 ? "No" : results.length} ${results.length === 1 ? "result" : "results"} for "${model.page._tag === "Results" ? model.page.query : ""}"`]),
            results.length === 0
              ? h.p([], ["Try fewer words, or browse the topics on the left."])
              : h.ol(
                  [h.Class("hp-results")],
                  results.map((topic) =>
                    h.li(
                      [],
                      [
                        h.button([h.Class("hp-link hp-result-title"), h.OnClick(Message.ClickedTopic({ id: topic.id }))], [topic.title]),
                        h.p([h.Class("hp-result-snippet")], [snippet(topic, model.page._tag === "Results" ? model.page.query : "")]),
                      ],
                    ),
                  ),
                ),
          ],
        ),
      )
    : Option.match(findTopic(model.page.id), {
        onNone: () => h.article([h.Class("hp-page")], [h.p([], ["This topic is not in the design book."])]),
        onSome: (topic) =>
          h.article(
            [h.Class("hp-page"), h.AriaLabel(topic.title)],
            [
              h.h2([h.Class("hp-title")], [topic.title]),
              ...topic.blocks.map((block) => blockView(h, block)),
              topic.id === homeId ? homeTiles(h) : h.empty,
            ],
          ),
      })

const currentTopicId = (model: Model): string => (model.page._tag === "Topic" ? model.page.id : "")

const contents = (h: HtmlBuilder<Message>, model: Model): Html =>
  h.nav(
    [h.Class("hp-contents"), h.AriaLabel("Contents")],
    [
      h.h2([h.Class("hp-contents-title")], ["Contents"]),
      h.ul(
        [],
        topics.map((topic) =>
          h.li(
            [],
            [
              h.button(
                [h.Class(`hp-contents-item${currentTopicId(model) === topic.id ? " is-selected" : ""}`), h.OnClick(Message.ClickedTopic({ id: topic.id }))],
                [h.img([h.Src(glyphUrl("topic")), h.Alt(""), h.Width("16"), h.Height("16")]), topic.id === homeId ? "Design book home" : topic.title],
              ),
            ],
          ),
        ),
      ),
    ],
  )

const tool = (h: HtmlBuilder<Message>, glyph: Parameters<typeof glyphUrl>[0], label: string, message: Option.Option<Message>, isLabelShown: boolean): Html =>
  h.button(
    [h.Class(`hp-tool${isLabelShown ? " has-label" : ""}`), h.Title(label), h.AriaLabel(label), ...Option.match(message, { onNone: () => [h.Disabled(true)], onSome: (each) => [h.OnClick(each)] })],
    [h.img([h.Src(glyphUrl(glyph)), h.Alt(""), h.Width("16"), h.Height("16")]), isLabelShown ? h.span([], [label]) : h.empty],
  )

const searchForm = (h: HtmlBuilder<Message>, model: Model): Html =>
  h.form(
    [h.Class("hp-search"), h.Role("search"), h.OnSubmit(Message.SubmittedSearch())],
    [
      h.input([h.Type("search"), h.Placeholder("Search Help"), h.AriaLabel("Search Help"), h.Value(model.query), h.OnInput((value) => Message.UpdatedQuery({ value }))]),
      h.button([h.Class("hp-search-go"), h.Type("submit"), h.AriaLabel("Search")], [h.img([h.Src(glyphUrl("search")), h.Alt(""), h.Width("16"), h.Height("16")])]),
    ],
  )

const desktopView = (h: HtmlBuilder<Message>, model: Model): Html =>
  h.div(
    [h.Class("help")],
    [
      h.div(
        [h.Class("hp-top")],
        [
          h.div(
            [h.Class("ex-travel")],
            [
              h.button([h.Class("ex-travel-back"), h.AriaLabel("Back"), ...(model.back.length === 0 ? [h.Disabled(true)] : [h.OnClick(Message.ClickedBack())])], [h.span([h.Class("ex-arrow")])]),
              h.button([h.Class("ex-travel-forward"), h.AriaLabel("Forward"), ...(model.forward.length === 0 ? [h.Disabled(true)] : [h.OnClick(Message.ClickedForward())])], [h.span([h.Class("ex-arrow")])]),
            ],
          ),
          h.span([h.Class("hp-top-spacer")]),
          searchForm(h, model),
        ],
      ),
      h.div(
        [h.Class("hp-toolbar"), h.Role("toolbar")],
        [
          tool(h, "home", "Help and Support home", Option.some(Message.ClickedHome()), false),
          tool(h, "print", "Print", Option.none(), false),
          tool(h, "browse", "Browse Help", Option.some(Message.ToggledContents()), false),
          h.span([h.Class("hp-toolbar-spacer")]),
          h.a(
            [h.Class("hp-tool has-label"), h.Href("https://github.com/NickSuomi/heron#readme"), h.Target("_blank"), h.Rel("noopener")],
            [h.img([h.Src(glyphUrl("ask")), h.Alt(""), h.Width("16"), h.Height("16")]), h.span([], ["Plain docs"])],
          ),
          tool(h, "options", "Options", Option.none(), true),
        ],
      ),
      h.div([h.Class("hp-body")], [model.isContentsShown ? contents(h, model) : h.empty, h.div([h.Class("hp-scroll")], [pageView(h, model)])]),
      h.div([h.Class("hp-status")], [h.span([h.Class("hp-status-mode")], ["Offline Help"]), h.span([], ["Nothing on this page loads from the network."])]),
    ],
  )

const phoneView = (h: HtmlBuilder<Message>, model: Model): Html =>
  h.div(
    [h.Class("hp-phone")],
    [
      searchForm(h, model),
      model.isContentsShown
        ? h.ul(
            [h.Class("hp-phone-topics")],
            topics.map((topic) =>
              h.li([], [h.button([h.OnClick(Message.ClickedTopic({ id: topic.id }))], [topic.id === homeId ? "Design book home" : topic.title])]),
            ),
          )
        : h.empty,
      h.div([h.Class("hp-phone-bar")], [h.button([h.Class("wm-button"), h.OnClick(Message.ToggledContents())], [model.isContentsShown ? "Hide contents" : "Contents"])]),
      pageView(h, model),
    ],
  )

export const view = Submodel.defineView<Model, Message, ViewInputs>((model, inputs, h) =>
  inputs.form === "Phone" ? phoneView(h, model) : desktopView(h, model),
)
