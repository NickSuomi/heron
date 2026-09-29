import { Array, Duration, Effect, Option, Schema } from "effect"
import { Command, Submodel, type Update } from "foldkit"
import type { Html, HtmlBuilder } from "foldkit/html"
import { defineMessageUnion } from "foldkit/message"
import { defineTaggedUnion, taggedStruct } from "foldkit/schema"
import { modifyFields } from "foldkit/struct"

import { FilePath, lookup, type VfsNode } from "../domain/vfs"
import {
  connectorPath,
  type Flow,
  type FlowNode,
  findNode,
  flowFor,
  kindLabel,
  LaneName,
  laneShape,
  type NodeKind,
  page,
  stencil,
} from "./diagramFlow"
import { glyphUrl, type GlyphName } from "./glyphs"
import { Request, type ViewInputs } from "./request"

// Diagram Viewer: "How Heron works.vsd" in an Office 2007 ribbon frame. Play is local to this window:
// it lights the drawing wave by wave and never touches the shared review.

export const RibbonTab = Schema.Literals(["Home", "Insert", "View"])
export type RibbonTab = typeof RibbonTab.Type

export const Zoom = Schema.Literals(["Fit", "100", "150"])
export type Zoom = typeof Zoom.Type

/** `run` numbers each Play press, so a tick from a stopped run is ignored. */
export const Playback = defineTaggedUnion({
  Stopped: {},
  Playing: { run: Schema.Number, wave: Schema.Number },
  Finished: { run: Schema.Number },
})
export type Playback = typeof Playback.Type

export const Model = taggedStruct("Diagram", {
  maybePath: Schema.Option(FilePath),
  lane: LaneName,
  tab: RibbonTab,
  maybeSelected: Schema.Option(Schema.String),
  maybeHighlighted: Schema.Option(Schema.String),
  playback: Playback,
  runs: Schema.Number,
  isGridShown: Schema.Boolean,
  isShapesShown: Schema.Boolean,
  isShapeDataShown: Schema.Boolean,
  zoom: Zoom,
})
export type Model = typeof Model.Type

export const Message = defineMessageUnion({
  ClickedTab: { tab: RibbonTab },
  ClickedLane: { lane: LaneName },
  ClickedNode: { id: Schema.String },
  ClickedPage: {},
  ClickedStencil: { kind: Schema.String },
  ClickedPlay: {},
  ClickedStop: {},
  TickedWave: { run: Schema.Number },
  ToggledGrid: {},
  ToggledShapes: {},
  ToggledShapeData: {},
  ClickedZoom: { zoom: Zoom },
  ClickedApprove: {},
})
export type Message = typeof Message.Type

export const OutMessage = Request
export type OutMessage = Request

const waveMillis = 1100

const WaitForWave = Command.define("WaitForDiagramWave", {
  args: { run: Schema.Number },
  messages: [Message.TickedWave],
  execute: ({ run }) => Effect.sleep(Duration.millis(waveMillis)).pipe(Effect.as(Message.TickedWave({ run }))),
})

export const init = (maybeNode: Option.Option<VfsNode>): Model =>
  Model({
    maybePath: Option.map(maybeNode, (node) => node.path),
    lane: "standard",
    tab: "Home",
    maybeSelected: Option.none(),
    maybeHighlighted: Option.none(),
    playback: Playback.Stopped(),
    runs: 0,
    isGridShown: true,
    isShapesShown: true,
    isShapeDataShown: true,
    zoom: "Fit",
  })

const fileName = (model: Model): string =>
  Option.match(Option.flatMap(model.maybePath, lookup), { onNone: () => "How Heron works.vsd", onSome: (node) => node.name })

export const title = (model: Model): string => `${fileName(model)} - Diagram Viewer`

const waveCount = (lane: LaneName): number => Option.match(flowFor(lane), { onNone: () => 0, onSome: (flow) => flow.waves.length })

type UpdateReturn = Update.ReturnWithOutMessage<Model, Message, OutMessage>

const play = (model: Model): UpdateReturn => {
  const run = model.runs + 1
  return {
    model: { ...model, runs: run, playback: Playback.Playing({ run, wave: 0 }), maybeSelected: Option.none() },
    commands: [WaitForWave({ run })],
  }
}

