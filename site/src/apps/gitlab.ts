import "./gitlab.css"

import { Array, Option } from "effect"
import type { Attribute, Html, HtmlBuilder } from "foldkit/html"
import { labelNames } from "virtual:heron-build"

import { type ChangedFile, mr42 } from "../data/mr42"
import { type Forge, timeAgo } from "../domain/forge"
import { isReportNotePosted, labelsOf, type Review } from "../domain/review"
import { forgeMark } from "./browserIcons"
import { type Block, type Inline, parseMarkdown, plainText } from "./gitlabMarkdown"
import {
  blobUrl,
  heronOnGitHub,
  isExternal,
  mergeRequestsUrl,
  mergeRequestTabUrl,
  mergeRequestUrl,
  type MergeRequestState,
  type MergeRequestTab,
  origin,
  type Page,
  projectPath,
  projectUrl,
  search,
  signInUrl,
} from "./gitlabRoutes"
import { highlight, languageOf, type Token } from "./highlight"

// The mock GitLab at gitlab.heron.local: a 2009-era web app (glossy header, gradient tabs, rounded boxes) laid
// out the way GitLab lays out a project today (a project sidebar, merge request tabs, a label sidebar). Every
// mark and glyph is drawn for Heron OS. The merge request is the fictional acme/storefront !42 from `mr42`.

export type SignInForm = Readonly<{ username: string; password: string; isRememberMe: boolean }>

export type PageInputs = Readonly<{
  review: Review
  forge: Forge
  now: number
  form: SignInForm
  openDetails: ReadonlyArray<string>
  isUserMenuOpen: boolean
  isMobile: boolean
  /** Unique to the browser window, so two windows on the sign-in page keep their labels on their own fields. */
  idPrefix: string
}>

/** What the pages ask the browser to do. The browser owns navigation, the form and the open details. */
export type Actions<M> = Readonly<{
  go: (url: string) => M
  hover: (url: string) => M
  leave: M
  toggleDetails: (id: string, isOpen: boolean) => M
  typedUsername: (value: string) => M
  typedPassword: (value: string) => M
  toggledRememberMe: M
  submittedSignIn: M
  toggledUserMenu: M
  clickedSignOut: M
}>

type Ctx<M> = Readonly<{ h: HtmlBuilder<M>; on: Actions<M>; inputs: PageInputs }>

const heronGlyphUrl = `${import.meta.env.BASE_URL}brand/assets/heron-mark-mono-ink.svg`
const note = parseMarkdown(mr42.note)
const botName = "heron-bot"
const shortHead = mr42.head.slice(0, 8)

/** Two merged merge requests that came before !42, so the list reads like a project's. Fictional, as !42 is. */
const earlierMergeRequests = [
  { iid: 41, title: "Filter the project list by name", author: "frontend-dev", labels: ["frontend"], when: "merged 3 days ago" },
  { iid: 40, title: "Add the empty state to the project list", author: "frontend-dev", labels: ["frontend"], when: "merged 1 week ago" },
] as const

// Links

const link = <M>({ h, on }: Ctx<M>, url: string, attributes: ReadonlyArray<Attribute<M>>, children: ReadonlyArray<Html | string>): Html =>
  isExternal(url)
    ? h.a([h.Href(url), h.Target("_blank"), h.Rel("noopener noreferrer"), h.OnMouseEnter(on.hover(url)), h.OnMouseLeave(on.leave), ...attributes], children)
    : h.a(
        [h.Href(url), h.OnClick(on.go(url), { defaultAction: "Prevent" }), h.OnMouseEnter(on.hover(url)), h.OnMouseLeave(on.leave), ...attributes],
        children,
      )

// Labels, avatars, badges

const labelColour = (label: string): string =>
  label === labelNames.inProgress
    ? "#e8a33c"
    : label === labelNames.changesRequested
      ? "#d64a3b"
      : label === labelNames.pass
        ? "#3f9b3a"
        : label === labelNames.blocked
          ? "#333"
          : "#3f78b5"

export const labelView = <M>(h: HtmlBuilder<M>, label: string): Html => {
  const [scope, name] = label.includes("::") ? label.split("::") : [label, undefined]
  return h.keyed("span")(
    label,
    [h.Class(`gl-label${name === undefined ? "" : " is-scoped"}`), h.Style({ "--label": labelColour(label) }), h.Title(label)],
    name === undefined
      ? [h.span([h.Class("gl-label-text")], [label])]
      : [h.span([h.Class("gl-label-scope")], [scope ?? ""]), h.span([h.Class("gl-label-text")], [name])],
  )
}

const avatarColours = ["#6f4fb5", "#3a86c8", "#2f9e7a", "#d1782b", "#c2455a"]

const avatar = <M>(h: HtmlBuilder<M>, user: string, size: "s" | "m" | "l" = "m"): Html =>
  user === botName
    ? h.span([h.Class(`gl-avatar is-${size} is-bot`)], [h.img([h.Src(heronGlyphUrl), h.Alt("")])])
    : h.span(
        [h.Class(`gl-avatar is-${size}`), h.Style({ background: avatarColours[user.length % avatarColours.length] ?? "#3a86c8" }), h.AriaHidden(true)],
        [user.slice(0, 1).toUpperCase()],
      )

