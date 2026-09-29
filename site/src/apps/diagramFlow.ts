import { Array, Option, pipe, Schema } from "effect"

import { FilePath, lookupFile } from "../domain/vfs"

// "How Heron works.vsd" draws the lanes of the repository's own heron.config.example.json, which the
// desktop carries as heron.config.json. Shapes, sessions and wording follow docs/configuration.md,
// README.md "How it works", src/policy.ts (planFor, verdictOf) and src/prompt.ts (the role texts).

export const LaneName = Schema.Literals(["light", "standard", "critical"])
export type LaneName = typeof LaneName.Type

const BranchSpec = Schema.Struct({ gate: Schema.String, supervisor: Schema.String })
const LaneSpec = Schema.Union([
  Schema.Struct({ name: Schema.String, shape: Schema.Literal("single"), gates: Schema.Array(Schema.String), reviewer: Schema.String }),
  Schema.Struct({ name: Schema.String, shape: Schema.Literal("gated"), gates: Schema.Array(Schema.String), gate: Schema.String, supervisor: Schema.String }),
  Schema.Struct({ name: Schema.String, shape: Schema.Literal("dual"), gates: Schema.Array(Schema.String), branches: Schema.Tuple([BranchSpec, BranchSpec]), judge: Schema.String }),
])
type LaneSpec = typeof LaneSpec.Type

const RuleSpec = Schema.Struct({ id: Schema.String, lane: Schema.String, when: Schema.Literals(["any", "all"]), paths: Schema.Array(Schema.String) })
type RuleSpec = typeof RuleSpec.Type

const ConfigView = Schema.Struct({
  lanes: Schema.Array(LaneSpec),
  defaultLane: Schema.String,
  rules: Schema.Array(RuleSpec),
  labels: Schema.Struct({
    inProgress: Schema.String,
    pass: Schema.String,
    changesRequested: Schema.String,
    blocked: Schema.String,
  }),
})
type ConfigView = typeof ConfigView.Type

export const configPath = FilePath.make("/Desktop/heron.config.json")

const config: Option.Option<ConfigView> = pipe(
  lookupFile(configPath),
  Option.flatMap((file) => Schema.decodeUnknownOption(Schema.fromJsonString(ConfigView))(file.content)),
)

/** The four example gate instructions, first sentence, from examples/instructions/<gate>.md. */
const gateInstructions: Readonly<Record<string, string>> = {
  design: "Check that the change fits the surrounding design: responsibilities stay in the module that owns them, new interfaces are no wider than their callers need, and nothing duplicates an existing mechanism.",
  correctness: "Check that the change does what its description says: trace each changed path, including error and empty cases, and flag behaviour that is wrong at the reviewed head.",
  security: "Check untrusted input, authentication and authorization paths, secrets handling, and injection risks in the changed code.",
}

export type NodeKind = "MergeRequest" | "Rules" | "Lane" | "Reviewer" | "Gate" | "Supervisor" | "Judge" | "Verdict" | "Note"

/** One Shape Data row: a property name and its value, as the Shape Data window lists them. */
export type ShapeDatum = readonly [label: string, value: string]

export type FlowNode = Readonly<{
  id: string
  kind: NodeKind
  label: string
  sublabel: string
  x: number
  y: number
  width: number
  height: number
  /** Play lights the nodes wave by wave; nodes in one wave run at the same time. */
  wave: number
  data: ReadonlyArray<ShapeDatum>
}>

export type FlowEdge = Readonly<{ from: string; to: string }>

/** A dashed frame around one branch of a dual lane. */
export type FlowGroup = Readonly<{ label: string; x: number; y: number; width: number; height: number }>

export type Flow = Readonly<{
  lane: LaneName
  nodes: ReadonlyArray<FlowNode>
  edges: ReadonlyArray<FlowEdge>
  groups: ReadonlyArray<FlowGroup>
  waves: ReadonlyArray<string>
}>

/** The page every lane is drawn on, in page units (1 unit is 1 px at 100% zoom). */
export const page = { width: 1030, height: 540 } as const

