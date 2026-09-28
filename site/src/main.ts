import "@fontsource-variable/inter/opsz.css"
import "@fontsource-variable/jetbrains-mono"
import "./style.css"
import { createBend, supportsHtmlInCanvas, type BendInstance } from "./canvas-ui/Bend/BendVanilla"
import { renderBands, renderProvenance } from "./diff"
import { heronSvg } from "./heron"

const root = document.documentElement
const host = document.getElementById("monolith")!
const face = document.getElementById("face")!
const perch = document.getElementById("perch")!

document.getElementById("gate-bands")!.outerHTML = renderBands()
document.getElementById("prov")!.innerHTML = renderProvenance()
perch.innerHTML = heronSvg

const reduced = window.matchMedia("(prefers-reduced-motion: reduce)")
const params = new URLSearchParams(location.search)
const flat = params.has("flat")
const forceFallback = flat || params.has("css")

const zoneFor = () => Math.round(host.clientHeight * 0.25)
const easeFor = () => Math.round(host.clientHeight * 0.7)
const setZone = () => {
  root.style.setProperty("--zone", `${zoneFor()}px`)
  const rim = bend ? rimY(zoneFor() * 2, 1) : zoneFor()
  root.style.setProperty("--hh", `${Math.round(Math.min(rim - 18, zoneFor() * 0.62, 170))}px`)
}
const bendOptions = () => ({
  zone: zoneFor(),
  angle: 84,
  rounding: Math.round(zoneFor() * 0.55),
  perspective: 900,
  direction: "out" as const,
  ease: easeFor(),
  smoothing: 0.12,
  tumble: 0,
  tilt: 0
})

const mountNative = (): BendInstance | null => {
  const source = document.createElement("canvas")
  source.setAttribute("layoutsubtree", "true")
  source.className = "bend-source"
  const output = document.createElement("canvas")
  output.className = "bend-output"
  output.setAttribute("aria-hidden", "true")
  host.append(source, output)
  source.append(face)
  const bend = createBend({ source, content: face, output }, bendOptions())
  if (bend) return bend
  host.append(face)
  source.remove()
  output.remove()
  return null
}

const bend = !forceFallback && supportsHtmlInCanvas() ? mountNative() : null
root.dataset.fold = flat ? "flat" : bend ? "bend" : "css"

window.addEventListener("resize", () => {
  setZone()
  bend?.setOptions(bendOptions())
  bend?.resize()
  check()
  shade()
})

const catches = Array.from(face.querySelectorAll<HTMLElement>("[data-catch]"))
let struck = false

const pin = (el: HTMLElement, animate: boolean) => {
  const id = el.dataset.catch!
  el.classList.add("caught")
  if (!animate) el.classList.add("still")
  face.querySelector(`[data-pin="${id}"]`)?.classList.add("lit")
  const isBlocker = face.querySelector(`[data-pin="${id}"] .blk`) !== null
  if (animate && isBlocker && !struck) {
    struck = true
    perch.classList.add("striking")
  }
}

const check = () => {
  const top = face.getBoundingClientRect().top
  const edge = zoneFor()
  for (const el of catches) {
    if (el.classList.contains("caught")) continue
    const r = el.getBoundingClientRect()
    if (r.top - top < edge * 1.15) pin(el, !reduced.matches)
  }
}

if (reduced.matches || flat) catches.forEach((el) => pin(el, false))

const ramp = (v: number) => {
  const x = Math.min(Math.max(v / easeFor(), 0), 1)
  return x * x * (3 - 2 * x)
}

const ANGLE = (84 * Math.PI) / 180

/* Screen y of the face's top boundary, following Bend's rounded "out" fold (BendVanilla foldEdge, uDir = 1). */
const rimY = (scrollTop: number, amt: number): number => {
  const h = Math.max(host.clientHeight, 1)
  const o = bendOptions()
  const zone = Math.min(o.zone / h, 0.49)
  if (!bend || amt < 1e-4) return o.zone
  const R = Math.min(o.rounding / h, zone)
  const theta = ANGLE * amt
  const P = o.perspective / h
  const r = R / theta
  const reach = Math.min(scrollTop / h, zone)
  let best = 0
  for (let i = 1; i <= 48; i++) {
    const u = (reach * i) / 48
    const Y = (u <= R ? r * Math.sin(u / r) : r * Math.sin(theta) + (u - R) * Math.cos(theta)) + 1 - zone
    const Z = u <= R ? r * (1 - Math.cos(u / r)) : r * (1 - Math.cos(theta)) + (u - R) * Math.sin(theta)
    best = Math.max(best, 0.5 + ((Y - 0.5) * P) / (P + Math.max(Z, -0.85 * P)))
  }
  return reach === 0 ? o.zone : (1 - best) * h
}

function shade() {
  const max = face.scrollHeight - face.clientHeight
  root.style.setProperty("--top", ramp(face.scrollTop).toFixed(3))
  root.style.setProperty("--edge-y", `${rimY(face.scrollTop, ramp(face.scrollTop)).toFixed(1)}px`)
  root.style.setProperty("--bot", ramp(max - face.scrollTop).toFixed(3))
  root.classList.toggle("at-rest", max - face.scrollTop < 2)
}

let queued = false
face.addEventListener("scroll", () => {
  if (queued) return
  queued = true
  requestAnimationFrame(() => {
    queued = false
    shade()
    check()
  })
}, { passive: true })
setZone()
check()
shade()
