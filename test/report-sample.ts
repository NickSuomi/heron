import type { Finding, FindingId, Outcome, Review, SessionId, SessionRecord } from "../src/domain.ts"
import { classify, planFor, slotsOf } from "../src/policy.ts"
import { baseConfig, change, configOf, sha, snapshotAt, texts } from "./fakes.ts"

/** The standard lane with four gates: four gate sessions and a supervisor. */
const config = configOf(
  {
    ...baseConfig,
    gates: { ...baseConfig.gates, spec: { instructions: "spec.md" }, ui: { instructions: "ui.md" } },
    lanes: baseConfig.lanes.map((l) => l.name === "standard" ? { ...l, gates: ["design", "correctness", "spec", "ui"] } : l)
  },
  {},
  new Map([...texts, ["spec.md", "Check the spec."], ["ui.md", "Check the UI."]])
)
const changes = [change("src/export.ts"), change("src/ExportButton.vue")]
const classification = classify(config, changes)
const plan = planFor(classification.lane)

const finding = (n: number, gate: string, severity: Finding["severity"], title: string, body: string, path: string, line: number): Finding => ({
  id: `gate.${gate}#${n}` as FindingId,
  origin: `gate.${gate}` as SessionId,
  gate,
  severity,
  location: { path, line },
  title,
  body
})

const blocker = finding(1, "correctness", "blocker", "Export button stays enabled while an export runs", "A second click starts a parallel export that overwrites the first file. Disable the button while `isExporting` is true.", "src/ExportButton.vue", 12)
const advisories = [
  finding(1, "ui", "advisory", "Button has no accessible busy state", "Screen readers do not hear that the export started. Set `aria-busy` while it runs.", "src/ExportButton.vue", 14),
  finding(2, "ui", "advisory", "Error toast repeats the raw exception text", "Users see a stack-style message. Show the translated `export.failed` text instead.", "src/export.ts", 40),
  finding(1, "design", "advisory", "CSV writer duplicates the existing table serializer", "Reuse `serializeTable` from the table helpers.", "src/export.ts", 8),
  finding(2, "design", "advisory", "Magic number for the row limit", "Name the `10000` limit as a constant.", "src/export.ts", 22),
  finding(1, "spec", "advisory", "Description does not mention the row limit", "Say in the description that exports stop at 10,000 rows.", "src/export.ts", 22),
  finding(2, "spec", "advisory", "New helper has no region blocks", "Add the region blocks the helper rules ask for.", "src/export.ts", 1)
]
const dropped = finding(2, "correctness", "blocker", "Export ignores the active filter", "The export reads all rows.", "src/export.ts", 30)

const session = (slot: SessionRecord["slot"], i: number): SessionRecord => ({
  slot,
  reportedModel: slot.profile.model,
  vendorSessionId: null,
  usage: { inputTokens: 40_000 + i * 10_000, cachedInputTokens: null, outputTokens: 1_200 + i * 100, reasoningTokens: null, costUsd: 0.08 + i * 0.01 },
  toolCalls: 2 + i,
  durationMs: 13_000 + i * 1_000,
  failure: null
})

/** A generic outcome shaped like a busy real one: 1 blocker, 6 advisories, 3 limitations, a summary that runs long. */
export const sampleOutcome: Extract<Outcome, { kind: "complete" }> = {
  kind: "complete",
  summary: [
    "The change adds a CSV export to the report page. The export button must be disabled while an export runs.",
    "What I kept:",
    "- **Parallel export (gate.correctness#1).** A second click overwrites the first file.",
    "- The filter concern is wrong; `exportRows` receives the filtered rows."
  ].join("\n"),
  findings: [blocker, ...advisories],
  rulings: [
    { by: "supervisor" as SessionId, finding: blocker, keep: true, reason: "The button has no disabled binding at the reviewed head." },
    { by: "supervisor" as SessionId, finding: dropped, keep: false, reason: "exportRows receives the filtered rows from the store." }
  ],
  limitations: [
    "I could not run the app, so the double-click race is inferred from the code.",
    "I did not read the linked work item.",
    "I did not check the CSV output in a spreadsheet program."
  ]
}

export const sampleReview: Review = {
  snapshot: snapshotAt(sha("a"), changes),
  classification,
  plan,
  sessions: slotsOf(plan).map(session),
  outcome: sampleOutcome,
  verdict: "CHANGES REQUESTED",
  configDigest: "f".repeat(64),
  liveHead: null,
  rereview: null
}