const nodeWidth = 110
const nodeHeight = 50
const column = (index: number): number => 24 + index * 126
const middle = 296

const gateData = (gate: string, profile: string, sessionId: string): ReadonlyArray<ShapeDatum> => [
  ["Role", "gate"],
  ["Session id", sessionId],
  ["Gate", gate],
  ["Profile", profile],
  ["Instructions", `examples/instructions/${gate}.md`],
  ["What it checks", gateInstructions[gate] ?? "The instructions file named in the config."],
  ["Tools", "grep, list_files, read_file (read-only, on a bare repository holding exactly the reviewed commit)"],
  ["Returns", "Findings as JSON that must match the schema Heron supplies"],
  ["If it fails", "A session that fails, times out, calls another tool, or returns JSON that does not match ends the review as BLOCKED."],
]

const mergeRequestNode = (): FlowNode => ({
  id: "mr",
  kind: "MergeRequest",
  label: "Merge request",
  sublabel: "one head commit",
  x: column(0),
  y: middle - 30,
  width: nodeWidth - 12,
  height: 60,
  wave: 0,
  data: [
    ["Step", "1 and 2 of How it works"],
    ["Admission", "If the config lists allowed users, Heron checks that the user who triggered the review is one of them."],
    ["Reads", "The merge request and its full diff from the GitLab API at one head commit."],
    ["Stops when", "GitLab truncated or collapsed any part of the diff. Heron stops without reviewing."],
    ["Source", "README.md, How it works"],
  ],
})

const rulesNode = (): FlowNode => ({
  id: "rules",
  kind: "Rules",
  label: "Path rules",
  sublabel: "pick a lane",
  x: column(1) - 6,
  y: middle - 40,
  width: nodeWidth + 12,
  height: 80,
  wave: 1,
  data: [
    ["Step", "3 of How it works"],
    ...Option.match(config, {
      onNone: () => [] as ReadonlyArray<ShapeDatum>,
      onSome: (view) => [
        ...view.rules.map((rule: RuleSpec): ShapeDatum => [`Rule ${rule.id}`, `${rule.lane} when ${rule.when} changed paths match ${rule.paths.join(", ")}`]),
        ["Default lane", `${view.defaultLane}, when no rule fires`] as const,
      ],
    }),
    ["Several rules", "If several rules fire, the strictest lane wins. The order of lanes is the severity order."],
    ["Renames", "A renamed file counts under its old and its new path."],
    ["Source", "docs/configuration.md, lanes, defaultLane, and rules"],
  ],
})

const sessionsText: Readonly<Record<LaneSpec["shape"], string>> = {
  single: "One session reviews all gates.",
  gated: "One session per gate with the gate profile, then one supervisor session that keeps or drops each finding and may add findings.",
  dual: "Two independent gated branches, then one judge session that keeps or drops each finding. The judge has no repository access.",
}

const laneNode = (lane: LaneSpec): FlowNode => ({
  id: "lane",
  kind: "Lane",
  label: `Lane: ${lane.name}`,
  sublabel: `shape ${lane.shape}`,
  x: column(2),
  y: middle - 28,
  width: nodeWidth,
  height: 56,
  wave: 2,
  data: [
    ["Lane", lane.name],
    ["Shape", lane.shape],
    ["Gates", lane.gates.join(", ")],
    ["Sessions", sessionsText[lane.shape]],
    ["Source", "heron.config.json (the repository's heron.config.example.json)"],
  ],
})

const supervisorData = (profile: string, sessionId: string, gates: ReadonlyArray<string>): ReadonlyArray<ShapeDatum> => [
  ["Role", "supervisor"],
  ["Session id", sessionId],
  ["Profile", profile],
  ["Gates", gates.join(", ")],
  ["Does", "Rules on every gate finding exactly once: keeps a finding only if it is a real defect at the reviewed head, and says why. May add findings the gates missed."],
  ["Tools", "grep, list_files, read_file"],
  ["If it fails", "Decisions that miss, repeat or invent a finding id fail the review as BLOCKED instead of guessing."],
  ["Source", "src/policy.ts planFor, src/prompt.ts"],
]

