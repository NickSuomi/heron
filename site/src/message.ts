import { Schema } from "effect"
import { defineMessageUnion } from "foldkit/message"

import * as Notepad from "./apps/notepad"
import { Edge, Size } from "./domain/geometry"
import { AppId, FilePath } from "./domain/vfs"
import { WindowId } from "./domain/window"

export const Message = defineMessageUnion({
  // Boot
  CompletedWaitForLoader: {},
  CompletedWaitForWelcome: {},
  SkippedBoot: {},
  // Desktop and Start menu
  PressedDesktop: {},
  ClickedIcon: { path: FilePath },
  DoubleClickedIcon: { path: FilePath },
  ClickedStart: {},
  ClickedStartPath: { path: FilePath },
  ClickedStartApp: { app: AppId },
  ClickedPower: {},
  ClickedLock: {},
  ClickedToday: {},
  // Taskbar
  ClickedTaskbarButton: { windowId: WindowId },
  ToggledMute: {},
  // Windows
  PressedWindow: { windowId: WindowId },
  PressedTitleBar: { windowId: WindowId, x: Schema.Number, y: Schema.Number },
  PressedResizeHandle: { windowId: WindowId, edge: Edge, x: Schema.Number, y: Schema.Number },
  DoubleClickedTitleBar: { windowId: WindowId },
  MovedPointer: { x: Schema.Number, y: Schema.Number },
  ReleasedPointer: {},
  ClickedMinimise: { windowId: WindowId },
  ClickedMaximise: { windowId: WindowId },
  ClickedClose: { windowId: WindowId },
  // Keyboard: Alt+` switches windows, Ctrl+Esc opens Start, Esc closes, Enter opens, arrows select.
  PressedSwitchWindow: { isBackward: Schema.Boolean },
  ReleasedAlt: {},
  PressedStartKey: {},
  PressedEscape: {},
  PressedEnter: {},
  PressedArrow: { isForward: Schema.Boolean },
  // Environment
  TickedClock: { now: Schema.Number },
  ResizedViewport: { viewport: Size },
  CompletedPlayChime: {},
  CompletedMountGlass: {},
  FailedMountGlass: {},
  // Apps
  GotNotepadMessage: { windowId: WindowId, message: Notepad.Message },
})
export type Message = typeof Message.Type