export const update = (model: Model, message: Message): UpdateReturn =>
  Message.match<UpdateReturn>(message, {
    ClickedTab: ({ tab }) => ({ model: { ...model, tab } }),
    ClickedLane: ({ lane }) =>
      model.lane === lane
        ? { model }
        : { model: { ...model, lane, maybeSelected: Option.none(), playback: Playback.Stopped() } },
    ClickedNode: ({ id }) => ({ model: { ...model, maybeSelected: Option.some(id), maybeHighlighted: Option.none() } }),
    ClickedPage: () => ({ model: { ...model, maybeSelected: Option.none(), maybeHighlighted: Option.none() } }),
    ClickedStencil: ({ kind }) => ({
      model: modifyFields(model, { maybeHighlighted: (current) => (Option.contains(current, kind) ? Option.none() : Option.some(kind)) }),
    }),
    ClickedPlay: () => play(model),
    ClickedStop: () => ({ model: { ...model, playback: Playback.Stopped() } }),
    TickedWave: ({ run }) =>
      Playback.match<UpdateReturn>(model.playback, {
        Stopped: () => ({ model }),
        Finished: () => ({ model }),
        Playing: (playing) =>
          playing.run !== run
            ? { model }
            : playing.wave + 1 >= waveCount(model.lane)
              ? { model: { ...model, playback: Playback.Finished({ run }) } }
              : {
                  model: { ...model, playback: Playback.Playing({ run, wave: playing.wave + 1 }) },
                  commands: [WaitForWave({ run })],
                },
      }),
    ToggledGrid: () => ({ model: modifyFields(model, { isGridShown: (shown) => !shown }) }),
    ToggledShapes: () => ({ model: modifyFields(model, { isShapesShown: (shown) => !shown }) }),
    ToggledShapeData: () => ({ model: modifyFields(model, { isShapeDataShown: (shown) => !shown }) }),
    ClickedZoom: ({ zoom }) => ({ model: { ...model, zoom } }),
    ClickedApprove: () => ({ model, outMessage: Request.RequestedApproval() }),
  })

// ---------------------------------------------------------------------------------------------------
// Drawing

type NodeState = "idle" | "active" | "done"

const nodeState = (model: Model, node: FlowNode): NodeState =>
  Playback.match<NodeState>(model.playback, {
    Stopped: () => "idle",
    Finished: () => "done",
    Playing: ({ wave }) => (node.wave < wave ? "done" : node.wave === wave ? "active" : "idle"),
  })

/** The outline of each master, in the node's own box. */
const outline = (kind: NodeKind, width: number, height: number): string => {
  const w = width
  const h = height
  switch (kind) {
    case "MergeRequest":
      return `M0 0 H${w} V${h - 9} C${w * 0.72} ${h - 20} ${w * 0.3} ${h + 4} 0 ${h - 9} Z`
    case "Rules":
      return `M${w / 2} 0 L${w} ${h / 2} L${w / 2} ${h} L0 ${h / 2} Z`
    case "Judge":
      return `M14 0 H${w - 14} L${w} ${h / 2} L${w - 14} ${h} H14 L0 ${h / 2} Z`
    case "Verdict":
      return `M${h / 2} 0 H${w - h / 2} A${h / 2} ${h / 2} 0 0 1 ${w - h / 2} ${h} H${h / 2} A${h / 2} ${h / 2} 0 0 1 ${h / 2} 0 Z`
    case "Note":
      return `M0 0 H${w - 16} L${w} 16 V${h} H0 Z`
    case "Lane":
      return `M6 0 H${w - 6} Q${w} 0 ${w} 6 V${h - 6} Q${w} ${h} ${w - 6} ${h} H6 Q0 ${h} 0 ${h - 6} V6 Q0 0 6 0 Z`
    case "Reviewer":
    case "Gate":
    case "Supervisor":
      return `M0 0 H${w} V${h} H0 Z`
  }
}

/**
 * The page's gradients, marker and grid patterns carry the window's prefix, so two Diagram Viewer windows do not
 * share ids and closing one does not strip the fills from the other.
 */
const svgId = (prefix: string, name: string): string => `${prefix}-${name}`
const svgRef = (prefix: string, name: string): string => `url(#${svgId(prefix, name)})`

const fillFor = (prefix: string, kind: NodeKind): string =>
  svgRef(
    prefix,
    ({
      MergeRequest: "fill-doc",
      Rules: "fill-rule",
      Lane: "fill-lane",
      Reviewer: "fill-session",
      Gate: "fill-session",
      Supervisor: "fill-super",
      Judge: "fill-judge",
      Verdict: "fill-verdict",
      Note: "fill-doc",
    } as const)[kind],
  )