const badge = <M>(h: HtmlBuilder<M>, kind: "open" | "merged" | "fictional" | "bot", text: string): Html => h.span([h.Class(`gl-badge is-${kind}`)], [text])

const icon = <M>(h: HtmlBuilder<M>, name: string): Html => h.span([h.Class(`gl-icon gl-icon-${name}`), h.AriaHidden(true)])

// Frame: broadcast banner, header, project sidebar

const broadcast = <M>(h: HtmlBuilder<M>): Html =>
  h.div(
    [h.Class("gl-broadcast"), h.Role("note")],
    [icon(h, "megaphone"), "gitlab.heron.local is a mock GitLab inside Heron OS. The project acme/storefront and its merge requests are fictional."],
  )

const headerView = <M>(ctx: Ctx<M>): Html => {
  const { h, on, inputs } = ctx
  const brand = link(ctx, `${origin}/`, [h.Class("gl-brand")], [h.img([h.Src(forgeMark), h.Alt(""), h.Width("24"), h.Height("24")]), h.span([], ["GitLab"])])
  const user = Option.match(inputs.forge.maybeUser, {
    onNone: () => [link(ctx, signInUrl, [h.Class("gl-header-signin")], ["Sign in"])],
    onSome: (name) => [
      h.span([h.Class("gl-header-icon"), h.Title("Merge requests")], [icon(h, "mr"), h.span([h.Class("gl-count")], ["1"])]),
      h.span([h.Class("gl-header-icon"), h.Title("To-Do List")], [icon(h, "todo")]),
      h.div(
        [h.Class("gl-user-slot")],
        [
          h.button([h.Class(`gl-user${inputs.isUserMenuOpen ? " is-open" : ""}`), h.AriaExpanded(inputs.isUserMenuOpen), h.OnClick(on.toggledUserMenu)], [avatar(h, name, "s"), h.span([h.Class("gl-caret")])]),
          inputs.isUserMenuOpen
            ? h.div(
                [h.Class("gl-user-menu"), h.Role("menu")],
                [
                  h.div([h.Class("gl-user-menu-name")], [h.strong([], [name]), h.span([], [`@${name}`])]),
                  h.div([h.Class("gl-user-menu-sep")]),
                  h.button([h.Class("gl-user-menu-item"), h.Role("menuitem"), h.OnClick(on.clickedSignOut)], ["Sign out"]),
                ],
              )
            : h.empty,
        ],
      ),
    ],
  })
  return h.header(
    [h.Class("gl-header")],
    [
      brand,
      ...(inputs.isMobile
        ? []
        : [
            h.nav([h.Class("gl-header-nav")], [link(ctx, `${origin}/`, [h.Class("gl-header-link")], ["Projects ", h.span([h.Class("gl-caret")])]), h.span([h.Class("gl-header-link is-muted")], ["Groups ", h.span([h.Class("gl-caret")])])]),
            h.div([h.Class("gl-header-search")], [icon(h, "search"), h.input([h.Class("gl-header-search-input"), h.Placeholder("Search GitLab"), h.AriaLabel("Search GitLab"), h.Readonly(true)])]),
          ]),
      h.div([h.Class("gl-header-right")], user),
    ],
  )
}

type Section = "Overview" | "Repository" | "MergeRequests"

const sidebar = <M>(ctx: Ctx<M>, active: Section): Html => {
  const { h } = ctx
  const item = (section: Section | "Issues" | "Pipelines" | "Wiki" | "Settings", label: string, iconName: string, url: Option.Option<string>, count?: string) =>
    Option.match(url, {
      onNone: () => h.span([h.Class("gl-side-item is-disabled")], [icon(h, iconName), h.span([h.Class("gl-side-label")], [label]), ...(count === undefined ? [] : [h.span([h.Class("gl-pill")], [count])])]),
      onSome: (href) =>
        link(ctx, href, [h.Class(`gl-side-item${section === active ? " is-active" : ""}`)], [icon(h, iconName), h.span([h.Class("gl-side-label")], [label]), ...(count === undefined ? [] : [h.span([h.Class("gl-pill")], [count])])]),
    })
  return h.aside(
    [h.Class("gl-sidebar")],
    [
      link(ctx, projectUrl, [h.Class("gl-side-project")], [h.span([h.Class("gl-project-avatar")], ["S"]), h.span([], ["storefront"])]),
      item("Overview", "Project overview", "home", Option.some(projectUrl)),
      item("Repository", "Repository", "doc", Option.some(blobUrl(mr42.files[2]?.path ?? ""))),
      item("Issues", "Issues", "issues", Option.none(), "0"),
      item("MergeRequests", "Merge requests", "mr", Option.some(mergeRequestsUrl), "1"),
      item("Pipelines", "CI/CD", "rocket", Option.none()),
      item("Wiki", "Wiki", "book", Option.none()),
      item("Settings", "Settings", "gear", Option.none()),
    ],
  )
}

