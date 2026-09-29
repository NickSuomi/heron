import { Schema } from "effect"
import { defineMessageUnion } from "foldkit/message"

import { AppId, FilePath } from "../domain/vfs"

/**
 * What an app asks the shell to do. Every unit-2c app uses this union as its OutMessage, so the
 * shell answers all of them in one place (`handleRequest` in `src/update.ts`).
 */
export const Request = defineMessageUnion({
  /** Open a file or folder the way a desktop double-click does: through the file-type registry. */
  RequestedOpenPath: { path: FilePath },
  /** Start an app with no file, or bring its only window forward. */
  RequestedStartApp: { app: AppId },
  /** Dim the screen and show the User Account Control joke. */
  RequestedApproval: {},
  /** Start the scripted tour from its first step. */
  RequestedTour: {},
  /** Close the window the app runs in. */
  RequestedClose: {},
  /** The Welcome Center's "Show this at startup" checkbox changed. */
  RequestedWelcomeAtStartup: { isShown: Schema.Boolean },
})
export type Request = typeof Request.Type

/** An app's view knows whether it is drawn in a desktop window or full screen on the phone. */
export const Form = Schema.Literals(["Desktop", "Phone"])
export type Form = typeof Form.Type

export type ViewInputs = Readonly<{ form: Form }>