/** Extra strokes some masters carry: the supervisor's side bars, the note's folded corner. */
const decoration = <M>(h: HtmlBuilder<M>, kind: NodeKind, width: number, height: number): ReadonlyArray<Html> => {
  switch (kind) {
    case "Supervisor":
      return [
        h.path([h.Class("dg-shape-line"), h.D(`M9 0 V${height} M${width - 9} 0 V${height}`)]),
      ]
    case "Note":
      return [h.path([h.Class("dg-shape-fold"), h.D(`M${width - 16} 0 V16 H${width}`)])]
    case "Lane":
      return [h.path([h.Class("dg-lane-stripe"), h.D(`M6 0 H18 V${height} H6 Q0 ${height} 0 ${height - 6} V6 Q0 0 6 0 Z`)])]
    default:
      return []
  }
}

const selectionHandles = <M>(h: HtmlBuilder<M>, node: FlowNode): ReadonlyArray<Html> => {
  const xs = [0, node.width / 2, node.width]
  const ys = [0, node.height / 2, node.height]
  const points = xs.flatMap((x) => ys.map((y) => [x, y] as const)).filter(([x, y]) => !(x === node.width / 2 && y === node.height / 2))
  return [
    h.rect([
      h.Class("dg-selection"),
      h.Attribute("x", "-3"),
      h.Attribute("y", "-3"),
      h.Width(String(node.width + 6)),
      h.Height(String(node.height + 6)),
    ]),
    ...points.map(([x, y]) =>
      h.rect([h.Class("dg-handle"), h.Attribute("x", String(x - 3)), h.Attribute("y", String(y - 3)), h.Width("6"), h.Height("6")]),
    ),
  ]
}

const nodeView = (h: HtmlBuilder<Message>, model: Model, node: FlowNode, prefix: string): Html => {
  const state = nodeState(model, node)
  const isSelected = Option.contains(model.maybeSelected, node.id)
  const isHighlighted = Option.contains(model.maybeHighlighted, node.kind)
  const centreY = node.height / 2 + (node.kind === "MergeRequest" ? -4 : 0)
  return h.g(
    [
      h.Class(["dg-node", `dg-${node.kind.toLowerCase()}`, `is-${state}`, isSelected ? "is-selected" : "", isHighlighted ? "is-highlighted" : ""].filter(Boolean).join(" ")),
      h.Transform(`translate(${node.x} ${node.y})`),
      h.Role("button"),
      h.Tabindex(0),
      h.AriaLabel(`${node.label}, ${kindLabel[node.kind]} (${node.sublabel})`),
      h.AriaPressed(String(isSelected)),
      h.OnClick(Message.ClickedNode({ id: node.id })),
      h.OnKeyDownPreventDefault((key) => (key === "Enter" || key === " " ? Option.some(Message.ClickedNode({ id: node.id })) : Option.none())),
    ],
    [
      h.path([h.Class("dg-shape-shadow"), h.D(outline(node.kind, node.width, node.height)), h.Transform("translate(3 3)")]),
      h.path([h.Class("dg-shape"), h.D(outline(node.kind, node.width, node.height)), h.Fill(fillFor(prefix, node.kind))]),
      ...decoration(h, node.kind, node.width, node.height),
      h.path([h.Class("dg-shape-gloss"), h.D(outline(node.kind, node.width, node.height)), h.Fill(svgRef(prefix, "gloss"))]),
      h.text(
        [h.Class("dg-label"), h.Attribute("x", String(node.width / 2 + (node.kind === "Lane" ? 6 : 0))), h.Attribute("y", String(centreY - 2)), h.Attribute("text-anchor", "middle")],
        [node.label],
      ),
      h.text(
        [h.Class("dg-sublabel"), h.Attribute("x", String(node.width / 2 + (node.kind === "Lane" ? 6 : 0))), h.Attribute("y", String(centreY + 11)), h.Attribute("text-anchor", "middle")],
        [node.sublabel],
      ),
      ...(state === "done" ? [h.path([h.Class("dg-check"), h.D(`M${node.width - 15} 8 l3 3.5 l6 -7`)])] : []),
      ...(isSelected ? selectionHandles(h, node) : []),
    ],
  )
}

