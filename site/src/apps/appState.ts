import { Schema } from "effect"

import * as Browser from "./browser"
import * as Cmd from "./cmd"
import * as Notepad from "./notepad"
import * as Studio from "./studio"
import * as Stub from "./stub"

/** The state of the app inside one window. Unit 2 adds one variant per app it builds. */
export const AppState = Schema.Union([Notepad.Model, Cmd.Model, Studio.Model, Browser.Model, Stub.Model])
export type AppState = typeof AppState.Type