const verdictNode = (x: number, wave: number): FlowNode => ({
  id: "verdict",
  kind: "Verdict",
  label: "Verdict",
  sublabel: "code decides",
  x,
  y: middle - 26,
  width: nodeWidth,
  height: 52,
  wave,
  data: [
    ["Step", "5 of How it works"],
    ["Decided by", "Code, not the model (verdictOf in src/policy.ts)."],
    ["CHANGES REQUESTED", "Any blocker finding."],
    ["BLOCKED", "A session failed, timed out, or returned malformed output. Never PASS."],
    ["PASS", "The review completed with no blocker finding."],
    ["SUPERSEDED", "The branch moved during the review."],
    ["Words", "The four words are fixed so that scripts can match them."],
  ],
})

const noteNode = (x: number, wave: number): FlowNode => ({
  id: "note",
  kind: "Note",
  label: "Report note",
  sublabel: "one note, one label",
  x,
  y: middle - 32,
  width: nodeWidth - 8,
  height: 64,
  wave,
  data: [
    ["Step", "6 of How it works"],
    ["Writes", "Creates or updates its one report note on the merge request, then sets the verdict label."],
    ["Marker", "The note starts with a hidden marker that records the head commit, the config digest, and the verdict."],
    ...Option.match(config, {
      onNone: () => [] as ReadonlyArray<ShapeDatum>,
      onSome: (view): ReadonlyArray<ShapeDatum> => [
        ["Labels", `${view.labels.pass}, ${view.labels.changesRequested}, ${view.labels.blocked}; ${view.labels.inProgress} while it runs`],
      ],
    }),
    ["Never", "Heron does not start inline discussion threads, approve, or merge."],
    ["Source", "README.md, How it works and Why Heron?"],
  ],
})

/** Stacks `count` boxes of `height` centred on `centre`, `gap` apart. */
const stack = (count: number, height: number, gap: number, centre: number): ReadonlyArray<number> =>
  Array.makeBy(count, (index) => centre - (count * height + (count - 1) * gap) / 2 + index * (height + gap))