const crumbs = <M>(ctx: Ctx<M>, trail: ReadonlyArray<readonly [string, Option.Option<string>]>): Html => {
  const { h } = ctx
  return h.nav(
    [h.Class("gl-crumbs"), h.AriaLabel("Breadcrumbs")],
    trail.flatMap(([label, url], index) => [
      ...(index === 0 ? [] : [h.span([h.Class("gl-crumb-sep")], ["›"])]),
      Option.match(url, { onNone: () => h.span([h.Class("gl-crumb is-current")], [label]), onSome: (href) => link(ctx, href, [h.Class("gl-crumb")], [label]) }),
    ]),
  )
}

const projectCrumbs = [["Acme", Option.none()], ["storefront", Option.some(projectUrl)]] as const

const projectFrame = <M>(ctx: Ctx<M>, active: Section, trail: ReadonlyArray<readonly [string, Option.Option<string>]>, body: ReadonlyArray<Html>): Html => {
  const { h, inputs } = ctx
  return h.div(
    [h.Class(`gl${inputs.isMobile ? " is-mobile" : ""}`)],
    [
      headerView(ctx),
      broadcast(h),
      h.div(
        [h.Class("gl-layout")],
        [...(inputs.isMobile ? [] : [sidebar(ctx, active)]), h.main([h.Class("gl-content")], [crumbs(ctx, [...projectCrumbs, ...trail]), ...body])],
      ),
    ],
  )
}

// Markdown

const inlineView = <M>(ctx: Ctx<M>, inline: Inline): Html | string => {
  const { h } = ctx
  switch (inline._tag) {
    case "Text":
      return inline.text
    case "Code":
      return h.code([h.Class("gl-md-code")], [inline.text])
    case "Strong":
      return h.strong([], inline.children.map((child) => inlineView(ctx, child)))
    case "Link":
      return link(ctx, inline.href, [h.Class("gl-md-link")], inline.children.map((child) => inlineView(ctx, child)))
    case "Break":
      return h.br([])
  }
}

const inlines = <M>(ctx: Ctx<M>, children: ReadonlyArray<Inline>) => children.map((child) => inlineView(ctx, child))

const blockView = <M>(ctx: Ctx<M>, block: Block, isTight = false): Html => {
  const { h, on, inputs } = ctx
  switch (block._tag) {
    case "Heading":
      return (block.level <= 2 ? h.h2 : block.level === 3 ? h.h3 : h.h4)([h.Class("gl-md-heading")], inlines(ctx, block.children))
    case "Paragraph":
      return isTight ? h.span([], inlines(ctx, block.children)) : h.p([], inlines(ctx, block.children))
    case "List":
      return h.ul([h.Class(block.isLoose ? "is-loose" : "is-tight")], block.items.map((item) => h.li([], item.map((child) => blockView(ctx, child, !block.isLoose)))))
    case "Table":
      return h.div(
        [h.Class("gl-md-table-wrap")],
        [
          h.table(
            [h.Class("gl-md-table")],
            [
              h.thead([], [h.tr([], block.head.map((cell) => h.th([], inlines(ctx, cell))))]),
              h.tbody([], block.rows.map((row) => h.tr([], row.map((cell) => h.td([], inlines(ctx, cell)))))),
            ],
          ),
        ],
      )
    case "Details": {
      const id = plainText(block.summary)
      const isOpen = inputs.openDetails.includes(id)
      return h.details(
        [h.Class("gl-md-details"), h.Open(isOpen), h.OnToggle((open) => on.toggleDetails(id, open))],
        [h.summary([], inlines(ctx, block.summary)), ...block.children.map((child) => blockView(ctx, child))],
      )
    }
  }
}

// Sign in

const signInView = <M>(ctx: Ctx<M>, maybeRedirect: Option.Option<string>): Html => {
  const { h, on, inputs } = ctx
  return h.div(
    [h.Class(`gl gl-signin-page${inputs.isMobile ? " is-mobile" : ""}`)],
    [
      h.div(
        [h.Class("gl-signin-brand")],
        [h.img([h.Src(forgeMark), h.Alt(""), h.Width("56"), h.Height("56")]), h.h1([], ["GitLab"]), h.p([], ["gitlab.heron.local"])],
      ),
      ...Option.match(Option.filter(maybeRedirect, () => Option.isNone(inputs.forge.maybeUser)), {
        onNone: () => [],
        onSome: () => [h.div([h.Class("gl-flash is-alert"), h.Role("alert")], ["You need to sign in or sign up before continuing."])],
      }),
      h.div(
        [h.Class("gl-signin-box")],
        [
          h.div([h.Class("gl-signin-tabs")], [h.span([h.Class("gl-signin-tab is-active")], ["Sign in"]), h.span([h.Class("gl-signin-tab is-muted")], ["Register"])]),
          h.form(
            [h.Class("gl-signin-form"), h.OnSubmit(on.submittedSignIn), h.Autocomplete("off")],
            [
              h.label([h.Class("gl-field-label"), h.For(`${inputs.idPrefix}-username`)], ["Username or email"]),
              h.input([h.Id(`${inputs.idPrefix}-username`), h.Class("gl-field"), h.Type("text"), h.Name("heron-demo-user"), h.Attribute("value", inputs.form.username), h.Autocomplete("off"), h.Spellcheck(false), h.OnInput(on.typedUsername)]),
              h.label([h.Class("gl-field-label"), h.For(`${inputs.idPrefix}-password`)], ["Password"]),
              h.input([h.Id(`${inputs.idPrefix}-password`), h.Class("gl-field"), h.Type("password"), h.Name("heron-demo-password"), h.Autocomplete("new-password"), h.OnInput(on.typedPassword)]),
              h.label(
                [h.Class("gl-check")],
                [h.input([h.Type("checkbox"), h.Checked(inputs.form.isRememberMe), h.OnChange(() => on.toggledRememberMe)]), "Remember me"],
              ),
              h.button([h.Class("gl-button is-confirm is-block"), h.Type("submit")], ["Sign in"]),
            ],
          ),
          h.p(
            [h.Class("gl-signin-note")],
            [icon(h, "lock-note"), "Any username and password work here. Nothing you type leaves this page: there is no server behind gitlab.heron.local."],
          ),
        ],
      ),
      h.p([h.Class("gl-signin-footer")], ["A mock GitLab inside Heron OS. ", link(ctx, heronOnGitHub, [], ["Heron on GitHub"])]),
    ],
  )
}