const edgeView = (h: HtmlBuilder<Message>, model: Model, flow: Flow, from: string, to: string, prefix: string): Html =>
  Option.match(Option.all([findNode(flow, from), findNode(flow, to)]), {
    onNone: () => h.empty,
    onSome: ([source, target]) => {
      const d = connectorPath(source, target)
      const state = nodeState(model, target)
      return h.g(
        [h.Class(`dg-edge is-${state}`)],
        [
          h.path([h.Class("dg-edge-line"), h.D(d), h.MarkerEnd(svgRef(prefix, "arrow"))]),
          ...(state === "active"
            ? [h.path([h.Class("dg-edge-flow"), h.D(d), h.Attribute("pathLength", "100")])]
            : []),
        ],
      )
    },
  })

const defs = (h: HtmlBuilder<Message>, prefix: string): Html => {
  const gradient = (id: string, top: string, bottom: string): Html =>
    h.linearGradient(
      [h.Id(svgId(prefix, id)), h.Attribute("x1", "0"), h.Attribute("y1", "0"), h.Attribute("x2", "0"), h.Attribute("y2", "1")],
      [h.stop([h.Attribute("offset", "0"), h.Attribute("stop-color", top)]), h.stop([h.Attribute("offset", "1"), h.Attribute("stop-color", bottom)])],
    )
  return h.defs(
    [],
    [
      gradient("fill-doc", "#ffffff", "#dfe9f5"),
      gradient("fill-rule", "#fff6d8", "#f2d27a"),
      gradient("fill-lane", "#eef4fb", "#c3d6ee"),
      gradient("fill-session", "#f3f8fe", "#bcd4f0"),
      gradient("fill-super", "#eef3fb", "#a9c2e6"),
      gradient("fill-judge", "#f5eefb", "#cdb8e6"),
      gradient("fill-verdict", "#effaf1", "#a9d9b2"),
      h.linearGradient(
        [h.Id(svgId(prefix, "gloss")), h.Attribute("x1", "0"), h.Attribute("y1", "0"), h.Attribute("x2", "0"), h.Attribute("y2", "1")],
        [
          h.stop([h.Attribute("offset", "0"), h.Attribute("stop-color", "#fff"), h.Attribute("stop-opacity", "0.75")]),
          h.stop([h.Attribute("offset", "0.48"), h.Attribute("stop-color", "#fff"), h.Attribute("stop-opacity", "0.2")]),
          h.stop([h.Attribute("offset", "0.5"), h.Attribute("stop-color", "#fff"), h.Attribute("stop-opacity", "0")]),
        ],
      ),
      h.marker(
        [h.Id(svgId(prefix, "arrow")), h.ViewBox("0 0 10 10"), h.RefX("9"), h.RefY("5"), h.MarkerWidth("7"), h.MarkerHeight("7"), h.Orient("auto-start-reverse")],
        [h.path([h.D("M0 0 L10 5 L0 10 z"), h.Fill("#44546a")])],
      ),
      h.pattern(
        [h.Id(svgId(prefix, "grid-minor")), h.Width("10"), h.Height("10"), h.PatternUnits("userSpaceOnUse")],
        [h.path([h.D("M10 0 H0 V10"), h.Fill("none"), h.Stroke("#e4ebf3"), h.StrokeWidth("0.6")])],
      ),
      h.pattern(
        [h.Id(svgId(prefix, "grid")), h.Width("50"), h.Height("50"), h.PatternUnits("userSpaceOnUse")],
        [
          h.rect([h.Width("50"), h.Height("50"), h.Fill(svgRef(prefix, "grid-minor"))]),
          h.path([h.D("M50 0 H0 V50"), h.Fill("none"), h.Stroke("#cad7e6"), h.StrokeWidth("0.8")]),
        ],
      ),
    ],
  )
}

