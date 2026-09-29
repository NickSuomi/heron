import { Schema } from "effect"
import { defineTaggedUnion } from "foldkit/schema"

import { Edge, Point, Rect, Size } from "./domain/geometry"
import { Review } from "./domain/review"
import { FilePath } from "./domain/vfs"
import { Desk, WindowId } from "./domain/window"

/** Boot is the loader bar, then the welcome screen, then the desktop. */
export const Session = defineTaggedUnion({
  Booting: { stage: Schema.Literals(["Loader", "Welcome"]) },
  Desktop: {},
})
export type Session = typeof Session.Type

/** A pointer drag in progress: moving a window by its title bar, or resizing it by an edge. */
export const Gesture = defineTaggedUnion({
  Idle: {},
  Moving: { windowId: WindowId, origin: Point, start: Rect },
  Resizing: { windowId: WindowId, edge: Edge, origin: Point, start: Rect },
})
export type Gesture = typeof Gesture.Type

/** The window switcher, open while Alt is held after Alt+`. `index` points into the switch order. */
export const Switcher = defineTaggedUnion({
  Closed: {},
  Open: { index: Schema.Number },
})
export type Switcher = typeof Switcher.Type

/** Native uses Canvas UI Glass through HTML-in-canvas; Css uses backdrop-filter. */
export const GlassMode = Schema.Literals(["Native", "Css"])
export type GlassMode = typeof GlassMode.Type

export const Model = Schema.Struct({
  session: Session,
  desk: Desk,
  gesture: Gesture,
  maybeSelectedIcon: Schema.Option(FilePath),
  isStartMenuOpen: Schema.Boolean,
  switcher: Switcher,
  viewport: Size,
  now: Schema.Number,
  isMuted: Schema.Boolean,
  isAudioUnlocked: Schema.Boolean,
  glass: GlassMode,
  review: Review,
})
export type Model = typeof Model.Type

export const Flags = Schema.Struct({ viewport: Size, now: Schema.Number, glass: GlassMode })
export type Flags = typeof Flags.Type

export const taskbarHeight = 30

/** Below this width the site is a phone in the Windows Mobile 6 style. */
export const phoneBreakpoint = 700

export const isPhone = (model: Model): boolean => model.viewport.width < phoneBreakpoint

export const deskSize = (model: Model): Size =>
  isPhone(model)
    ? { width: model.viewport.width, height: model.viewport.height - 56 }
    : { width: model.viewport.width, height: model.viewport.height - taskbarHeight }
