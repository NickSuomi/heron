import "./browser.css"

import { Array, Duration, Effect, Option, Schema } from "effect"
import { Command, Submodel, type Update } from "foldkit"
import type { Html, HtmlBuilder } from "foldkit/html"
import { defineMessageUnion } from "foldkit/message"
import { taggedStruct } from "foldkit/schema"

import type { Forge } from "../domain/forge"
import type { Review } from "../domain/review"
import { browserIcons, forgeMark } from "./browserIcons"
import { type Actions, pageView, type PageInputs } from "./gitlab"
import {
  gitlabHost,
  heronOnGitHub,
  isProtected,
  mergeRequestsUrl,
  mergeRequestUrl,
  newTabUrl,
  normalize,
  origin,
  type Page,
  pageTitle,
  parse,
  searchUrl,
  signInUrl,
  signInUrlFor,
} from "./gitlabRoutes"

// Internet Explorer in the manner of version 7 on an Aero desktop: glass back and forward buttons, the address
// bar, refresh and stop, a search box, tabs with Quick Tabs, the command bar and the status bar with its zone.
// Each tab keeps its own history of the mock site. On the phone it is a pocket browser with the same pages.

export const BrowserTab = Schema.Struct({
  id: Schema.Number,
  history: Schema.Array(Schema.String),
  index: Schema.Number,
  /** The navigation being loaded; the status bar shows its progress until it completes or Stop is pressed. */
  maybeLoading: Schema.Option(Schema.Number),
})
export type BrowserTab = typeof BrowserTab.Type

export const Menu = Schema.Literals(["Favorites", "AddFavorite", "History", "TabList", "Home", "Feeds", "Print", "Page", "Tools", "Help", "Zoom"])
export type Menu = typeof Menu.Type

export const Model = taggedStruct("Browser", {
  tabs: Schema.Array(BrowserTab),
  activeTab: Schema.Number,
  nextId: Schema.Number,
  address: Schema.String,
  search: Schema.String,
  maybeMenu: Schema.Option(Menu),
  isQuickTabs: Schema.Boolean,
  maybeHover: Schema.Option(Schema.String),
  /** Where a sign-in goes when its address names no redirect: the merge request the browser was opened for. */
  returnTo: Schema.String,
  form: Schema.Struct({ username: Schema.String, password: Schema.String, isRememberMe: Schema.Boolean }),
  openDetails: Schema.Array(Schema.String),
  isUserMenuOpen: Schema.Boolean,
  isMoreInfoOpen: Schema.Boolean,
})
export type Model = typeof Model.Type

export const Message = defineMessageUnion({
  TypedAddress: { value: Schema.String },
  SubmittedAddress: {},
  ClickedBack: {},
  ClickedForward: {},
  ClickedHistoryEntry: { index: Schema.Number },
  ClickedRefresh: {},
  ClickedStop: {},
  ClickedHome: {},
  CompletedLoad: { tabId: Schema.Number, navId: Schema.Number },
  ClickedLink: { url: Schema.String },
  HoveredLink: { url: Schema.String },
  LeftLink: {},
  ClickedTab: { tabId: Schema.Number },
  ClickedCloseTab: { tabId: Schema.Number },
  ClickedNewTab: {},
  ToggledQuickTabs: {},
  ClickedMenu: { menu: Menu },
  ClosedMenu: {},
  ClickedDeleteHistory: {},
  TypedSearch: { value: Schema.String },
  SubmittedSearch: {},
  TypedUsername: { value: Schema.String },
  TypedPassword: { value: Schema.String },
  ToggledRememberMe: {},
  SubmittedSignIn: {},
  ToggledUserMenu: {},
  ClickedSignOut: {},
  ToggledDetails: { id: Schema.String, isOpen: Schema.Boolean },
  ToggledMoreInfo: {},
})
export type Message = typeof Message.Type

export const OutMessage = defineMessageUnion({
  SignedIn: { username: Schema.String },
  SignedOut: {},
})
export type OutMessage = typeof OutMessage.Type

/** What the browser reads from the shell when it navigates: whether the visitor is signed in to the mock GitLab. */
export type Context = Readonly<{ isSignedIn: boolean }>

const loadTime = Duration.millis(420)

const Load = Command.define("BrowserLoad", {
  args: { tabId: Schema.Number, navId: Schema.Number },
  messages: [Message.CompletedLoad],
  execute: ({ tabId, navId }) => Effect.sleep(loadTime).pipe(Effect.as(Message.CompletedLoad({ tabId, navId }))),
})

const tab = (id: number, url: string): BrowserTab => ({ id, history: [url], index: 0, maybeLoading: Option.none() })

/** Opens on the merge request when the visitor signed in earlier in the session, and on the sign-in page otherwise. */
export const init = (isSignedIn: boolean): Model => {
  const start = isSignedIn ? mergeRequestUrl : signInUrl
  return Model({
    tabs: [tab(1, start)],
    activeTab: 1,
    nextId: 2,
    address: start,
    search: "",
    maybeMenu: Option.none(),
    isQuickTabs: false,
    maybeHover: Option.none(),
    returnTo: mergeRequestUrl,
    form: { username: "", password: "", isRememberMe: false },
    openDetails: [],
    isUserMenuOpen: false,
    isMoreInfoOpen: false,
  })
}