const pageView = (h: HtmlBuilder<Message>, model: Model, flow: Flow, prefix: string): Html =>
  h.svg(
    [
      h.Class(`dg-page zoom-${model.zoom.toLowerCase()}`),
      h.ViewBox(`0 0 ${page.width} ${page.height}`),
      h.Xmlns("http://www.w3.org/2000/svg"),
      h.Role("group"),
      h.AriaLabel(`How Heron works, ${flow.lane} lane`),
      ...(model.zoom === "Fit" ? [] : [h.Width(String((page.width * Number(model.zoom)) / 100)), h.Height(String((page.height * Number(model.zoom)) / 100))]),
    ],
    [
      defs(h, prefix),
      h.rect([h.Class("dg-paper"), h.Width(String(page.width)), h.Height(String(page.height)), h.OnClick(Message.ClickedPage())]),
      ...(model.isGridShown
        ? [h.rect([h.Class("dg-grid"), h.Width(String(page.width)), h.Height(String(page.height)), h.Fill(svgRef(prefix, "grid")), h.OnClick(Message.ClickedPage())])]
        : []),
      h.text([h.Class("dg-title"), h.Attribute("x", "28"), h.Attribute("y", "40")], ["How Heron works"]),
      h.text([h.Class("dg-subtitle"), h.Attribute("x", "28"), h.Attribute("y", "58")], [
        `${flow.lane} lane, shape ${laneShape(flow.lane)}, from heron.config.json`,
      ]),
      ...flow.groups.map((group) =>
        h.g(
          [h.Class("dg-group")],
          [
            h.rect([h.Attribute("x", String(group.x)), h.Attribute("y", String(group.y)), h.Width(String(group.width)), h.Height(String(group.height)), h.Attribute("rx", "4")]),
            h.text([h.Class("dg-group-label"), h.Attribute("x", String(group.x + 8)), h.Attribute("y", String(group.y + 13))], [group.label]),
          ],
        ),
      ),
      ...flow.edges.map((edge) => edgeView(h, model, flow, edge.from, edge.to, prefix)),
      ...flow.nodes.map((node) => nodeView(h, model, node, prefix)),
      h.text([h.Class("dg-footnote"), h.Attribute("x", String(page.width - 28)), h.Attribute("y", String(page.height - 18)), h.Attribute("text-anchor", "end")], [
        "Merge request !42 is a fictional example. Sessions and rules come from heron.config.example.json.",
      ]),
    ],
  )

// ---------------------------------------------------------------------------------------------------
// Ribbon

type BigButton = Readonly<{ label: string; glyph: GlyphName; message: Option.Option<Message>; isPressed?: boolean; hasShield?: boolean; title?: string }>

const bigButton = (h: HtmlBuilder<Message>, button: BigButton): Html =>
  h.button(
    [
      h.Class(`rb-big${button.isPressed === true ? " is-pressed" : ""}`),
      h.Title(button.title ?? button.label),
      ...(button.isPressed === undefined ? [] : [h.AriaPressed(String(button.isPressed))]),
      ...Option.match(button.message, { onNone: () => [h.Disabled(true)], onSome: (message) => [h.OnClick(message)] }),
    ],
    [
      h.span(
        [h.Class("rb-big-icon")],
        [
          h.img([h.Src(glyphUrl(button.glyph)), h.Alt(""), h.Width("32"), h.Height("32"), h.Draggable(false)]),
          ...(button.hasShield === true ? [h.img([h.Class("rb-shield"), h.Src(glyphUrl("shield-small")), h.Alt(""), h.Width("16"), h.Height("16")])] : []),
        ],
      ),
      h.span([h.Class("rb-big-label")], [button.label]),
    ],
  )

type SmallButton = Readonly<{ label: string; glyph: GlyphName; message: Option.Option<Message>; isChecked?: boolean }>

const smallButton = (h: HtmlBuilder<Message>, button: SmallButton): Html =>
  h.button(
    [
      h.Class(`rb-small${button.isChecked === true ? " is-pressed" : ""}`),
      ...(button.isChecked === undefined ? [] : [h.Role("menuitemcheckbox"), h.AriaChecked(button.isChecked)]),
      ...Option.match(button.message, { onNone: () => [h.Disabled(true)], onSome: (message) => [h.OnClick(message)] }),
    ],
    [h.img([h.Src(glyphUrl(button.glyph)), h.Alt(""), h.Width("16"), h.Height("16"), h.Draggable(false)]), h.span([], [button.label])],
  )

const checkItem = (h: HtmlBuilder<Message>, label: string, isChecked: boolean, message: Message): Html =>
  h.label(
    [h.Class("rb-check")],
    [h.input([h.Type("checkbox"), h.Checked(isChecked), h.OnChange(() => message)]), h.span([], [label])],
  )

const group = (h: HtmlBuilder<Message>, label: string, children: ReadonlyArray<Html>, className = ""): Html =>
  h.div(
    [h.Class(`rb-group ${className}`), h.Role("group"), h.AriaLabel(label)],
    [h.div([h.Class("rb-group-body")], children), h.div([h.Class("rb-group-label")], [label])],
  )

const isPlaying = (model: Model): boolean => model.playback._tag === "Playing"

const laneButtons = (h: HtmlBuilder<Message>, model: Model): ReadonlyArray<Html> =>
  ([
    ["light", "Light", "lane-light", "single: one reviewer session"],
    ["standard", "Standard", "lane-standard", "gated: gates, then a supervisor"],
    ["critical", "Critical", "lane-critical", "dual: two blind branches and a judge"],
  ] as const).map(([lane, label, glyph, title]) =>
    bigButton(h, { label, glyph, title: `${label} lane (${title})`, isPressed: model.lane === lane, message: Option.some(Message.ClickedLane({ lane })) }),
  )

