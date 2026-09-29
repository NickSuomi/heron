import { Option, pipe, Record } from "effect"

// Toolbar, ribbon and dialog glyphs, each an SVG drawn for Heron OS in src/assets/glyphs.
export type GlyphName =
  | "approve"
  | "ask"
  | "bin-empty"
  | "browse"
  | "connector"
  | "decision"
  | "details"
  | "dialog-error"
  | "dialog-info"
  | "dialog-warning"
  | "grid"
  | "home"
  | "icons"
  | "lane-critical"
  | "lane-light"
  | "lane-standard"
  | "open"
  | "options"
  | "orb"
  | "organize"
  | "play"
  | "preview-pane"
  | "print"
  | "rectangle"
  | "search"
  | "shape-data"
  | "shapes-window"
  | "shield-small"
  | "star"
  | "stop"
  | "text-tool"
  | "topic"
  | "tour"
  | "views"
  | "zoom-100"
  | "zoom-150"
  | "zoom-fit"

const urls: Record<string, string> = import.meta.glob("../assets/glyphs/*.svg", { eager: true, query: "?url", import: "default" })

export const glyphUrl = (name: GlyphName): string =>
  pipe(
    Record.get(urls, `../assets/glyphs/${name}.svg`),
    Option.getOrElse(() => ""),
  )