const activeTabOf = (model: Model): BrowserTab =>
  Array.findFirst(model.tabs, (entry) => entry.id === model.activeTab).pipe(Option.getOrElse(() => model.tabs[0] ?? tab(0, newTabUrl)))

const urlOf = (entry: BrowserTab): string => entry.history[entry.index] ?? newTabUrl

export const currentUrl = (model: Model): string => urlOf(activeTabOf(model))

export const title = (model: Model): string => `${pageTitle(parse(currentUrl(model)))} - Internet Explorer`

/** GitLab's redirects: a project page sends a signed-out visitor to sign in, and the sign-in page sends a signed-in one on. */
const redirected = (model: Model, url: string, isSignedIn: boolean): string => {
  const page = parse(url)
  if (isProtected(page) && !isSignedIn) return signInUrlFor(url)
  if (page._tag === "SignIn" && isSignedIn) return Option.getOrElse(page.maybeRedirect, () => model.returnTo)
  return url
}

type Outcome = Update.ReturnWithOutMessage<Model, Message, OutMessage>

const calm = (model: Model): Model => ({ ...model, maybeMenu: Option.none(), isQuickTabs: false, maybeHover: Option.none(), isUserMenuOpen: false })

const withActive = (model: Model, f: (entry: BrowserTab) => BrowserTab): Model => ({
  ...model,
  tabs: model.tabs.map((entry) => (entry.id === model.activeTab ? f(entry) : entry)),
})

/** Loads the active tab's current entry again, as Refresh does and as every navigation ends. */
const load = (model: Model): Outcome => {
  const navId = model.nextId
  const next = withActive({ ...calm(model), nextId: navId + 1 }, (entry) => ({ ...entry, maybeLoading: Option.some(navId) }))
  return { model: { ...next, address: currentUrl(next), isMoreInfoOpen: false }, commands: [Load({ tabId: model.activeTab, navId })] }
}

const navigate = (model: Model, typed: string, isSignedIn: boolean): Outcome => {
  const target = redirected(model, normalize(typed), isSignedIn)
  const isSame = target === currentUrl(model)
  return load(
    isSame
      ? model
      : withActive(model, (entry) => ({ ...entry, history: [...entry.history.slice(0, entry.index + 1), target], index: entry.index + 1 })),
  )
}

const goTo = (model: Model, index: number): Outcome => {
  const entry = activeTabOf(model)
  return index < 0 || index >= entry.history.length || index === entry.index ? { model: calm(model) } : load(withActive(model, (current) => ({ ...current, index })))
}

const closeTab = (model: Model, tabId: number): Model => {
  if (model.tabs.length === 1) return { ...model, tabs: [tab(model.nextId, newTabUrl)], activeTab: model.nextId, nextId: model.nextId + 1, address: "" }
  const at = model.tabs.findIndex((entry) => entry.id === tabId)
  const tabs = model.tabs.filter((entry) => entry.id !== tabId)
  const activeTab = model.activeTab === tabId ? (tabs[Math.min(at, tabs.length - 1)]?.id ?? model.activeTab) : model.activeTab
  const next = { ...model, tabs, activeTab }
  return { ...next, address: addressFor(currentUrl(next)) }
}

const addressFor = (url: string): string => (url === newTabUrl ? "" : url)

