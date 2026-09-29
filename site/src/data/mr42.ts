// FICTIONAL: acme/storefront and merge request !42 are an illustrative example written for Heron OS.
// The report note is real Heron output: the build renders it with the repository's `renderReport` (see
// `build/heron-build.ts`). Every app that shows this merge request reads it from here.

import { configDigest, findingIds, profiles, reportNote } from "virtual:heron-build"

import * as data from "./mr42-data"

export type GateName = data.GateName
export type Severity = data.Severity

/** A finding the report lists. `id` is Heron's finding id, such as `gate.correctness#1`. */
export type Finding = data.RawFinding & Readonly<{ id: string }>

export type Session = Readonly<{
  id: string
  role: "gate" | "supervisor"
  gates: ReadonlyArray<GateName>
  harness: string
  model: string
  effort: string
  /** From the start of the first session, in real review time. */
  startMs: number
  durationMs: number
  inputTokens: number
  outputTokens: number
  toolCalls: number
  /** How many findings the session returned (a gate) or kept and added (the supervisor). */
  findingCount: number
}>

export type ChangedFile = Readonly<{ path: string; status: "added" | "modified"; before: string; after: string; diff: string }>

export type MergeRequest42 = Readonly<{
  isFictional: true
  project: string
  iid: number
  title: string
  description: string
  author: string
  sourceBranch: string
  targetBranch: string
  webUrl: string
  head: string
  /** Labels before Heron runs. */
  labels: ReadonlyArray<string>
  files: ReadonlyArray<ChangedFile>
  /** The whole change as `git diff` prints it. */
  diff: string
  lane: Readonly<{ name: string; shape: "gated"; gates: ReadonlyArray<GateName> }>
  sessions: ReadonlyArray<Session>
  /** Blockers first, then advisories, in the report's order. */
  findings: ReadonlyArray<Finding>
  verdict: "CHANGES REQUESTED"
  configDigest: string
  noteId: number
  /** The report note, exactly as `heron review --mr 42 --dry-run` prints it. */
  note: string
}>

const numbered = (session: data.RawSession): ReadonlyArray<Finding> =>
  session.findings.map((finding, index) => ({ ...finding, id: `${session.id}#${index + 1}` }))

const supervisor = data.sessions.find((session) => session.role === "supervisor")
const kept = new Set(supervisor?.decisions.filter((decision) => decision.keep).map((decision) => decision.id))
const gateFindings = data.sessions.filter((session) => session.role === "gate").flatMap(numbered)
const synthesised = [...gateFindings.filter((finding) => kept.has(finding.id)), ...(supervisor === undefined ? [] : numbered(supervisor))]
const findings = [...synthesised.filter((f) => f.severity === "blocker"), ...synthesised.filter((f) => f.severity === "advisory")]

if (synthesised.map((finding) => finding.id).join() !== findingIds.join()) {
  throw new Error("mr42.ts derives other findings than Heron's applySynthesis")
}

const sessions: ReadonlyArray<Session> = data.sessions.map((session) => {
  const profile = profiles[session.profile]
  return {
    id: session.id,
    role: session.role,
    gates: session.gates,
    harness: profile?.harness ?? "",
    model: profile?.model ?? "",
    effort: profile?.effort ?? "",
    startMs: session.startMs,
    durationMs: session.durationMs,
    inputTokens: session.inputTokens,
    outputTokens: session.outputTokens,
    toolCalls: session.toolCalls,
    findingCount: session.role === "gate" ? session.findings.length : synthesised.length,
  }
})

const { mergeRequest } = data

export const mr42: MergeRequest42 = {
  isFictional: true,
  project: mergeRequest.project,
  iid: mergeRequest.iid,
  title: mergeRequest.title,
  description: mergeRequest.description,
  author: mergeRequest.author,
  sourceBranch: mergeRequest.sourceBranch,
  targetBranch: mergeRequest.targetBranch,
  webUrl: mergeRequest.webUrl,
  head: mergeRequest.head,
  labels: mergeRequest.labels,
  files: data.files,
  diff: data.diff,
  lane: data.lane,
  sessions,
  findings,
  verdict: data.verdict,
  configDigest,
  noteId: mergeRequest.noteId,
  note: reportNote,
}

export const findingsIn = (path: string): ReadonlyArray<Finding> => findings.filter((finding) => finding.path === path)