const flowOf = (lane: LaneSpec): Flow => {
  const head = [mergeRequestNode(), rulesNode(), laneNode(lane)]
  const headEdges: ReadonlyArray<FlowEdge> = [
    { from: "mr", to: "rules" },
    { from: "rules", to: "lane" },
  ]
  switch (lane.shape) {
    case "single": {
      const reviewer: FlowNode = {
        id: "reviewer",
        kind: "Reviewer",
        label: "Reviewer",
        sublabel: `${lane.gates.join(", ")} · ${lane.reviewer}`,
        x: column(3) + 40,
        y: middle - 30,
        width: nodeWidth + 40,
        height: 60,
        wave: 3,
        data: [
          ["Role", "reviewer"],
          ["Session id", "reviewer"],
          ["Profile", lane.reviewer],
          ["Gates", lane.gates.join(", ")],
          ["Does", "One session reviews all gates."],
          ...lane.gates.map((gate): ShapeDatum => [`Gate ${gate}`, gateInstructions[gate] ?? ""]),
          ["Tools", "grep, list_files, read_file"],
          ["Source", "docs/configuration.md, lanes; src/policy.ts planFor"],
        ],
      }
      return {
        lane: "light",
        nodes: [...head, reviewer, verdictNode(column(5), 4), noteNode(column(6) + 10, 5)],
        edges: [...headEdges, { from: "lane", to: "reviewer" }, { from: "reviewer", to: "verdict" }, { from: "verdict", to: "note" }],
        groups: [],
        waves: [
          "Heron reads merge request !42 and its full diff at one head commit.",
          "Path rules pick the lane. A docs-only change takes the light lane.",
          "The light lane has the single shape: one session for every gate.",
          "One reviewer session reads the commit through grep, list_files and read_file.",
          "Code derives the verdict from the findings.",
          "Heron writes one report note and sets one label. Nothing else changes.",
        ],
      }
    }
    case "gated": {
      const ys = stack(lane.gates.length, nodeHeight, 18, middle)
      const gates = lane.gates.map((gate, index): FlowNode => ({
        id: `gate-${gate}`,
        kind: "Gate",
        label: gate,
        sublabel: `gate, ${lane.gate}`,
        x: column(3),
        y: ys[index] ?? middle,
        width: nodeWidth,
        height: nodeHeight,
        wave: 3,
        data: gateData(gate, lane.gate, `gate.${gate}`),
      }))
      const supervisor: FlowNode = {
        id: "supervisor",
        kind: "Supervisor",
        label: "Supervisor",
        sublabel: lane.supervisor,
        x: column(4),
        y: middle - 28,
        width: nodeWidth,
        height: 56,
        wave: 4,
        data: supervisorData(lane.supervisor, "supervisor", lane.gates),
      }
      return {
        lane: "standard",
        nodes: [...head, ...gates, supervisor, verdictNode(column(5), 5), noteNode(column(6), 6)],
        edges: [
          ...headEdges,
          ...gates.map((gate) => ({ from: "lane", to: gate.id })),
          ...gates.map((gate) => ({ from: gate.id, to: "supervisor" })),
          { from: "supervisor", to: "verdict" },
          { from: "verdict", to: "note" },
        ],
        groups: [],
        waves: [
          "Heron reads merge request !42 and its full diff at one head commit.",
          "Path rules pick the lane. With no rule firing, the default lane applies: standard.",
          "The standard lane has the gated shape: one session per gate, then a supervisor.",
          "One session per gate, each with its own instructions, reads the commit through three read-only tools.",
          "The supervisor keeps or drops each gate finding, and may add findings.",
          "Code derives the verdict: any blocker finding means CHANGES REQUESTED.",
          "Heron writes one report note and sets one label. Nothing else changes.",
        ],
      }
    }
    case "dual": {
      const branchCentres = [middle - 114, middle + 114]
      const branches = lane.branches.flatMap((branch, index) => {
        const prefix = `b${index + 1}`
        const centre = branchCentres[index] ?? middle
        const ys = stack(lane.gates.length, 40, 10, centre)
        const gates = lane.gates.map((gate, gateIndex): FlowNode => ({
          id: `${prefix}-gate-${gate}`,
          kind: "Gate",
          label: gate,
          sublabel: `gate, ${branch.gate}`,
          x: column(3),
          y: ys[gateIndex] ?? centre,
          width: nodeWidth,
          height: 40,
          wave: 3,
          data: gateData(gate, branch.gate, `${prefix}.gate.${gate}`),
        }))
        const supervisor: FlowNode = {
          id: `${prefix}-supervisor`,
          kind: "Supervisor",
          label: "Supervisor",
          sublabel: branch.supervisor,
          x: column(4),
          y: centre - 26,
          width: nodeWidth,
          height: 52,
          wave: 4,
          data: supervisorData(branch.supervisor, `${prefix}.supervisor`, lane.gates),
        }
        return [...gates, supervisor]
      })
      const judge: FlowNode = {
        id: "judge",
        kind: "Judge",
        label: "Judge",
        sublabel: `${lane.judge} · no tools`,
        x: column(5),
        y: middle - 30,
        width: nodeWidth,
        height: 60,
        wave: 5,
        data: [
          ["Role", "judge"],
          ["Session id", "judge"],
          ["Profile", lane.judge],
          ["Reads", "The diff, both branch summaries, and the findings both branches kept."],
          ["Does", "Rules on every finding exactly once and keeps it only if it is a real defect at the reviewed head."],
          ["Tools", "None. The judge has no repository access."],
          ["Source", "docs/configuration.md; docs/backends.md, What each backend runs; src/prompt.ts"],
        ],
      }
      const groups = lane.branches.map((branch, index): FlowGroup => ({
        label: `Branch ${index + 1} (b${index + 1}), independent`,
        x: column(3) - 14,
        y: (branchCentres[index] ?? middle) - 92,
        width: column(4) - column(3) + nodeWidth + 28,
        height: 184,
      }))
      const gateNodes = branches.filter((node) => node.kind === "Gate")
      return {
        lane: "critical",
        nodes: [...head, ...branches, judge, verdictNode(column(6), 6), noteNode(column(7), 7)],
        edges: [
          ...headEdges,
          ...gateNodes.map((gate) => ({ from: "lane", to: gate.id })),
          ...gateNodes.map((gate) => ({ from: gate.id, to: `${gate.id.slice(0, 2)}-supervisor` })),
          { from: "b1-supervisor", to: "judge" },
          { from: "b2-supervisor", to: "judge" },
          { from: "judge", to: "verdict" },
          { from: "verdict", to: "note" },
        ],
        groups,
        waves: [
          "Heron reads merge request !42 and its full diff at one head commit.",
          "Path rules pick the lane. A change under src/auth/** or to any .sql file takes the critical lane.",
          "The critical lane has the dual shape: two independent branches and a judge.",
          "The two branches run independently. Neither sees the other's findings.",
          "Each branch's supervisor keeps or drops its own gates' findings.",
          "The judge rules on every finding the branches kept. It has no repository access.",
          "Code derives the verdict: any blocker finding means CHANGES REQUESTED.",
          "Heron writes one report note and sets one label. Nothing else changes.",
        ],
      }
    }
  }
}