export const update = (model: Model, message: Message, context: Context) =>
  Message.match<Outcome>(message, {
    TypedAddress: ({ value }) => ({ model: { ...model, address: value } }),
    SubmittedAddress: () => navigate(model, model.address, context.isSignedIn),
    ClickedBack: () => goTo(model, activeTabOf(model).index - 1),
    ClickedForward: () => goTo(model, activeTabOf(model).index + 1),
    ClickedHistoryEntry: ({ index }) => goTo(model, index),
    ClickedRefresh: () => load(model),
    ClickedStop: () => ({ model: withActive(calm(model), (entry) => ({ ...entry, maybeLoading: Option.none() })) }),
    ClickedHome: () => navigate(model, `${origin}/`, context.isSignedIn),
    CompletedLoad: ({ tabId, navId }) => ({
      model: {
        ...model,
        tabs: model.tabs.map((entry) => (entry.id === tabId && Option.contains(entry.maybeLoading, navId) ? { ...entry, maybeLoading: Option.none() } : entry)),
      },
    }),
    ClickedLink: ({ url }) => navigate(model, url, context.isSignedIn),
    HoveredLink: ({ url }) => ({ model: { ...model, maybeHover: Option.some(url) } }),
    LeftLink: () => ({ model: { ...model, maybeHover: Option.none() } }),
    ClickedTab: ({ tabId }) => {
      const next = { ...calm(model), activeTab: tabId }
      return { model: { ...next, address: addressFor(currentUrl(next)) } }
    },
    ClickedCloseTab: ({ tabId }) => ({ model: closeTab(calm(model), tabId) }),
    ClickedNewTab: () => ({
      model: { ...calm(model), tabs: [...model.tabs, tab(model.nextId, newTabUrl)], activeTab: model.nextId, nextId: model.nextId + 1, address: "" },
    }),
    ToggledQuickTabs: () => ({ model: { ...model, isQuickTabs: !model.isQuickTabs, maybeMenu: Option.none() } }),
    ClickedMenu: ({ menu }) => ({
      model: { ...model, maybeMenu: Option.contains(model.maybeMenu, menu) ? Option.none() : Option.some(menu), isUserMenuOpen: false },
    }),
    ClosedMenu: () => ({ model: Option.isNone(model.maybeMenu) && !model.isUserMenuOpen ? model : { ...model, maybeMenu: Option.none(), isUserMenuOpen: false } }),
    ClickedDeleteHistory: () => ({
      model: { ...calm(model), tabs: model.tabs.map((entry) => ({ ...entry, history: [urlOf(entry)], index: 0 })) },
    }),
    TypedSearch: ({ value }) => ({ model: { ...model, search: value } }),
    SubmittedSearch: () => (model.search.trim() === "" ? { model } : navigate(model, searchUrl(model.search.trim()), context.isSignedIn)),
    TypedUsername: ({ value }) => ({ model: { ...model, form: { ...model.form, username: value } } }),
    TypedPassword: ({ value }) => ({ model: { ...model, form: { ...model.form, password: value } } }),
    ToggledRememberMe: () => ({ model: { ...model, form: { ...model.form, isRememberMe: !model.form.isRememberMe } } }),
    SubmittedSignIn: () => {
      const page = parse(currentUrl(model))
      const target = page._tag === "SignIn" ? Option.getOrElse(page.maybeRedirect, () => model.returnTo) : model.returnTo
      return { ...navigate({ ...model, form: { ...model.form, password: "" } }, target, true), outMessage: OutMessage.SignedIn({ username: model.form.username }) }
    },
    ToggledUserMenu: () => ({ model: { ...model, isUserMenuOpen: !model.isUserMenuOpen, maybeMenu: Option.none() } }),
    ClickedSignOut: () => ({ ...navigate({ ...model, isUserMenuOpen: false }, signInUrl, false), outMessage: OutMessage.SignedOut() }),
    ToggledDetails: ({ id, isOpen }) => ({
      model: { ...model, openDetails: isOpen ? (model.openDetails.includes(id) ? model.openDetails : [...model.openDetails, id]) : model.openDetails.filter((open) => open !== id) },
    }),
    ToggledMoreInfo: () => ({ model: { ...model, isMoreInfoOpen: !model.isMoreInfoOpen } }),
  })

// View

/** `idPrefix` is unique to the window, for the ids the pages give their fields. */
export type ViewInputs = Readonly<{ review: Review; forge: Forge; now: number; isPhone: boolean; idPrefix: string }>

const actions: Actions<Message> = {
  go: (url) => Message.ClickedLink({ url }),
  hover: (url) => Message.HoveredLink({ url }),
  leave: Message.LeftLink(),
  toggleDetails: (id, isOpen) => Message.ToggledDetails({ id, isOpen }),
  typedUsername: (value) => Message.TypedUsername({ value }),
  typedPassword: (value) => Message.TypedPassword({ value }),
  toggledRememberMe: Message.ToggledRememberMe(),
  submittedSignIn: Message.SubmittedSignIn(),
  toggledUserMenu: Message.ToggledUserMenu(),
  clickedSignOut: Message.ClickedSignOut(),
}

type H = HtmlBuilder<Message>

/** A signed-out visitor who reaches a project page (say, after signing out in another window) sees the sign-in page. */
const shownPage = (url: string, inputs: ViewInputs): Page => {
  const page = parse(url)
  return isProtected(page) && Option.isNone(inputs.forge.maybeUser) ? { _tag: "SignIn", maybeRedirect: Option.some(url) } : page
}

const pageIcon = (url: string): string => {
  const page = parse(url)
  return page._tag === "CannotDisplay" ? browserIcons.info : page._tag === "NewTab" || page._tag === "Search" ? browserIcons.pageGlobe : forgeMark
}

/**
 * The text fields are uncontrolled: foldkit writes a controlled `value` back on every render, and a render that lands
 * between a keystroke and its input message would drop the keystroke. The address field is keyed instead, so a
 * navigation or a tab switch mounts a fresh field that shows the new address, and typing is left alone.
 */
const addressKey = (model: Model): string => `address-${model.activeTab}-${model.nextId}`

const img = (h: H, src: string, className = "", size = 16) => h.img([h.Class(className), h.Src(src), h.Alt(""), h.Width(String(size)), h.Height(String(size))])

