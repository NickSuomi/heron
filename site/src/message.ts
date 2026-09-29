import { Schema } from "effect"
import { defineMessageUnion } from "foldkit/message"

import * as Browser from "./apps/browser"
import * as Cmd from "./apps/cmd"
import * as Diagram from "./apps/diagram"
import * as Dialog from "./apps/dialog"
import * as Explorer from "./apps/explorer"
import * as Help from "./apps/help"
import * as Notepad from "./apps/notepad"
import * as Studio from "./apps/studio"
import * as Welcome from "./apps/welcome"
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
  ClickedAllPrograms: {},
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
  // The shared review of !42
  TickedReview: { now: Schema.Number },
  // Apps
  GotNotepadMessage: { windowId: WindowId, message: Notepad.Message },
  GotCmdMessage: { windowId: WindowId, message: Cmd.Message },
  GotStudioMessage: { windowId: WindowId, message: Studio.Message },
  GotBrowserMessage: { windowId: WindowId, message: Browser.Message },
  GotDiagramMessage: { windowId: WindowId, message: Diagram.Message },
  GotExplorerMessage: { windowId: WindowId, message: Explorer.Message },
  GotWelcomeMessage: { windowId: WindowId, message: Welcome.Message },
  GotHelpMessage: { windowId: WindowId, message: Help.Message },
  GotDialogMessage: { windowId: WindowId, message: Dialog.Message },
  CompletedSaveWelcomeAtStartup: {},
  // User Account Control: any app, or a finished review, can ask; Heron always cancels.
  RequestedApproval: {},
  ClickedUacContinue: {},
  ClickedUacCancel: {},
  ToggledUacDetails: {},
  ClickedUacClose: {},
  CompletedFocusUac: {},
  // The tour
  ClickedTourNext: {},
  ClickedTourBack: {},
  ClickedTourEnd: {},
})
export type Message = typeof Message.Type
