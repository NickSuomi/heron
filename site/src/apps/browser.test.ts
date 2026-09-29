import { describe, expect, it } from "vitest"

import { currentUrl, init, Message, type Model, OutMessage, update } from "./browser"
import { parse } from "./gitlabRoutes"

const signedOut = { isSignedIn: false }
const signedIn = { isSignedIn: true }

const send = (model: Model, message: Message, context = signedOut) => update(model, message, context)

const typeAndGo = (model: Model, address: string, context = signedOut) =>
  send(send(model, Message.TypedAddress({ value: address }), context).model, Message.SubmittedAddress(), context)

describe("the browser", () => {
  it("opens on the sign-in page, or on !42 when the visitor signed in earlier", () => {
    expect(currentUrl(init(false))).toBe("https://gitlab.heron.local/users/sign_in")
    expect(currentUrl(init(true))).toBe("https://gitlab.heron.local/acme/storefront/-/merge_requests/42")
  })

  it("signs in with any credentials and lands on the merge request", () => {
    const typed = [Message.TypedUsername({ value: "ada" }), Message.TypedPassword({ value: "anything" })].reduce((model, message) => send(model, message).model, init(false))
    const result = send(typed, Message.SubmittedSignIn())
    expect(result.outMessage).toEqual(OutMessage.SignedIn({ username: "ada" }))
    expect(currentUrl(result.model)).toBe("https://gitlab.heron.local/acme/storefront/-/merge_requests/42")
    expect(result.model.form.password).toBe("")
  })

  it("sends a signed-out visitor from a project page to sign in, and back after", () => {
    const bounced = typeAndGo(init(false), "gitlab.heron.local/acme/storefront/-/merge_requests/42/diffs").model
    expect(currentUrl(bounced)).toBe(
      "https://gitlab.heron.local/users/sign_in?redirect_to=https%3A%2F%2Fgitlab.heron.local%2Facme%2Fstorefront%2F-%2Fmerge_requests%2F42%2Fdiffs",
    )
    expect(currentUrl(send(bounced, Message.SubmittedSignIn()).model)).toBe("https://gitlab.heron.local/acme/storefront/-/merge_requests/42/diffs")
  })

  it("cannot display a host outside the mock site, and shows GitLab's 404 for an unknown path", () => {
    const outside = typeAndGo(init(true), "www.example.com", signedIn).model
    expect(parse(currentUrl(outside))).toEqual({ _tag: "CannotDisplay", address: "http://www.example.com/" })
    const missing = typeAndGo(init(true), "http://gitlab.heron.local/acme/nothing", signedIn).model
    expect(currentUrl(missing)).toBe("https://gitlab.heron.local/acme/nothing")
    expect(parse(currentUrl(missing))._tag).toBe("NotFound")
  })

  it("keeps a history per tab that Back and Forward walk", () => {
    const start = init(true)
    const changes = send(start, Message.ClickedLink({ url: "https://gitlab.heron.local/acme/storefront/-/merge_requests/42/diffs" }), signedIn).model
    const back = send(changes, Message.ClickedBack(), signedIn).model
    expect(currentUrl(back)).toBe(currentUrl(start))
    expect(currentUrl(send(back, Message.ClickedForward(), signedIn).model)).toBe(currentUrl(changes))
    const tabbed = send(back, Message.ClickedNewTab(), signedIn).model
    expect(currentUrl(tabbed)).toBe("about:Tabs")
    expect(currentUrl(send(tabbed, Message.ClickedBack(), signedIn).model)).toBe("about:Tabs")
  })

  it("marks a navigation as loading until its load completes, and Stop ends it", () => {
    const loading = send(init(true), Message.ClickedRefresh(), signedIn)
    const tab = loading.model.tabs[0]
    expect(tab?.maybeLoading._tag).toBe("Some")
    const navId = tab?.maybeLoading._tag === "Some" ? tab.maybeLoading.value : -1
    expect(send(loading.model, Message.CompletedLoad({ tabId: 1, navId }), signedIn).model.tabs[0]?.maybeLoading._tag).toBe("None")
    expect(send(loading.model, Message.ClickedStop(), signedIn).model.tabs[0]?.maybeLoading._tag).toBe("None")
  })
})