const homeTab = (h: HtmlBuilder<Message>, model: Model): ReadonlyArray<Html> => [
  group(h, "Review", [
    bigButton(h, { label: isPlaying(model) ? "Replay" : "Play", glyph: "play", title: "Play a review through the drawing", message: Option.some(Message.ClickedPlay()) }),
    bigButton(h, { label: "Stop", glyph: "stop", message: isPlaying(model) || model.playback._tag === "Finished" ? Option.some(Message.ClickedStop()) : Option.none() }),
  ]),
  group(h, "Lane", laneButtons(h, model)),
  group(h, "Merge request", [
    bigButton(h, { label: "Approve merge request", glyph: "approve", hasShield: true, title: "Approve merge request !42", message: Option.some(Message.ClickedApprove()) }),
  ]),
  group(
    h,
    "Show",
    [
      smallButton(h, { label: "Shapes", glyph: "shapes-window", isChecked: model.isShapesShown, message: Option.some(Message.ToggledShapes()) }),
      smallButton(h, { label: "Shape Data", glyph: "shape-data", isChecked: model.isShapeDataShown, message: Option.some(Message.ToggledShapeData()) }),
      smallButton(h, { label: "Grid", glyph: "grid", isChecked: model.isGridShown, message: Option.some(Message.ToggledGrid()) }),
    ],
    "is-stacked",
  ),
]

const readOnly = "How Heron works.vsd is read-only"

const insertTab = (h: HtmlBuilder<Message>): ReadonlyArray<Html> => [
  group(h, "Shapes", [
    bigButton(h, { label: "Rectangle", glyph: "rectangle", title: readOnly, message: Option.none() }),
    bigButton(h, { label: "Decision", glyph: "decision", title: readOnly, message: Option.none() }),
    bigButton(h, { label: "Connector", glyph: "connector", title: readOnly, message: Option.none() }),
    bigButton(h, { label: "Text", glyph: "text-tool", title: readOnly, message: Option.none() }),
  ]),
  h.p([h.Class("rb-note")], ["This drawing is generated from heron.config.json, so it cannot be edited here. Change the config and Heron draws a different lane."]),
]

const viewTab = (h: HtmlBuilder<Message>, model: Model): ReadonlyArray<Html> => [
  group(h, "Zoom", [
    bigButton(h, { label: "Fit Page", glyph: "zoom-fit", isPressed: model.zoom === "Fit", message: Option.some(Message.ClickedZoom({ zoom: "Fit" })) }),
    bigButton(h, { label: "100%", glyph: "zoom-100", isPressed: model.zoom === "100", message: Option.some(Message.ClickedZoom({ zoom: "100" })) }),
    bigButton(h, { label: "150%", glyph: "zoom-150", isPressed: model.zoom === "150", message: Option.some(Message.ClickedZoom({ zoom: "150" })) }),
  ]),
  group(
    h,
    "Show/Hide",
    [
      checkItem(h, "Grid", model.isGridShown, Message.ToggledGrid()),
      checkItem(h, "Shapes window", model.isShapesShown, Message.ToggledShapes()),
      checkItem(h, "Shape Data window", model.isShapeDataShown, Message.ToggledShapeData()),
    ],
    "is-stacked",
  ),
]

const ribbon = (h: HtmlBuilder<Message>, model: Model): Html =>
  h.div(
    [h.Class("ribbon")],
    [
      h.div(
        [h.Class("rb-tabs"), h.Role("tablist")],
        [
          h.span([h.Class("rb-orb"), h.AriaHidden(true)], [h.img([h.Src(glyphUrl("orb")), h.Alt(""), h.Width("38"), h.Height("38")])]),
          ...RibbonTab.literals.map((tab) =>
            h.button(
              [h.Class(`rb-tab${model.tab === tab ? " is-selected" : ""}`), h.Role("tab"), h.AriaSelected(model.tab === tab), h.OnClick(Message.ClickedTab({ tab }))],
              [tab],
            ),
          ),
        ],
      ),
      h.div(
        [h.Class("rb-body"), h.Role("tabpanel"), h.AriaLabel(model.tab)],
        model.tab === "Home" ? homeTab(h, model) : model.tab === "Insert" ? insertTab(h) : viewTab(h, model),
      ),
    ],
  )

