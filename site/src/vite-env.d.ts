/// <reference types="vite/client" />

declare module "virtual:heron-files" {
  /** The paths under the repository that the Heron folder lists, without their text. */
  export const heronPaths: ReadonlyArray<string>
}

declare module "virtual:heron-file-contents" {
  export const heronFiles: ReadonlyArray<{ readonly path: string; readonly content: string }>
  /** The root README.md as plain text, for README.txt on the desktop. */
  export const readmeText: string
}

declare module "virtual:heron-build" {
  /** The report note for the fictional merge request !42, rendered by Heron's `renderReport`. */
  export const reportNote: string
  /** The ids of the findings the note lists, as Heron's `applySynthesis` returns them. */
  export const findingIds: ReadonlyArray<string>
  export const configDigest: string
  export const labelNames: Readonly<Record<"inProgress" | "pass" | "changesRequested" | "blocked", string | null>>
  export const profiles: Readonly<Record<string, { readonly name: string; readonly harness: string; readonly model: string; readonly effort: string }>>
  /** Real `heron` output, keyed by the arguments joined with single spaces. */
  export const cliOutput: Readonly<Record<string, string>>
}