// Dashboard and project

const dashboardView = <M>(ctx: Ctx<M>): Html => {
  const { h, inputs } = ctx
  return h.div(
    [h.Class(`gl${inputs.isMobile ? " is-mobile" : ""}`)],
    [
      headerView(ctx),
      broadcast(h),
      h.main(
        [h.Class("gl-content is-wide")],
        [
          h.div([h.Class("gl-page-title")], [h.h1([], ["Projects"])]),
          h.div([h.Class("gl-tabs")], [h.span([h.Class("gl-tab is-active")], ["Your projects ", h.span([h.Class("gl-pill")], ["1"])]), h.span([h.Class("gl-tab")], ["Starred projects"]), h.span([h.Class("gl-tab")], ["Explore projects"])]),
          h.ul(
            [h.Class("gl-list")],
            [
              h.li(
                [h.Class("gl-list-row")],
                [
                  h.span([h.Class("gl-project-avatar is-large")], ["S"]),
                  h.div(
                    [h.Class("gl-list-main")],
                    [
                      h.div([], [link(ctx, projectUrl, [h.Class("gl-list-title")], ["Acme / storefront"]), " ", badge(h, "fictional", "Fictional")]),
                      h.p([h.Class("gl-muted")], ["The shop front of a fictional company, made for the Heron OS demo."]),
                    ],
                  ),
                  h.div([h.Class("gl-list-side")], [link(ctx, mergeRequestsUrl, [h.Class("gl-muted")], [icon(h, "mr"), " 1"])]),
                ],
              ),
            ],
          ),
        ],
      ),
    ],
  )
}

const projectView = <M>(ctx: Ctx<M>): Html => {
  const { h } = ctx
  return projectFrame(ctx, "Overview", [], [
    h.div(
      [h.Class("gl-project-head")],
      [
        h.span([h.Class("gl-project-avatar is-huge")], ["S"]),
        h.div(
          [],
          [
            h.h1([], ["storefront ", badge(h, "fictional", "Fictional")]),
            h.p([h.Class("gl-muted")], [projectPath]),
          ],
        ),
      ],
    ),
    h.p([h.Class("gl-project-description")], ["The shop front of Acme, a fictional company. It exists only on this mock GitLab, so that Heron OS can show a Heron review on a merge request."]),
    h.div([h.Class("gl-stats")], [h.span([], [icon(h, "branch"), h.code([h.Class("gl-branch")], [mr42.targetBranch]), " default branch"]), link(ctx, mergeRequestsUrl, [], [icon(h, "mr"), h.strong([], ["1"]), " open merge request"])]),
    h.div(
      [h.Class("gl-box")],
      [
        h.div([h.Class("gl-box-head")], [h.strong([], ["Last activity"])]),
        h.ul(
          [h.Class("gl-activity")],
          [
            h.li([], [avatar(h, mr42.author, "s"), h.strong([], [mr42.author]), " opened merge request ", link(ctx, mergeRequestUrl, [], [`!${mr42.iid}`]), ` "${mr42.title}"`, h.span([h.Class("gl-muted")], [" · yesterday"])]),
            ...earlierMergeRequests.map((mr) => h.li([], [avatar(h, mr.author, "s"), h.strong([], [mr.author]), ` merged merge request !${mr.iid} "${mr.title}"`, h.span([h.Class("gl-muted")], [` · ${mr.when.replace("merged ", "")}`])])),
          ],
        ),
      ],
    ),
  ])
}

// Merge requests

