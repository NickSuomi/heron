import { Array, Option, pipe, Schema } from "effect"

import { AppState } from "../apps/appState"
import { Rect } from "./geometry"

export const WindowId = Schema.Number.pipe(Schema.brand("WindowId"))
export type WindowId = typeof WindowId.Type

/** Minimising is separate from display: a maximised window restores to maximised. */
export const Display = Schema.Literals(["Normal", "Maximised"])
export type Display = typeof Display.Type

export const Window = Schema.Struct({
  id: WindowId,
  app: AppState,
  bounds: Rect,
  display: Display,
  isMinimised: Schema.Boolean,
})
export type Window = typeof Window.Type

/**
 * The open windows. `windows` is the z-order, bottom first, so the last visible window is on top.
 * `maybeFocused` is always the topmost visible window or nothing (the desktop has focus).
 */
export const Desk = Schema.Struct({
  windows: Schema.Array(Window),
  maybeFocused: Schema.Option(WindowId),
  nextId: Schema.Number,
})
export type Desk = typeof Desk.Type

export const emptyDesk: Desk = { windows: [], maybeFocused: Option.none(), nextId: 1 }

export const find = (desk: Desk, id: WindowId): Option.Option<Window> => Array.findFirst(desk.windows, (win) => win.id === id)

const topVisible = (windows: ReadonlyArray<Window>): Option.Option<WindowId> =>
  pipe(
    windows,
    Array.findLast((win) => !win.isMinimised),
    Option.map((win) => win.id),
  )

const withWindows = (desk: Desk, windows: ReadonlyArray<Window>): Desk => ({ ...desk, windows, maybeFocused: topVisible(windows) })

const updateWindow = (desk: Desk, id: WindowId, f: (win: Window) => Window): ReadonlyArray<Window> =>
  desk.windows.map((win) => (win.id === id ? f(win) : win))

export const isFocused = (desk: Desk, id: WindowId): boolean => Option.contains(desk.maybeFocused, id)

export const open = (desk: Desk, app: AppState, bounds: Rect, display: Display): Desk => {
  const win: Window = { id: WindowId.make(desk.nextId), app, bounds, display, isMinimised: false }
  return { ...withWindows(desk, [...desk.windows, win]), nextId: desk.nextId + 1 }
}

/** Raises a window to the top, restores it if minimised, and gives it focus. */
export const focus = (desk: Desk, id: WindowId): Desk =>
  pipe(
    find(desk, id),
    Option.match({
      onNone: () => desk,
      onSome: (win) => withWindows(desk, [...desk.windows.filter((other) => other.id !== id), { ...win, isMinimised: false }]),
    }),
  )

export const close = (desk: Desk, id: WindowId): Desk => withWindows(desk, desk.windows.filter((win) => win.id !== id))

export const minimise = (desk: Desk, id: WindowId): Desk => withWindows(desk, updateWindow(desk, id, (win) => ({ ...win, isMinimised: true })))

export const toggleMaximise = (desk: Desk, id: WindowId): Desk =>
  focus(
    { ...desk, windows: updateWindow(desk, id, (win) => ({ ...win, display: win.display === "Maximised" ? "Normal" : "Maximised" })) },
    id,
  )

export const setBounds = (desk: Desk, id: WindowId, bounds: Rect): Desk => ({
  ...desk,
  windows: updateWindow(desk, id, (win) => ({ ...win, bounds })),
})

export const setApp = (desk: Desk, id: WindowId, app: AppState): Desk => ({
  ...desk,
  windows: updateWindow(desk, id, (win) => ({ ...win, app })),
})

/** The taskbar button: minimise the focused window, otherwise bring it forward. */
export const activateFromTaskbar = (desk: Desk, id: WindowId): Desk => (isFocused(desk, id) ? minimise(desk, id) : focus(desk, id))

/** The desktop takes focus: every window stays where it is but none is active. */
export const blur = (desk: Desk): Desk => ({ ...desk, maybeFocused: Option.none() })

/** Most recently used first, the order the window switcher cycles through. */
export const switchOrder = (desk: Desk): ReadonlyArray<Window> => Array.reverse(desk.windows)