const externalLink = (h: H, url: string, className: string, children: ReadonlyArray<Html | string>) =>
  h.a([h.Class(className), h.Href(url), h.Target("_blank"), h.Rel("noopener noreferrer"), h.OnMouseEnter(Message.HoveredLink({ url })), h.OnMouseLeave(Message.LeftLink()), h.OnClick(Message.ClosedMenu())], children)

// IE's own pages

const cannotDisplayView = (h: H, model: Model, address: string, isPhone: boolean): Html => {
  const isWeb = /^https?:\/\//.test(address)
  return h.div(
    [h.Class(`ie-error${isPhone ? " is-mobile" : ""}`)],
    [
      h.div([h.Class("ie-error-head")], [img(h, browserIcons.info, "ie-error-icon", 32), h.h1([], ["Internet Explorer cannot display the webpage"])]),
      h.div(
        [h.Class("ie-error-body")],
        [
          h.h2([], ["Most likely causes:"]),
          h.ul([], [h.li([], ["You are not connected to the Internet."]), h.li([], ["The website is encountering problems."]), h.li([], ["There might be a typing error in the address."])]),
          h.h2([], ["What you can try:"]),
          h.div(
            [h.Class("ie-error-try")],
            [
              h.button([h.Class("ie-error-button"), h.Disabled(true)], [img(h, browserIcons.tools), "Diagnose Connection Problems"]),
              h.button(
                [h.Class(`ie-error-more${model.isMoreInfoOpen ? " is-open" : ""}`), h.AriaExpanded(model.isMoreInfoOpen), h.OnClick(Message.ToggledMoreInfo())],
                [h.span([h.Class("ie-chevron")]), "More information"],
              ),
            ],
          ),
          model.isMoreInfoOpen
            ? h.div(
                [h.Class("ie-error-info")],
                [
                  h.p([], [`This browser runs inside Heron OS and reaches one website, ${gitlabHost}. `, h.strong([], [address]), " is outside it."]),
                  ...(isWeb ? [h.p([], [externalLink(h, address, "ie-error-link", [`Open ${address} in your own browser`]), " (a new tab)."])] : []),
                  h.p([], ["Try ", h.a([h.Class("ie-error-link"), h.Href(mergeRequestUrl), h.OnClick(Message.ClickedLink({ url: mergeRequestUrl }), { defaultAction: "Prevent" })], [mergeRequestUrl]), "."]),
                ],
              )
            : h.empty,
        ],
      ),
    ],
  )
}

const newTabView = (h: H): Html =>
  h.div(
    [h.Class("ie-newtab")],
    [
      h.h1([], ["You've opened a new tab"]),
      h.p([], ["Type an address in the Address Bar, or use one of these pages. Heron OS reaches ", h.strong([], [gitlabHost]), " and nothing else."]),
      h.div(
        [h.Class("ie-newtab-links")],
        [
          h.a([h.Href(mergeRequestUrl), h.OnClick(Message.ClickedLink({ url: mergeRequestUrl }), { defaultAction: "Prevent" })], [img(h, forgeMark), "Merge request !42 · acme/storefront"]),
          h.a([h.Href(mergeRequestsUrl), h.OnClick(Message.ClickedLink({ url: mergeRequestsUrl }), { defaultAction: "Prevent" })], [img(h, forgeMark), "Merge requests · acme/storefront"]),
          externalLink(h, heronOnGitHub, "", [img(h, browserIcons.favorites), "Heron on GitHub (opens in your own browser)"]),
        ],
      ),
      h.h2([], ["Using tabs"]),
      h.ul(
        [],
        [
          h.li([], ["Open a new tab with the small blank tab at the end of the tab row."]),
          h.li([], ["Quick Tabs, the button with four squares, shows every open tab at once."]),
          h.li([], ["Close a tab with the X on it."]),
        ],
      ),
    ],
  )

const contentView = (h: H, model: Model, url: string, inputs: ViewInputs, isPhone: boolean): Html => {
  const page = shownPage(url, inputs)
  const pageInputs: PageInputs = {
    review: inputs.review,
    forge: inputs.forge,
    now: inputs.now,
    form: model.form,
    openDetails: model.openDetails,
    isUserMenuOpen: model.isUserMenuOpen,
    isMobile: isPhone,
    idPrefix: inputs.idPrefix,
  }
  return page._tag === "CannotDisplay"
    ? cannotDisplayView(h, model, page.address, isPhone)
    : page._tag === "NewTab"
      ? newTabView(h)
      : pageView(h, page, pageInputs, actions)
}

// Chrome

type MenuEntry = Readonly<{ label: string; icon?: string; message?: Message; href?: string; isChecked?: boolean }> | "separator"