const mergeRequestsView = <M>(ctx: Ctx<M>, state: MergeRequestState): Html => {
  const { h, inputs } = ctx
  const stateTab = (value: MergeRequestState, label: string, count: number) =>
    link(ctx, value === "opened" ? mergeRequestsUrl : `${mergeRequestsUrl}?state=${value}`, [h.Class(`gl-tab${value === state ? " is-active" : ""}`)], [label, " ", h.span([h.Class("gl-pill")], [String(count)])])
  const openRow = h.li(
    [h.Class("gl-list-row gl-mr-row")],
    [
      h.div(
        [h.Class("gl-list-main")],
        [
          h.div([], [link(ctx, mergeRequestUrl, [h.Class("gl-list-title")], [mr42.title]), " ", ...labelsOf(inputs.review).map((label) => labelView(h, label))]),
          h.p([h.Class("gl-muted")], [`!${mr42.iid} · opened yesterday by `, h.strong([], [mr42.author]), ` · ${mr42.sourceBranch} → ${mr42.targetBranch}`]),
        ],
      ),
      h.div([h.Class("gl-list-side")], [badge(h, "open", "Open"), h.span([h.Class("gl-muted")], [icon(h, "comment"), isReportNotePosted(inputs.review) ? " 1" : " 0"])]),
    ],
  )
  const mergedRows = earlierMergeRequests.map((mr) =>
    h.li(
      [h.Class("gl-list-row gl-mr-row")],
      [
        h.div(
          [h.Class("gl-list-main")],
          [h.div([], [h.span([h.Class("gl-list-title is-plain")], [mr.title]), " ", ...mr.labels.map((label) => labelView(h, label))]), h.p([h.Class("gl-muted")], [`!${mr.iid} · ${mr.when} by `, h.strong([], [mr.author])])],
        ),
        h.div([h.Class("gl-list-side")], [badge(h, "merged", "Merged")]),
      ],
    ),
  )
  const rows = state === "opened" ? [openRow] : state === "merged" ? mergedRows : [openRow, ...mergedRows]
  return projectFrame(ctx, "MergeRequests", [["Merge requests", Option.none()]], [
    h.div(
      [h.Class("gl-tabs-bar")],
      [
        h.div([h.Class("gl-tabs")], [stateTab("opened", "Open", 1), stateTab("merged", "Merged", earlierMergeRequests.length), stateTab("all", "All", earlierMergeRequests.length + 1)]),
        h.span([h.Class("gl-button is-confirm is-disabled"), h.Title("Creating merge requests is off on this demo instance")], ["New merge request"]),
      ],
    ),
    h.div([h.Class("gl-filter")], [icon(h, "search"), h.span([h.Class("gl-muted")], ["Search or filter results..."])]),
    h.ul([h.Class("gl-list")], rows),
  ])
}

const additions = (file: ChangedFile) => file.diff.split("\n").filter((line) => line.startsWith("+")).length
const deletions = (file: ChangedFile) => file.diff.split("\n").filter((line) => line.startsWith("-")).length

/** The banner the merge request shows around a dry run: nothing on this page changes, and it says so. */
const dryRunNotice = <M>(ctx: Ctx<M>): Html => {
  const { h, inputs } = ctx
  const { review } = inputs
  if (review._tag === "Running" && review.delivery === "DryRun")
    return h.div([h.Class("gl-flash is-info"), h.Role("status")], [icon(h, "info"), h.span([], [h.strong([], ["Heron is running a dry run of this merge request."]), " A dry run prints the report where it was started and posts nothing here: no note, no label."])])
  if (review._tag === "Done" && review.delivery === "DryRun")
    return h.div(
      [h.Class("gl-flash is-info"), h.Role("status")],
      [icon(h, "info"), h.span([], [h.strong([], [`Heron finished a dry run of this merge request ${timeAgo(review.finishedAt, inputs.now)}.`]), " It printed the report and posted nothing here, so this page has not changed. Run it without --dry-run to post the note."])],
    )
  if (review._tag === "Running" && review.delivery === "Post")
    return h.div([h.Class("gl-flash is-progress"), h.Role("status")], [h.span([h.Class("gl-spinner")]), h.span([], [h.strong([], ["Heron is reviewing this merge request."]), ` It marked it ${labelNames.inProgress ?? "in progress"} and will post its report note here.`])])
  return h.empty
}

type TimelineItem = Readonly<{ at: number; view: Html }>

const systemNote = <M>(h: HtmlBuilder<M>, iconName: string, children: ReadonlyArray<Html | string>): Html =>
  h.li([h.Class("gl-system-note")], [h.span([h.Class("gl-system-icon")], [icon(h, iconName)]), h.div([h.Class("gl-system-body")], children)])

const reportNoteView = <M>(ctx: Ctx<M>): Html => {
  const { h, inputs } = ctx
  return Option.match(inputs.forge.maybeNote, {
    onNone: () => h.empty,
    onSome: (posted) =>
      h.keyed("li")(
        "heron-note",
        [h.Class("gl-note"), h.Id(`note_${mr42.noteId}`)],
        [
          avatar(h, botName, "l"),
          h.div(
            [h.Class("gl-note-box")],
            [
              h.div(
                [h.Class("gl-note-head")],
                [
                  h.strong([h.Class("gl-note-author")], [botName]),
                  h.span([h.Class("gl-muted")], [`@${botName}`]),
                  h.span([h.Class("gl-muted")], ["·"]),
                  h.a([h.Class("gl-note-time"), h.Href(`${mergeRequestUrl}#note_${mr42.noteId}`), h.Title(new Date(posted.createdAt).toLocaleString("en-US"))], [timeAgo(posted.createdAt, inputs.now)]),
                  badge(h, "bot", "Bot"),
                ],
              ),
              h.div([h.Class("gl-note-body gl-md")], note.map((block) => blockView(ctx, block))),
              ...Option.match(posted.maybeEditedAt, {
                onNone: () => [],
                onSome: (at) => [h.p([h.Class("gl-note-edited")], [`Edited ${timeAgo(at, inputs.now)} by `, h.strong([], [botName])])],
              }),
            ],
          ),
        ],
      ),
  })
}

