import { Option, pipe, Record } from "effect"

// Every icon is an SVG drawn for Heron OS in src/assets/icons.
export type IconName =
  | "computer"
  | "folder"
  | "heron-folder"
  | "notepad"
  | "text"
  | "code"
  | "diff"
  | "json"
  | "diagram"
  | "cmd"
  | "browser"
  | "recycle-bin"
  | "welcome"
  | "help"
  | "shield"
  | "studio"
  | "program"
  | "user"

const urls: Record<string, string> = import.meta.glob("../assets/icons/*.svg", { eager: true, query: "?url", import: "default" })

export const iconUrl = (name: IconName): string =>
  pipe(
    Record.get(urls, `../assets/icons/${name}.svg`),
    Option.getOrElse(() => ""),
  )
