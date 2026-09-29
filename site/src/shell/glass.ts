import { Effect } from "effect"
import { Mount } from "foldkit"

import { Message } from "../message"
import { createGlass, type GlassOptions, supportsHtmlInCanvas } from "../vendor/canvas-ui/Glass/GlassVanilla"

// Canvas UI Glass renders one lens over HTML it draws into a canvas. Heron OS pins that lens over a
// whole title bar or taskbar and feeds it a copy of the wallpaper aligned to the surface, so the chrome
// refracts and frosts what lies behind it. The lens follows pointer events; this module sends it one
// synthetic event at the surface centre whenever the surface moves.

export const isNativeGlassAvailable = (): boolean => {
  if (new URLSearchParams(window.location.search).has("css-glass") || !supportsHtmlInCanvas()) return false
  return document.createElement("canvas").getContext("webgl2") !== null
}

/** The lens is a rounded rectangle no wider than four times its height; wider surfaces clip a taller lens. */
const lensFor = (width: number, height: number, corner: number): GlassOptions => {
  const isWide = width / height > 4
  const size = isWide ? width / 8 : height / 2
  const halfShort = Math.min(height / 2, width / 2)
  return {
    shape: "rectangle",
    size,
    aspect: isWide ? 4 : Math.max(1, width / height),
    corner,
    edge: Math.min(Math.max(1 - 7 / Math.max(halfShort, 8), 0), 0.98),
    bevel: 3,
    ior: 1.18,
    depth: 36,
    aberration: 0.35,
    blur: 3.2,
    reflection: 0.5,
    shine: 0.35,
    zoom: 1,
    follow: 1,
  }
}

type Surface = Readonly<{ destroy: () => void }>

const createSurface = (host: HTMLElement): Surface | null => {
  const source = document.createElement("canvas")
  source.setAttribute("layoutsubtree", "true")
  source.className = "glass-source"
  const content = document.createElement("div")
  content.className = "glass-content"
  const wallpaper = document.createElement("div")
  wallpaper.className = "wallpaper glass-wallpaper"
  content.append(wallpaper)
  source.append(content)
  const output = document.createElement("canvas")
  output.className = "glass-output"
  output.setAttribute("aria-hidden", "true")
  host.append(source, output)

  const corner = Number.parseFloat(host.dataset["glassCorner"] ?? "0")
  const rect = host.getBoundingClientRect()
  const instance = createGlass({ source, content, output }, lensFor(rect.width, rect.height, corner))
  if (instance === null) {
    source.remove()
    output.remove()
    return null
  }

  let frame = 0
  const place = () => {
    frame = 0
    const box = host.getBoundingClientRect()
    // A minimised window has no box; the lens waits until it is shown again.
    if (box.width < 1 || box.height < 1) return
    wallpaper.style.transform = `translate(${-box.left}px, ${-box.top}px)`
    instance.setOptions(lensFor(box.width, box.height, corner))
    instance.resize()
    // The lens caches its canvas position and refreshes it on scroll; a moved window needs that refresh.
    content.dispatchEvent(new Event("scroll"))
    content.dispatchEvent(new PointerEvent("pointermove", { clientX: box.left + box.width / 2, clientY: box.top + box.height / 2 }))
  }
  const schedule = () => {
    if (frame === 0) frame = requestAnimationFrame(place)
  }
  place()

  const resizeObserver = new ResizeObserver(schedule)
  resizeObserver.observe(host)
  const moveObserver = new MutationObserver(schedule)
  moveObserver.observe(host.closest("[data-glass-root]") ?? host, { attributes: true, attributeFilter: ["style", "class"] })
  window.addEventListener("resize", schedule)

  return {
    destroy: () => {
      cancelAnimationFrame(frame)
      resizeObserver.disconnect()
      moveObserver.disconnect()
      window.removeEventListener("resize", schedule)
      instance.destroy()
      source.remove()
      output.remove()
    },
  }
}

export const GlassSurface = Mount.define("GlassSurface", {
  messages: [Message.CompletedMountGlass, Message.FailedMountGlass],
  execute: ({ element }) =>
    Effect.gen(function* () {
      const surface = yield* Effect.acquireRelease(
        Effect.sync(() => (element instanceof HTMLElement ? createSurface(element) : null)),
        (created) => Effect.sync(() => created?.destroy()),
      )
      return surface === null ? Message.FailedMountGlass() : Message.CompletedMountGlass()
    }),
})