const labelChangeText = <M>(h: HtmlBuilder<M>, added: ReadonlyArray<string>, removed: ReadonlyArray<string>): ReadonlyArray<Html | string> => [
  ...(added.length === 0 ? [] : ["added ", ...added.map((label) => labelView(h, label)), added.length === 1 ? " label" : " labels"]),
  ...(added.length > 0 && removed.length > 0 ? [" and "] : []),
  ...(removed.length === 0 ? [] : ["removed ", ...removed.map((label) => labelView(h, label)), removed.length === 1 ? " label" : " labels"]),
]

const overviewView = <M>(ctx: Ctx<M>): ReadonlyArray<Html> => {
  const { h, inputs } = ctx
  const items: ReadonlyArray<TimelineItem> = [
    ...inputs.forge.labelChanges.map((change) => ({
      at: change.at,
      view: systemNote(h, "label", [h.strong([], [botName]), " ", ...labelChangeText(h, change.added, change.removed), h.span([h.Class("gl-muted")], [` · ${timeAgo(change.at, inputs.now)}`])]),
    })),
    ...Option.match(inputs.forge.maybeNote, { onNone: () => [], onSome: (posted) => [{ at: posted.createdAt, view: reportNoteView(ctx) }] }),
  ]
  return [
    h.div([h.Class("gl-description gl-md")], [h.p([], [mr42.description]), h.p([h.Class("gl-muted gl-small")], ["This merge request is a fictional example written for Heron OS."])]),
    h.div(
      [h.Class("gl-merge-widget")],
      [
        h.div(
          [h.Class("gl-widget-row")],
          [icon(h, "mr-open"), h.span([h.Class("gl-muted")], ["Merging is off on this demo instance."]), h.span([h.Class("gl-button is-confirm is-disabled")], ["Merge"])],
        ),
      ],
    ),
    h.h3([h.Class("gl-activity-title")], ["Activity"]),
    h.ul(
      [h.Class("gl-timeline")],
      [
        systemNote(h, "mr", [h.strong([], [mr42.author]), " opened this merge request", h.span([h.Class("gl-muted")], [" · yesterday"])]),
        systemNote(h, "label", [h.strong([], [mr42.author]), " added ", ...mr42.labels.map((label) => labelView(h, label)), " label", h.span([h.Class("gl-muted")], [" · yesterday"])]),
        ...[...items].sort((a, b) => a.at - b.at).map((item) => item.view),
      ],
    ),
    h.div(
      [h.Class("gl-comment")],
      [
        Option.match(inputs.forge.maybeUser, { onNone: () => h.empty, onSome: (user) => avatar(h, user, "l") }),
        h.div([h.Class("gl-comment-box")], [h.div([h.Class("gl-comment-tabs")], [h.span([h.Class("is-active")], ["Write"]), h.span([], ["Preview"])]), h.textarea([h.Class("gl-comment-input"), h.Placeholder("Write a comment..."), h.AriaLabel("Comment"), h.Disabled(true)]), h.div([h.Class("gl-comment-foot")], [h.span([h.Class("gl-button is-disabled")], ["Comment"]), h.span([h.Class("gl-muted gl-small")], ["Comments are off on this demo instance."])])]),
      ],
    ),
  ]
}

const commitsView = <M>(ctx: Ctx<M>): ReadonlyArray<Html> => {
  const { h } = ctx
  return [
    h.div([h.Class("gl-commit-day")], ["Yesterday ", h.span([h.Class("gl-muted")], ["1 commit"])]),
    h.ul(
      [h.Class("gl-list gl-commits")],
      [
        h.li(
          [h.Class("gl-list-row")],
          [
            avatar(h, mr42.author, "m"),
            h.div([h.Class("gl-list-main")], [h.div([h.Class("gl-list-title is-plain")], [mr42.title]), h.p([h.Class("gl-muted")], [h.strong([], [mr42.author]), " authored yesterday"])]),
            h.div([h.Class("gl-list-side")], [h.span([h.Class("gl-sha")], [shortHead]), h.span([h.Class("gl-button is-small"), h.Title("Copy commit SHA")], [icon(h, "copy")])]),
          ],
        ),
      ],
    ),
  ]
}

// Diffs

type DiffRow = Readonly<{ kind: "hunk" | "context" | "added" | "removed"; oldLine: number | null; newLine: number | null; text: string }>

const diffRows = (diff: string): ReadonlyArray<DiffRow> => {
  let oldLine = 0
  let newLine = 0
  return diff.split("\n").map((line): DiffRow => {
    const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line)
    if (hunk !== null) {
      oldLine = Number(hunk[1])
      newLine = Number(hunk[2])
      return { kind: "hunk", oldLine: null, newLine: null, text: line }
    }
    if (line.startsWith("+")) return { kind: "added", oldLine: null, newLine: newLine++, text: line.slice(1) }
    if (line.startsWith("-")) return { kind: "removed", oldLine: oldLine++, newLine: null, text: line.slice(1) }
    return { kind: "context", oldLine: oldLine++, newLine: newLine++, text: line.slice(1) }
  })
}