const menuEntries = (model: Model, menu: Menu): ReadonlyArray<MenuEntry> => {
  const entry = activeTabOf(model)
  switch (menu) {
    case "History":
      return entry.history
        .map((url, index) => ({ label: pageTitle(parse(url)), icon: pageIcon(url), message: Message.ClickedHistoryEntry({ index }), isChecked: index === entry.index }))
        .reverse()
    case "TabList":
      return model.tabs.map((current) => ({ label: pageTitle(parse(urlOf(current))), icon: pageIcon(urlOf(current)), message: Message.ClickedTab({ tabId: current.id }), isChecked: current.id === model.activeTab }))
    case "Home":
      return [{ label: gitlabHost, icon: forgeMark, message: Message.ClickedHome() }, "separator", { label: "Add or Change Home Page..." }, { label: "Remove" }]
    case "Feeds":
      return [{ label: "No Feeds Detected on this Page" }]
    case "Print":
      return [{ label: "Print...", icon: browserIcons.print }, { label: "Print Preview..." }, { label: "Page Setup..." }]
    case "Page":
      return [{ label: "New Tab", icon: browserIcons.newTab, message: Message.ClickedNewTab() }, { label: "New Window" }, "separator", { label: "Cut" }, { label: "Copy" }, { label: "Paste" }, "separator", { label: "Zoom" }, { label: "Text Size" }, "separator", { label: "View Source" }]
    case "Tools":
      return [{ label: "Delete Browsing History...", message: Message.ClickedDeleteHistory() }, "separator", { label: "Pop-up Blocker" }, { label: "Manage Add-ons" }, "separator", { label: "Full Screen" }, { label: "Toolbars" }, "separator", { label: "Internet Options" }]
    case "Help":
      return [{ label: "Contents and Index" }, { label: "Heron on GitHub", href: heronOnGitHub }, "separator", { label: "About Internet Explorer" }]
    case "AddFavorite":
      return [{ label: "Add to Favorites...", icon: browserIcons.addFavorite }, { label: "Add Tab Group to Favorites..." }, "separator", { label: "Import and Export..." }]
    case "Zoom":
      return [{ label: "Zoom In" }, { label: "Zoom Out" }, "separator", { label: "400%" }, { label: "200%" }, { label: "100%", isChecked: true }, { label: "75%" }, { label: "50%" }]
    case "Favorites":
      return []
  }
}

const menuView = (h: H, model: Model, menu: Menu, className: string): Html =>
  h.div(
    [h.Class(`ie-menu ${className}`), h.Role("menu")],
    menuEntries(model, menu).map((entry) =>
      entry === "separator"
        ? h.div([h.Class("ie-menu-sep"), h.Role("separator")])
        : entry.href !== undefined
          ? externalLink(h, entry.href, "ie-menu-item", [h.span([h.Class("ie-menu-icon")], entry.icon === undefined ? [] : [img(h, entry.icon)]), entry.label])
          : h.button(
              [
                h.Class(`ie-menu-item${entry.isChecked === true ? " is-checked" : ""}`),
                h.Role("menuitem"),
                ...(entry.message === undefined ? [h.Disabled(true)] : [h.OnClick(entry.message)]),
              ],
              [h.span([h.Class("ie-menu-icon")], entry.icon === undefined ? [] : [img(h, entry.icon)]), h.span([h.Class("ie-menu-label")], [entry.label])],
            ),
    ),
  )

const isOpen = (model: Model, menu: Menu) => Option.contains(model.maybeMenu, menu)

const favoritesView = (h: H): Html => {
  const favorite = (label: string, url: string) =>
    h.a([h.Class("ie-fav"), h.Href(url), h.OnClick(Message.ClickedLink({ url }), { defaultAction: "Prevent" }), h.OnMouseEnter(Message.HoveredLink({ url })), h.OnMouseLeave(Message.LeftLink())], [img(h, forgeMark), label])
  return h.div(
    [h.Class("ie-favorites"), h.Role("dialog"), h.AriaLabel("Favorites Center")],
    [
      h.div([h.Class("ie-fav-tabs")], [h.span([h.Class("ie-fav-tab is-active")], [img(h, browserIcons.favorites), "Favorites"]), h.span([h.Class("ie-fav-tab")], [img(h, browserIcons.feedsDisabled), "Feeds"]), h.span([h.Class("ie-fav-tab")], ["History"])]),
      h.div(
        [h.Class("ie-fav-list")],
        [
          h.div([h.Class("ie-fav-folder")], [h.span([h.Class("ie-fav-folder-icon")]), "Heron"]),
          externalLink(h, heronOnGitHub, "ie-fav is-nested", [img(h, browserIcons.pageGlobe), "Heron on GitHub"]),
          h.div([h.Class("ie-fav-folder")], [h.span([h.Class("ie-fav-folder-icon")]), gitlabHost]),
          h.div([h.Class("ie-fav-nested")], [favorite("Merge request !42 · acme/storefront", mergeRequestUrl), favorite("Merge requests · acme/storefront", mergeRequestsUrl), favorite("Sign in · GitLab", signInUrl)]),
        ],
      ),
      h.p([h.Class("ie-fav-note")], ["Heron on GitHub opens in your own browser, in a new tab."]),
    ],
  )
}