const laneSpec = (name: LaneName): Option.Option<LaneSpec> =>
  Option.flatMap(config, (view) => Array.findFirst(view.lanes, (lane) => lane.name === name))

/** Shifts a drawing so its shapes sit in the middle of the page's width. */
const centred = (flow: Flow): Flow => {
  const right = Math.max(...flow.nodes.map((node) => node.x + node.width), ...flow.groups.map((group) => group.x + group.width))
  const dx = Math.max(0, Math.round((page.width - right - 24) / 2))
  return {
    ...flow,
    nodes: flow.nodes.map((node) => ({ ...node, x: node.x + dx })),
    groups: flow.groups.map((group) => ({ ...group, x: group.x + dx })),
  }
}

/** The drawing for one lane, or nothing when the bundled config does not define that lane. */
export const flowFor = (name: LaneName): Option.Option<Flow> => Option.map(laneSpec(name), (lane) => centred(flowOf(lane)))

export const laneShape = (name: LaneName): string =>
  Option.match(laneSpec(name), { onNone: () => "", onSome: (lane) => lane.shape })

export const findNode = (flow: Flow, id: string): Option.Option<FlowNode> => Array.findFirst(flow.nodes, (node) => node.id === id)

/** A Visio-style dynamic connector: out of the source's right side, one elbow, into the target's left side. */
export const connectorPath = (from: FlowNode, to: FlowNode): string => {
  const x1 = from.x + from.width
  const y1 = from.y + from.height / 2
  const x2 = to.x - 2
  const y2 = to.y + to.height / 2
  const elbow = Math.round(x1 + (x2 - x1) / 2)
  return y1 === y2 ? `M${x1} ${y1} H${x2}` : `M${x1} ${y1} H${elbow} V${y2} H${x2}`
}

export const kindLabel: Readonly<Record<NodeKind, string>> = {
  MergeRequest: "Merge request",
  Rules: "Path rules",
  Lane: "Lane",
  Reviewer: "Reviewer session",
  Gate: "Gate session",
  Supervisor: "Supervisor session",
  Judge: "Judge session",
  Verdict: "Verdict",
  Note: "Report note",
}

/** The stencil in the Shapes window, in flow order. */
export const stencil: ReadonlyArray<NodeKind> = ["MergeRequest", "Rules", "Lane", "Reviewer", "Gate", "Supervisor", "Judge", "Verdict", "Note"]
