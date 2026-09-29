import { Schema } from "effect"

import * as Diagram from "./diagram"
import * as Dialog from "./dialog"
import * as Explorer from "./explorer"
import * as Help from "./help"
import * as Notepad from "./notepad"
import * as Stub from "./stub"
import * as Welcome from "./welcome"

/** The state of the app inside one window. Unit 2 adds one variant per app it builds. */
export const AppState = Schema.Union([Notepad.Model, Stub.Model, Diagram.Model, Explorer.Model, Welcome.Model, Help.Model, Dialog.Model])
export type AppState = typeof AppState.Type