const glassButton = (h: H, direction: "back" | "forward", isEnabled: boolean): Html =>
  h.button(
    [
      h.Class(`ie-orb ie-orb-${direction}`),
      h.AriaLabel(direction === "back" ? "Back" : "Forward"),
      h.Title(direction === "back" ? "Back" : "Forward"),
      ...(isEnabled ? [h.OnClick(direction === "back" ? Message.ClickedBack() : Message.ClickedForward())] : [h.Disabled(true)]),
    ],
    [img(h, direction === "back" ? browserIcons.arrowBack : browserIcons.arrowForward, "ie-orb-arrow")],
  )

const commandButton = (h: H, model: Model, menu: Menu, label: string, icon: string, isEnabled = true): Html =>
  h.div(
    [h.Class("ie-cmd-slot")],
    [
      h.button(
        [
          h.Class(`ie-cmd${isOpen(model, menu) ? " is-open" : ""}${isEnabled ? "" : " is-disabled"}`),
          h.Title(label),
          h.AriaLabel(label),
          h.AriaHasPopup("menu"),
          h.AriaExpanded(isOpen(model, menu)),
          h.OnClick(Message.ClickedMenu({ menu })),
        ],
        [img(h, icon), ...(menu === "Page" || menu === "Tools" ? [h.span([h.Class("ie-cmd-label")], [label])] : []), img(h, browserIcons.dropdown, "ie-dropdown", 8)],
      ),
      isOpen(model, menu) ? menuView(h, model, menu, "is-right") : h.empty,
    ],
  )

const tabView = (h: H, model: Model, entry: BrowserTab): Html => {
  const url = urlOf(entry)
  const isActive = entry.id === model.activeTab
  return h.keyed("div")(
    `tab-${entry.id}`,
    [h.Class(`ie-tab${isActive ? " is-active" : ""}${Option.isSome(entry.maybeLoading) ? " is-loading" : ""}`), h.Role("tab"), h.AriaSelected(isActive)],
    [
      h.button([h.Class("ie-tab-main"), h.Title(pageTitle(parse(url))), h.OnClick(Message.ClickedTab({ tabId: entry.id }))], [
        Option.isSome(entry.maybeLoading) ? h.span([h.Class("ie-throbber")]) : img(h, pageIcon(url), "ie-tab-icon"),
        h.span([h.Class("ie-tab-title")], [pageTitle(parse(url))]),
      ]),
      isActive ? h.button([h.Class("ie-tab-close"), h.AriaLabel("Close Tab"), h.Title("Close Tab (Ctrl+W)"), h.OnClick(Message.ClickedCloseTab({ tabId: entry.id }))]) : h.empty,
    ],
  )
}

const quickTabsView = (h: H, model: Model, inputs: ViewInputs): Html =>
  h.div(
    [h.Class("ie-quicktabs")],
    model.tabs.map((entry) =>
      h.div(
        [h.Class(`ie-qt${entry.id === model.activeTab ? " is-active" : ""}`)],
        [
          h.div([h.Class("ie-qt-head")], [h.span([h.Class("ie-qt-title")], [pageTitle(parse(urlOf(entry)))]), h.button([h.Class("ie-qt-close"), h.AriaLabel("Close Tab"), h.OnClick(Message.ClickedCloseTab({ tabId: entry.id }))])]),
          h.button(
            [h.Class("ie-qt-thumb"), h.AriaLabel(`Switch to ${pageTitle(parse(urlOf(entry)))}`), h.OnClick(Message.ClickedTab({ tabId: entry.id }))],
            [h.div([h.Class("ie-qt-page"), h.Inert(true), h.AriaHidden(true)], [contentView(h, model, urlOf(entry), inputs, false)])],
          ),
        ],
      ),
    ),
  )

const statusText = (model: Model): string => {
  const entry = activeTabOf(model)
  return Option.isSome(entry.maybeLoading)
    ? `Waiting for ${urlOf(entry)}...`
    : Option.getOrElse(model.maybeHover, () => (parse(urlOf(entry))._tag === "CannotDisplay" ? "Cannot find server" : "Done"))
}

