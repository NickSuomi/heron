import { Schema } from "effect"

import * as Browser from "./browser"
import * as Cmd from "./cmd"
import * as Diagram from "./diagram"
import * as Dialog from "./dialog"
import * as Explorer from "./explorer"
import * as Help from "./help"
import * as Notepad from "./notepad"
import * as Studio from "./studio"
import * as Welcome from "./welcome"

/** The state of the app inside one window, one variant per app. */
export const AppState = Schema.Union([
  Notepad.Model,
  Cmd.Model,
  Studio.Model,
  Browser.Model,
  Diagram.Model,
  Explorer.Model,
  Welcome.Model,
  Help.Model,
  Dialog.Model,
])
export type AppState = typeof AppState.Type