const changes = mr42.files.map((file) => ({
  file,
  rows: diffRows(file.diff),
  before: highlight(file.before, languageOf(file.path)),
  after: highlight(file.after, languageOf(file.path)),
}))

const tokensView = <M>(h: HtmlBuilder<M>, tokens: ReadonlyArray<Token> | undefined, fallback: string): ReadonlyArray<Html | string> =>
  tokens === undefined ? [fallback] : tokens.map((token) => (token.kind === "plain" ? token.text : h.span([h.Class(`tk-${token.kind}`)], [token.text])))

const fileIconView = <M>(h: HtmlBuilder<M>): Html => icon(h, "file")

const changesView = <M>(ctx: Ctx<M>): ReadonlyArray<Html> => {
  const { h } = ctx
  const added = mr42.files.reduce((total, file) => total + additions(file), 0)
  const removed = mr42.files.reduce((total, file) => total + deletions(file), 0)
  return [
    h.div([h.Class("gl-diff-summary")], [`Showing ${mr42.files.length} changed files with `, h.strong([h.Class("gl-plus")], [`${added} ${added === 1 ? "addition" : "additions"}`]), " and ", h.strong([h.Class("gl-minus")], [`${removed} ${removed === 1 ? "deletion" : "deletions"}`])]),
    ...changes.map(({ file, rows, before, after }) =>
      h.section(
        [h.Class("gl-diff-file")],
        [
          h.header(
            [h.Class("gl-diff-head")],
            [
              fileIconView(h),
              link(ctx, blobUrl(file.path), [h.Class("gl-diff-path")], [file.path]),
              ...(file.status === "added" ? [h.span([h.Class("gl-badge is-new")], ["new file"])] : []),
              h.span([h.Class("gl-diff-counts")], [h.span([h.Class("gl-plus")], [`+${additions(file)}`]), " ", h.span([h.Class("gl-minus")], [`-${deletions(file)}`])]),
            ],
          ),
          h.table(
            [h.Class("gl-diff")],
            [
              h.tbody(
                [],
                rows.map((row) =>
                  row.kind === "hunk"
                    ? h.tr([h.Class("gl-diff-row is-hunk")], [h.td([h.Class("gl-diff-num")], ["..."]), h.td([h.Class("gl-diff-num")], ["..."]), h.td([h.Class("gl-diff-code")], [row.text])])
                    : h.tr(
                        [h.Class(`gl-diff-row is-${row.kind}`)],
                        [
                          h.td([h.Class("gl-diff-num")], [row.oldLine === null ? "" : String(row.oldLine)]),
                          h.td([h.Class("gl-diff-num")], [row.newLine === null ? "" : String(row.newLine)]),
                          h.td(
                            [h.Class("gl-diff-code")],
                            [
                              h.span([h.Class("gl-diff-sign")], [row.kind === "added" ? "+" : row.kind === "removed" ? "-" : " "]),
                              ...tokensView(h, row.newLine === null ? before[(row.oldLine ?? 1) - 1] : after[row.newLine - 1], row.text),
                            ],
                          ),
                        ],
                      ),
                ),
              ),
            ],
          ),
        ],
      ),
    ),
  ]
}

const mergeRequestSidebar = <M>(ctx: Ctx<M>): Html => {
  const { h, inputs } = ctx
  const block = (title: string, body: ReadonlyArray<Html | string>) => h.div([h.Class("gl-mr-side-block")], [h.div([h.Class("gl-mr-side-title")], [title]), h.div([h.Class("gl-mr-side-value")], body)])
  return h.aside(
    [h.Class("gl-mr-side")],
    [
      block("Assignee", [avatar(h, mr42.author, "s"), mr42.author]),
      block("Reviewers", [h.span([h.Class("gl-muted")], ["None"])]),
      block("Labels", labelsOf(inputs.review).map((label) => labelView(h, label))),
      block("Milestone", [h.span([h.Class("gl-muted")], ["None"])]),
      block("Source branch", [h.code([h.Class("gl-branch")], [mr42.sourceBranch])]),
    ],
  )
}

