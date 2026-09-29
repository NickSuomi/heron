import { Schema } from "effect"

export const Point = Schema.Struct({ x: Schema.Number, y: Schema.Number })
export type Point = typeof Point.Type

export const Size = Schema.Struct({ width: Schema.Number, height: Schema.Number })
export type Size = typeof Size.Type

export const Rect = Schema.Struct({ x: Schema.Number, y: Schema.Number, width: Schema.Number, height: Schema.Number })
export type Rect = typeof Rect.Type

/** The side or corner of a window frame that a resize drag holds. */
export const Edge = Schema.Literals(["N", "S", "E", "W", "NE", "NW", "SE", "SW"])
export type Edge = typeof Edge.Type

export const edges: ReadonlyArray<Edge> = Edge.literals

export const minimumWindowSize: Size = { width: 260, height: 160 }

export const translate = (rect: Rect, dx: number, dy: number): Rect => ({ ...rect, x: rect.x + dx, y: rect.y + dy })

/** Keeps enough of the title bar on screen to grab it again. */
export const keepGrabbable = (rect: Rect, desk: Size): Rect => ({
  ...rect,
  x: Math.min(Math.max(rect.x, 80 - rect.width), desk.width - 80),
  y: Math.min(Math.max(rect.y, 0), desk.height - 30),
})

export const resize = (rect: Rect, edge: Edge, dx: number, dy: number): Rect => {
  const west = edge.includes("W")
  const east = edge.includes("E")
  const north = edge.includes("N")
  const south = edge.includes("S")
  const width = Math.max(minimumWindowSize.width, rect.width + (east ? dx : west ? -dx : 0))
  const height = Math.max(minimumWindowSize.height, rect.height + (south ? dy : north ? -dy : 0))
  return {
    x: west ? rect.x + rect.width - width : rect.x,
    y: north ? rect.y + rect.height - height : rect.y,
    width,
    height,
  }
}

/** Centres a window of `size` on the desk, shifted down and right by `cascade` steps. */
export const cascadeRect = (size: Size, desk: Size, cascade: number): Rect => {
  const width = Math.min(size.width, desk.width - 40)
  const height = Math.min(size.height, desk.height - 40)
  const step = (cascade % 6) * 26
  return {
    x: Math.max(8, Math.round((desk.width - width) / 2) - 80 + step),
    y: Math.max(8, Math.round((desk.height - height) / 2) - 60 + step),
    width,
    height,
  }
}
