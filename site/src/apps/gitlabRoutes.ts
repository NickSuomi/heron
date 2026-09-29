import { Option } from "effect"

import { mr42 } from "../data/mr42"

// The addresses the mock browser can reach. gitlab.heron.local serves the fictional GitLab; search.heron.local
// answers the search box; every other host is unreachable, and Internet Explorer says it cannot display the page.

export const gitlabHost = "gitlab.heron.local"
export const searchHost = "search.heron.local"
export const origin = `https://${gitlabHost}`
export const projectPath = mr42.project
export const projectUrl = `${origin}/${projectPath}`
export const mergeRequestsUrl = `${projectUrl}/-/merge_requests`
export const mergeRequestUrl = `${mergeRequestsUrl}/${mr42.iid}`
export const signInUrl = `${origin}/users/sign_in`
export const newTabUrl = "about:Tabs"
export const heronOnGitHub = "https://github.com/NickSuomi/heron"

export type MergeRequestTab = "Overview" | "Commits" | "Changes"
export type MergeRequestState = "opened" | "merged" | "all"

export type Page =
  | Readonly<{ _tag: "SignIn"; maybeRedirect: Option.Option<string> }>
  | Readonly<{ _tag: "Dashboard" }>
  | Readonly<{ _tag: "Project" }>
  | Readonly<{ _tag: "MergeRequests"; state: MergeRequestState }>
  | Readonly<{ _tag: "MergeRequest"; tab: MergeRequestTab }>
  | Readonly<{ _tag: "Blob"; path: string; maybeLine: Option.Option<number> }>
  | Readonly<{ _tag: "NotFound" }>
  | Readonly<{ _tag: "Search"; query: string }>
  | Readonly<{ _tag: "NewTab" }>
  | Readonly<{ _tag: "CannotDisplay"; address: string }>

const tabSuffix: Record<MergeRequestTab, string> = { Overview: "", Commits: "/commits", Changes: "/diffs" }

export const mergeRequestTabUrl = (tab: MergeRequestTab): string => `${mergeRequestUrl}${tabSuffix[tab]}`

export const blobUrl = (path: string, maybeLine: Option.Option<number> = Option.none()): string =>
  `${projectUrl}/-/blob/${mr42.head}/${path}${Option.match(maybeLine, { onNone: () => "", onSome: (line) => `#L${line}` })}`

export const signInUrlFor = (redirect: string): string => `${signInUrl}?redirect_to=${encodeURIComponent(redirect)}`

/** What the address bar holds after the visitor presses Enter: a scheme is added and the host is lowercased. */
export const normalize = (typed: string): string => {
  const text = typed.trim()
  if (text === "") return newTabUrl
  if (/^about:/i.test(text)) return text.toLowerCase() === "about:tabs" ? newTabUrl : text
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `http://${text}`
  try {
    const url = new URL(withScheme)
    // The mock hosts send every visitor to https, as a GitLab instance does.
    if (url.protocol === "http:" && (url.hostname === gitlabHost || url.hostname === searchHost)) url.protocol = "https:"
    return url.pathname === "/" && url.search === "" && url.hash === "" ? `${url.protocol}//${url.host}/` : url.href
  } catch {
    return text
  }
}

const changedPaths = new Set(mr42.files.map((file) => file.path))

