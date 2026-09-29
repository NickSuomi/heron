import { Option, Schema } from "effect"
import { defineTaggedUnion } from "foldkit/schema"

import { type AppId, FilePath } from "./domain/vfs"

// "Take the tour": a fixed sequence of steps. Entering a step opens or focuses the step's app, then runs
// the step's hook from src/tourHooks.ts. The hooks for the Command Prompt, the editor and the browser
// belong to the units that build those apps; the controller wires them in during the merge.

export const TourStepId = Schema.Literals(["DryRun", "Findings", "Note"])
export type TourStepId = typeof TourStepId.Type

export type TourStep = Readonly<{
  id: TourStepId
  app: AppId
  /** The file the app opens on, when it has one. */
  maybePath: Option.Option<FilePath>
  title: string
  body: string
}>

export const tourSteps: ReadonlyArray<TourStep> = [
  {
    id: "DryRun",
    app: "cmd",
    maybePath: Option.none(),
    title: "Run a dry-run review",
    body: "heron review --mr 42 --dry-run reviews merge request !42 at its current head. With --dry-run Heron prints the report and posts nothing.",
  },
  {
    id: "Findings",
    app: "editor",
    maybePath: Option.some(FilePath.make("/Desktop/merge-request-42.diff")),
    title: "Read the findings",
    body: "Each finding names a path and a line at the reviewed head. Code decides the verdict: any blocker finding means CHANGES REQUESTED.",
  },
  {
    id: "Note",
    app: "browser",
    maybePath: Option.none(),
    title: "See the note on the merge request",
    body: "Without --dry-run Heron writes one report note and sets one verdict label. It never pushes, approves, or merges.",
  },
]

/** Off, or showing step `step` (an index into `tourSteps`). */
export const Tour = defineTaggedUnion({
  Off: {},
  On: { step: Schema.Number },
})
export type Tour = typeof Tour.Type