const mergeRequestView = <M>(ctx: Ctx<M>, tab: MergeRequestTab): Html => {
  const { h, inputs } = ctx
  const discussionCount = isReportNotePosted(inputs.review) ? 1 : 0
  const tabLink = (value: MergeRequestTab, count: number) =>
    link(ctx, mergeRequestTabUrl(value), [h.Class(`gl-tab${value === tab ? " is-active" : ""}`), ...(value === tab ? [h.AriaCurrent("page")] : [])], [value, " ", h.span([h.Class("gl-pill")], [String(count)])])
  const body = tab === "Overview" ? overviewView(ctx) : tab === "Commits" ? commitsView(ctx) : changesView(ctx)
  return projectFrame(ctx, "MergeRequests", [["Merge requests", Option.some(mergeRequestsUrl)], [`!${mr42.iid}`, Option.none()]], [
    h.div(
      [h.Class("gl-mr-head")],
      [
        h.h1([h.Class("gl-mr-title")], [mr42.title]),
        h.div(
          [h.Class("gl-mr-meta")],
          [badge(h, "open", "Open"), badge(h, "fictional", "Fictional example"), h.span([], [h.strong([], [mr42.author]), " requested to merge ", h.code([h.Class("gl-branch")], [mr42.sourceBranch]), " into ", h.code([h.Class("gl-branch")], [mr42.targetBranch]), h.span([h.Class("gl-muted")], [" · yesterday"])])],
        ),
      ],
    ),
    h.div([h.Class("gl-tabs gl-mr-tabs"), h.Role("tablist")], [tabLink("Overview", discussionCount), tabLink("Commits", 1), tabLink("Changes", mr42.files.length)]),
    dryRunNotice(ctx),
    tab === "Changes" || inputs.isMobile
      ? h.div([h.Class("gl-mr-body is-full")], [...body, ...(inputs.isMobile && tab === "Overview" ? [mergeRequestSidebar(ctx)] : [])])
      : h.div([h.Class("gl-mr-columns")], [h.div([h.Class("gl-mr-body")], body), mergeRequestSidebar(ctx)]),
  ])
}

// Files

const blobView = <M>(ctx: Ctx<M>, path: string, maybeLine: Option.Option<number>): Html => {
  const { h } = ctx
  const file = Array.findFirst(mr42.files, (changed) => changed.path === path)
  return Option.match(file, {
    onNone: () => notFoundView(ctx),
    onSome: (changed) => {
      const lines = highlight(changed.after, languageOf(changed.path))
      return projectFrame(ctx, "Repository", [["Repository", Option.none()], [path, Option.none()]], [
        h.div([h.Class("gl-blob-bar")], [h.code([h.Class("gl-branch")], [shortHead]), h.span([h.Class("gl-muted")], [` at the head of !${mr42.iid} · `]), h.strong([], [path])]),
        h.section(
          [h.Class("gl-diff-file")],
          [
            h.header([h.Class("gl-diff-head")], [fileIconView(h), h.span([h.Class("gl-diff-path")], [changed.path.split("/").pop() ?? changed.path]), h.span([h.Class("gl-diff-counts gl-muted")], [`${lines.length} lines`])]),
            h.table(
              [h.Class("gl-blob")],
              [
                h.tbody(
                  [],
                  lines.map((tokens, index) =>
                    h.tr(
                      [h.Class(`gl-blob-row${Option.contains(maybeLine, index + 1) ? " is-target" : ""}`), h.Id(`L${index + 1}`)],
                      [h.td([h.Class("gl-diff-num")], [link(ctx, blobUrl(path, Option.some(index + 1)), [], [String(index + 1)])]), h.td([h.Class("gl-diff-code")], tokensView(h, tokens, ""))],
                    ),
                  ),
                ),
              ],
            ),
          ],
        ),
      ])
    },
  })
}

const notFoundView = <M>(ctx: Ctx<M>): Html => {
  const { h, inputs } = ctx
  return h.div(
    [h.Class(`gl${inputs.isMobile ? " is-mobile" : ""}`)],
    [
      headerView(ctx),
      h.div(
        [h.Class("gl-error")],
        [h.div([h.Class("gl-error-code")], ["404"]), h.h1([], ["Page Not Found"]), h.p([], ["Make sure the address is correct and the page hasn't moved."]), link(ctx, mergeRequestUrl, [h.Class("gl-button")], [`Go to !${mr42.iid}`])],
      ),
    ],
  )
}

// search.heron.local

const searchView = <M>(ctx: Ctx<M>, query: string): Html => {
  const { h } = ctx
  const results = search(query)
  return h.div(
    [h.Class("sr")],
    [
      h.div([h.Class("sr-head")], [h.span([h.Class("sr-brand")], ["Heron OS Search"]), h.span([h.Class("sr-query")], [query])]),
      h.p([h.Class("sr-count")], [results.length === 0 ? `No results for "${query}".` : `${results.length} result${results.length === 1 ? "" : "s"} for "${query}" on this machine`]),
      h.ol(
        [h.Class("sr-results")],
        results.map((result) => h.li([], [link(ctx, result.url, [h.Class("sr-title")], [result.title]), h.p([], [result.summary]), h.span([h.Class("sr-url")], [result.url])])),
      ),
      h.p([h.Class("sr-foot")], ["Heron OS searches only the pages this mock browser can reach."]),
    ],
  )
}

export const pageView = <M>(h: HtmlBuilder<M>, page: Page, inputs: PageInputs, on: Actions<M>): Html => {
  const ctx: Ctx<M> = { h, on, inputs }
  switch (page._tag) {
    case "SignIn":
      return signInView(ctx, page.maybeRedirect)
    case "Dashboard":
      return dashboardView(ctx)
    case "Project":
      return projectView(ctx)
    case "MergeRequests":
      return mergeRequestsView(ctx, page.state)
    case "MergeRequest":
      return mergeRequestView(ctx, page.tab)
    case "Blob":
      return blobView(ctx, page.path, page.maybeLine)
    case "NotFound":
      return notFoundView(ctx)
    case "Search":
      return searchView(ctx, page.query)
    case "NewTab":
    case "CannotDisplay":
      return h.empty
  }
}