const gitlabPage = (url: URL): Page => {
  const path = url.pathname.replace(/\/+$/, "")
  if (path === "" || path === "/dashboard/projects") return { _tag: "Dashboard" }
  if (path === "/users/sign_in")
    return { _tag: "SignIn", maybeRedirect: Option.filter(Option.fromNullOr(url.searchParams.get("redirect_to")), (to) => to.startsWith(origin)) }
  if (path === `/${projectPath}`) return { _tag: "Project" }
  if (path === `/${projectPath}/-/merge_requests`) {
    const state = url.searchParams.get("state")
    return { _tag: "MergeRequests", state: state === "merged" || state === "all" ? state : "opened" }
  }
  const mergeRequest = new RegExp(`^/${projectPath}/-/merge_requests/${mr42.iid}(/commits|/diffs)?$`).exec(path)
  if (mergeRequest !== null) return { _tag: "MergeRequest", tab: mergeRequest[1] === "/commits" ? "Commits" : mergeRequest[1] === "/diffs" ? "Changes" : "Overview" }
  const blobPrefix = `/${projectPath}/-/blob/${mr42.head}/`
  if (path.startsWith(blobPrefix)) {
    const file = decodeURIComponent(path.slice(blobPrefix.length))
    const line = /^#L(\d+)$/.exec(url.hash)
    if (changedPaths.has(file)) return { _tag: "Blob", path: file, maybeLine: Option.map(Option.fromNullOr(line?.[1]), Number) }
  }
  return { _tag: "NotFound" }
}

export const parse = (address: string): Page => {
  if (address === newTabUrl) return { _tag: "NewTab" }
  try {
    const url = new URL(address)
    if (url.protocol !== "https:" && url.protocol !== "http:") return { _tag: "CannotDisplay", address }
    if (url.hostname === gitlabHost) return gitlabPage(url)
    if (url.hostname === searchHost) return { _tag: "Search", query: url.searchParams.get("q") ?? "" }
    return { _tag: "CannotDisplay", address }
  } catch {
    return { _tag: "CannotDisplay", address }
  }
}

export const searchUrl = (query: string): string => `https://${searchHost}/results?q=${encodeURIComponent(query)}`

/** A project page needs a signed-in user: acme/storefront is internal, as GitLab calls it. */
export const isProtected = (page: Page): boolean =>
  page._tag === "Dashboard" || page._tag === "Project" || page._tag === "MergeRequests" || page._tag === "MergeRequest" || page._tag === "Blob"

const projectTitle = "Acme / storefront · GitLab"

/** The document title, as the tab and the window caption show it. */
export const pageTitle = (page: Page): string => {
  switch (page._tag) {
    case "SignIn":
      return "Sign in · GitLab"
    case "Dashboard":
      return "Projects · Dashboard · GitLab"
    case "Project":
      return projectTitle
    case "MergeRequests":
      return `Merge requests · ${projectTitle}`
    case "MergeRequest":
      return `${mr42.title} (!${mr42.iid}) · Merge requests · ${projectTitle}`
    case "Blob":
      return `${page.path} · ${mr42.head.slice(0, 8)} · ${projectTitle}`
    case "NotFound":
      return "Not Found · GitLab"
    case "Search":
      return `${page.query} - Search`
    case "NewTab":
      return "New Tab"
    case "CannotDisplay":
      return "Internet Explorer cannot display the webpage"
  }
}

/** What the search box finds: the pages of the mock site, and Heron itself. */
export const searchIndex: ReadonlyArray<Readonly<{ title: string; url: string; summary: string }>> = [
  { title: `${mr42.title} (!${mr42.iid})`, url: mergeRequestUrl, summary: `Merge request !${mr42.iid} in ${projectPath}, reviewed by Heron. A fictional example.` },
  { title: "Merge requests · acme/storefront", url: mergeRequestsUrl, summary: "The merge requests of the fictional project acme/storefront." },
  { title: "acme/storefront", url: projectUrl, summary: "A fictional project on gitlab.heron.local, made for the Heron OS demo." },
  { title: "Sign in · GitLab", url: signInUrl, summary: "Sign in to gitlab.heron.local. Any username and password work; nothing leaves the page." },
  { title: "Heron on GitHub", url: heronOnGitHub, summary: "The real Heron repository: source, README and docs." },
]

export const search = (query: string) => {
  const words = query.toLowerCase().split(/\s+/).filter((word) => word !== "")
  return words.length === 0
    ? []
    : searchIndex.filter((entry) => words.some((word) => `${entry.title} ${entry.summary} ${entry.url}`.toLowerCase().includes(word)))
}

export const isExternal = (url: string): boolean => url.startsWith("https://github.com/")