// ---------------------------------------------------------------------------------------------------
// Panes

const masterIcon = (h: HtmlBuilder<Message>, kind: NodeKind): Html =>
  h.svg(
    [h.Class(`dg-master dg-${kind.toLowerCase()}`), h.ViewBox("-3 -3 46 32"), h.Width("40"), h.Height("28"), h.AriaHidden(true)],
    [h.path([h.Class("dg-shape"), h.D(outline(kind, 40, 26)), h.Fill("#dce8f6")])],
  )

const shapesPane = (h: HtmlBuilder<Message>, model: Model, flow: Flow): Html =>
  h.aside(
    [h.Class("dg-shapes"), h.AriaLabel("Shapes")],
    [
      h.div([h.Class("dg-pane-title")], ["Shapes"]),
      h.div([h.Class("dg-shapes-search")], [h.input([h.Placeholder("Search for Shapes"), h.AriaLabel("Search for Shapes"), h.Readonly(true)])]),
      h.div([h.Class("dg-stencil-title")], ["Heron Flow Shapes"]),
      h.div(
        [h.Class("dg-stencil")],
        stencil
          .filter((kind) => flow.nodes.some((node) => node.kind === kind))
          .map((kind) =>
            h.button(
              [
                h.Class(`dg-stencil-item${Option.contains(model.maybeHighlighted, kind) ? " is-selected" : ""}`),
                h.Title(`Highlight every ${kindLabel[kind].toLowerCase()} on this page`),
                h.OnClick(Message.ClickedStencil({ kind })),
              ],
              [masterIcon(h, kind), h.span([], [kindLabel[kind]])],
            ),
          ),
      ),
    ],
  )

const shapeDataPane = (h: HtmlBuilder<Message>, model: Model, flow: Flow): Html => {
  const maybeNode = Option.flatMap(model.maybeSelected, (id) => findNode(flow, id))
  return h.aside(
    [h.Class("dg-data"), h.AriaLabel("Shape Data"), h.AriaLive("polite")],
    [
      h.div(
        [h.Class("dg-pane-title")],
        [Option.match(maybeNode, { onNone: () => "Shape Data", onSome: (node) => `Shape Data - ${node.label}` })],
      ),
      Option.match(maybeNode, {
        onNone: () =>
          h.div(
            [h.Class("dg-data-empty")],
            [
              h.p([h.Class("dg-data-hint")], ["Click a shape to see its properties. Every value comes from the Heron docs and the example config."]),
              ...Option.match(findNode(flow, "lane"), {
                onNone: () => [],
                onSome: (lane) => [
                  h.div([h.Class("dg-data-subtitle")], [`This page: ${flow.lane} lane`]),
                  h.table([h.Class("dg-data-table")], [h.tbody([], lane.data.map(([label, value]) => h.tr([], [h.th([], [label]), h.td([], [value])])))]),
                ],
              }),
            ],
          ),
        onSome: (node) =>
          h.table(
            [h.Class("dg-data-table")],
            [
              h.tbody(
                [],
                [
                  h.tr([], [h.th([], ["Shape"]), h.td([], [kindLabel[node.kind]])]),
                  ...node.data.map(([label, value]) => h.tr([], [h.th([], [label]), h.td([], [value])])),
                ],
              ),
            ],
          ),
      }),
    ],
  )
}

const pageTabs = (h: HtmlBuilder<Message>, model: Model): Html =>
  h.div(
    [h.Class("dg-pagetabs"), h.Role("tablist"), h.AriaLabel("Lanes")],
    [
      h.span([h.Class("dg-pagenav"), h.AriaHidden(true)], [h.i([]), h.i([]), h.i([]), h.i([])]),
      ...LaneName.literals.map((lane) =>
        h.button(
          [h.Class(`dg-pagetab${model.lane === lane ? " is-selected" : ""}`), h.Role("tab"), h.AriaSelected(model.lane === lane), h.OnClick(Message.ClickedLane({ lane }))],
          [`${lane[0]?.toUpperCase() ?? ""}${lane.slice(1)} lane`],
        ),
      ),
    ],
  )

const statusText = (model: Model, flow: Flow): string =>
  Playback.match<string>(model.playback, {
    Playing: ({ wave }) => `Step ${wave + 1} of ${flow.waves.length}: ${flow.waves[wave] ?? ""}`,
    Finished: () => "Review played through. Heron wrote one note and stopped. It never approves or merges.",
    Stopped: () =>
      Option.match(Option.flatMap(model.maybeSelected, (id) => findNode(flow, id)), {
        onNone: () => `Page ${LaneName.literals.indexOf(model.lane) + 1}/3`,
        onSome: (node) => `${kindLabel[node.kind]}  |  Width: ${node.width} px  |  Height: ${node.height} px`,
      }),
  })