const desktopView = (model: Model, inputs: ViewInputs, h: H): Html => {
  const entry = activeTabOf(model)
  const url = urlOf(entry)
  const isLoading = Option.isSome(entry.maybeLoading)
  const isSecure = url.startsWith("https://") && parse(url)._tag !== "CannotDisplay"
  const isMenuOpen = Option.isSome(model.maybeMenu) || model.isUserMenuOpen
  return h.div(
    [h.Class("ie")],
    [
      isMenuOpen ? h.div([h.Class("ie-scrim"), h.OnClick(Message.ClosedMenu())]) : h.empty,
      h.div(
        [h.Class("ie-nav")],
        [
          h.div(
            [h.Class("ie-orbs")],
            [
              glassButton(h, "back", entry.index > 0),
              glassButton(h, "forward", entry.index < entry.history.length - 1),
              h.div(
                [h.Class("ie-cmd-slot")],
                [
                  h.button([h.Class("ie-orbs-history"), h.AriaLabel("Recent Pages"), h.Title("Recent Pages"), h.OnClick(Message.ClickedMenu({ menu: "History" }))], [img(h, browserIcons.dropdown, "", 8)]),
                  isOpen(model, "History") ? menuView(h, model, "History", "is-left") : h.empty,
                ],
              ),
            ],
          ),
          h.form(
            [h.Class("ie-address"), h.OnSubmit(Message.SubmittedAddress())],
            [
              img(h, pageIcon(url), "ie-address-icon"),
              h.keyed("input")(addressKey(model), [
                h.Class("ie-address-input"),
                h.Type("text"),
                h.AriaLabel("Address Bar"),
                h.Attribute("value", model.address),
                h.Spellcheck(false),
                h.Autocomplete("off"),
                h.Placeholder(url === newTabUrl ? "" : url),
                h.OnInput((value) => Message.TypedAddress({ value })),
              ]),
              ...(isSecure ? [h.span([h.Class("ie-address-lock"), h.Title("Website Identification")], [img(h, browserIcons.padlock)])] : []),
              h.span([h.Class("ie-address-drop")], [img(h, browserIcons.dropdown, "", 8)]),
            ],
          ),
          h.button([h.Class("ie-nav-button"), h.AriaLabel("Refresh"), h.Title("Refresh (F5)"), h.OnClick(Message.ClickedRefresh())], [img(h, browserIcons.refresh)]),
          h.button(
            [h.Class("ie-nav-button"), h.AriaLabel("Stop"), h.Title("Stop (Esc)"), ...(isLoading ? [h.OnClick(Message.ClickedStop())] : [h.Disabled(true)])],
            [img(h, isLoading ? browserIcons.stop : browserIcons.stopDisabled)],
          ),
          h.form(
            [h.Class("ie-search"), h.OnSubmit(Message.SubmittedSearch())],
            [
              h.input([h.Class("ie-search-input"), h.Type("search"), h.AriaLabel("Search"), h.Placeholder("Search"), h.OnInput((value) => Message.TypedSearch({ value }))]),
              h.button([h.Class("ie-search-go"), h.Type("submit"), h.AriaLabel("Search"), h.Title("Search (Alt+Enter)")], [img(h, browserIcons.search)]),
              h.span([h.Class("ie-search-drop")], [img(h, browserIcons.dropdown, "", 8)]),
            ],
          ),
        ],
      ),
      h.div(
        [h.Class("ie-frame")],
        [
          h.div(
            [h.Class("ie-tabrow")],
            [
              h.div(
                [h.Class("ie-cmd-slot")],
                [
                  h.button([h.Class(`ie-star${isOpen(model, "Favorites") ? " is-open" : ""}`), h.AriaLabel("Favorites Center"), h.Title("Favorites Center (Alt+C)"), h.OnClick(Message.ClickedMenu({ menu: "Favorites" }))], [img(h, browserIcons.favorites)]),
                  isOpen(model, "Favorites") ? favoritesView(h) : h.empty,
                ],
              ),
              h.div(
                [h.Class("ie-cmd-slot")],
                [
                  h.button([h.Class(`ie-star${isOpen(model, "AddFavorite") ? " is-open" : ""}`), h.AriaLabel("Add to Favorites"), h.Title("Add to Favorites (Alt+Z)"), h.OnClick(Message.ClickedMenu({ menu: "AddFavorite" }))], [img(h, browserIcons.addFavorite)]),
                  isOpen(model, "AddFavorite") ? menuView(h, model, "AddFavorite", "is-left") : h.empty,
                ],
              ),
              h.span([h.Class("ie-tabrow-sep")]),
              ...(model.tabs.length > 1
                ? [
                    h.button([h.Class(`ie-qt-button${model.isQuickTabs ? " is-open" : ""}`), h.AriaLabel("Quick Tabs"), h.Title("Quick Tabs (Ctrl+Q)"), h.AriaPressed(String(model.isQuickTabs)), h.OnClick(Message.ToggledQuickTabs())], [img(h, browserIcons.quickTabs)]),
                    h.div(
                      [h.Class("ie-cmd-slot")],
                      [
                        h.button([h.Class("ie-qt-list"), h.AriaLabel("Tab List"), h.Title("Tab List"), h.OnClick(Message.ClickedMenu({ menu: "TabList" }))], [img(h, browserIcons.dropdown, "", 8)]),
                        isOpen(model, "TabList") ? menuView(h, model, "TabList", "is-left") : h.empty,
                      ],
                    ),
                  ]
                : []),
              h.div(
                [h.Class("ie-tabs"), h.Role("tablist")],
                [
                  ...model.tabs.map((current) => tabView(h, model, current)),
                  h.button([h.Class("ie-tab-new"), h.AriaLabel("New Tab"), h.Title("New Tab (Ctrl+T)"), h.OnClick(Message.ClickedNewTab())], [h.span([h.Class("ie-tab-new-icon")])]),
                ],
              ),
              h.div(
                [h.Class("ie-cmdbar")],
                [
                  commandButton(h, model, "Home", "Home (Alt+M)", browserIcons.home),
                  commandButton(h, model, "Feeds", "No Feeds Detected on this Page", browserIcons.feedsDisabled, false),
                  commandButton(h, model, "Print", "Print (Alt+R)", browserIcons.print),
                  commandButton(h, model, "Page", "Page", browserIcons.page),
                  commandButton(h, model, "Tools", "Tools", browserIcons.tools),
                  commandButton(h, model, "Help", "Help (Alt+L)", browserIcons.help),
                ],
              ),
            ],
          ),
          h.div(
            [h.Class("ie-viewport")],
            [model.isQuickTabs ? quickTabsView(h, model, inputs) : h.keyed("div")(`page-${entry.id}-${entry.index}`, [h.Class("ie-page")], [contentView(h, model, url, inputs, false)])],
          ),
          h.footer(
            [h.Class("ie-status")],
            [
              h.span([h.Class("ie-status-text")], [
                ...(isLoading ? [h.span([h.Class("ie-status-progress")], [h.span([h.Class("ie-status-bar")])])] : []),
                statusText(model),
              ]),
              h.span([h.Class("ie-status-zone")], [img(h, browserIcons.globe), "Internet | Protected Mode: On"]),
              h.div(
                [h.Class("ie-cmd-slot ie-status-zoom")],
                [
                  h.button([h.Class("ie-zoom"), h.AriaLabel("Change Zoom Level"), h.OnClick(Message.ClickedMenu({ menu: "Zoom" }))], [img(h, browserIcons.zoom), "100%", img(h, browserIcons.dropdown, "", 8)]),
                  isOpen(model, "Zoom") ? menuView(h, model, "Zoom", "is-up") : h.empty,
                ],
              ),
            ],
          ),
        ],
      ),
    ],
  )
}

/** The pocket browser: an address line with Go, the page in one column, and a toolbar above the soft keys. */
const mobileView = (model: Model, inputs: ViewInputs, h: H): Html => {
  const entry = activeTabOf(model)
  const url = urlOf(entry)
  const isLoading = Option.isSome(entry.maybeLoading)
  return h.div(
    [h.Class("iem")],
    [
      h.form(
        [h.Class("iem-address"), h.OnSubmit(Message.SubmittedAddress())],
        [
          img(h, pageIcon(url), "iem-address-icon"),
          h.keyed("input")(addressKey(model), [h.Class("iem-address-input"), h.Type("text"), h.AriaLabel("Address"), h.Attribute("value", model.address), h.Spellcheck(false), h.Autocomplete("off"), h.OnInput((value) => Message.TypedAddress({ value }))]),
          h.button([h.Class("iem-go"), h.Type("submit"), h.AriaLabel("Go")], [img(h, browserIcons.arrowForward)]),
        ],
      ),
      isLoading ? h.div([h.Class("iem-progress")], [h.span([])]) : h.empty,
      h.div([h.Class("iem-page")], [h.keyed("div")(`page-${entry.id}-${entry.index}`, [h.Class("iem-page-inner")], [contentView(h, model, url, inputs, true)])]),
      Option.isSome(model.maybeMenu) && isOpen(model, "Favorites")
        ? h.div(
            [h.Class("iem-favorites")],
            [
              h.div([h.Class("iem-favorites-title")], ["Favorites"]),
              h.button([h.Class("iem-fav"), h.OnClick(Message.ClickedLink({ url: mergeRequestUrl }))], [img(h, forgeMark), "Merge request !42"]),
              h.button([h.Class("iem-fav"), h.OnClick(Message.ClickedLink({ url: mergeRequestsUrl }))], [img(h, forgeMark), "Merge requests"]),
              externalLink(h, heronOnGitHub, "iem-fav", [img(h, browserIcons.pageGlobe), "Heron on GitHub"]),
            ],
          )
        : h.empty,
      h.nav(
        [h.Class("iem-toolbar")],
        [
          h.button([h.Class("iem-tool"), h.AriaLabel("Back"), ...(entry.index > 0 ? [h.OnClick(Message.ClickedBack())] : [h.Disabled(true)])], [img(h, browserIcons.arrowBack, "iem-tool-arrow"), "Back"]),
          h.button([h.Class("iem-tool"), h.AriaLabel("Favorites"), h.OnClick(Message.ClickedMenu({ menu: "Favorites" }))], [img(h, browserIcons.favorites), "Favorites"]),
          h.button([h.Class("iem-tool"), h.AriaLabel(isLoading ? "Stop" : "Refresh"), h.OnClick(isLoading ? Message.ClickedStop() : Message.ClickedRefresh())], [img(h, isLoading ? browserIcons.stop : browserIcons.refresh)]),
          h.button([h.Class("iem-tool"), h.AriaLabel("Home"), h.OnClick(Message.ClickedHome())], [img(h, browserIcons.home)]),
        ],
      ),
    ],
  )
}

export const view = Submodel.defineView<Model, Message, ViewInputs>((model, inputs, h): Html =>
  inputs.isPhone ? mobileView(model, inputs, h) : desktopView(model, inputs, h),
)