const statusBar = (h: HtmlBuilder<Message>, model: Model, flow: Flow): Html =>
  h.div(
    [h.Class("dg-status")],
    [
      h.span([h.Class("dg-status-text"), h.AriaLive("polite")], [statusText(model, flow)]),
      h.span([h.Class("dg-status-zoom")], [model.zoom === "Fit" ? "Fit page" : `${model.zoom}%`]),
    ],
  )

const missing = (h: HtmlBuilder<Message>): Html =>
  h.div([h.Class("dg-missing")], ["heron.config.json does not define this lane, so there is nothing to draw."])

// ---------------------------------------------------------------------------------------------------
// Phone: a simplified drawing, one step per row.

const phoneView = (h: HtmlBuilder<Message>, model: Model, flow: Flow): Html => {
  const maybeNode = Option.flatMap(model.maybeSelected, (id) => findNode(flow, id))
  const byWave = Array.makeBy(flow.waves.length, (wave) => flow.nodes.filter((node) => node.wave === wave))
  return h.div(
    [h.Class("dg-phone")],
    [
      h.div(
        [h.Class("dg-phone-lanes"), h.Role("tablist")],
        LaneName.literals.map((lane) =>
          h.button([h.Class(`dg-phone-lane${model.lane === lane ? " is-selected" : ""}`), h.Role("tab"), h.AriaSelected(model.lane === lane), h.OnClick(Message.ClickedLane({ lane }))], [lane]),
        ),
      ),
      Option.match(maybeNode, {
        onNone: () => h.empty,
        onSome: (node) =>
          h.div(
            [h.Class("dg-phone-data")],
            [
              h.h2([], [node.label]),
              h.dl([], node.data.flatMap(([label, value]) => [h.dt([], [label]), h.dd([], [value])])),
            ],
          ),
      }),
      h.ol(
        [h.Class("dg-phone-flow")],
        byWave.map((nodes, wave) =>
          h.li(
            [h.Class(`dg-phone-step is-${nodes[0] === undefined ? "idle" : nodeState(model, nodes[0])}`)],
            [
              h.div(
                [h.Class("dg-phone-nodes")],
                nodes.map((node) =>
                  h.button(
                    [h.Class(`dg-phone-node dg-${node.kind.toLowerCase()}${Option.contains(model.maybeSelected, node.id) ? " is-selected" : ""}`), h.OnClick(Message.ClickedNode({ id: node.id }))],
                    [node.label],
                  ),
                ),
              ),
              h.p([h.Class("dg-phone-caption")], [flow.waves[wave] ?? ""]),
            ],
          ),
        ),
      ),
      h.div(
        [h.Class("dg-phone-actions")],
        [
          h.button([h.Class("wm-button"), h.OnClick(Message.ClickedPlay())], [isPlaying(model) ? "Replay" : "Play"]),
          h.button([h.Class("wm-button"), h.OnClick(Message.ClickedApprove())], ["Approve merge request"]),
        ],
      ),
    ],
  )
}

/** `idPrefix` is unique to the window, for the ids inside the page's SVG. */
export type DiagramViewInputs = ViewInputs & Readonly<{ idPrefix: string }>

export const view = Submodel.defineView<Model, Message, DiagramViewInputs>((model, inputs, h) =>
  Option.match(flowFor(model.lane), {
    onNone: () => missing(h),
    onSome: (flow) =>
      inputs.form === "Phone"
        ? phoneView(h, model, flow)
        : h.div(
            [h.Class(`diagram${isPlaying(model) ? " is-playing" : ""}`)],
            [
              ribbon(h, model),
              h.div(
                [h.Class("dg-main")],
                [
                  model.isShapesShown ? shapesPane(h, model, flow) : h.empty,
                  h.div(
                    [h.Class("dg-canvas")],
                    [h.div([h.Class(`dg-scroll zoom-${model.zoom.toLowerCase()}`)], [pageView(h, model, flow, inputs.idPrefix)]), pageTabs(h, model)],
                  ),
                  model.isShapeDataShown ? shapeDataPane(h, model, flow) : h.empty,
                ],
              ),
              statusBar(h, model, flow),
            ],
          ),
  }),
)
