import { execFile } from "node:child_process"
import { readFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { pathToFileURL } from "node:url"
import type { Plugin } from "vite"

import type * as HeronConfig from "../../src/config.ts"
import type { FindingId, GateName, ModelFinding, Outcome, Review, SessionId, SessionRecord, Sha } from "../../src/domain.ts"
import type * as HeronPolicy from "../../src/policy.ts"
import type * as HeronReport from "../../src/report.ts"

import * as mr42 from "../src/data/mr42-data.ts"

// `virtual:heron-build` holds what Heron itself prints, produced at build time by the repository's own code:
// the CLI's output for the commands the Command Prompt knows, and the report note for the fictional merge
// request !42, rendered by `renderReport` from `src/report.ts`. The root package runs in Node with its own
// dependencies (effect 4.0.0-rc.115), so nothing from it is bundled into the site.

const exampleConfig = "heron.config.example.json"

/** The Heron OS machine: the example config pointed at the fictional GitLab, with a token and a backend credential set. */
const machineEnv = {
  HERON_GITLAB_URL: "https://gitlab.heron.local",
  HERON_PROJECT: mr42.mergeRequest.project,
  GITLAB_TOKEN: "heron-os",
  CLAUDE_CODE_OAUTH_TOKEN: "heron-os",
}

/** `heron` arguments whose real output the Command Prompt prints, keyed by the arguments joined with spaces. */
const captured: ReadonlyArray<ReadonlyArray<string>> = [
  [],
  ["--help"],
  ["-h"],
  ["--version"],
  ["-v"],
  ["review"],
  ["review", "--help"],
  ["config"],
  ["config", "--help"],
  ["config", "check"],
]

type Result<A> = { readonly _tag: "Success"; readonly success: A } | { readonly _tag: "Failure"; readonly failure: { readonly message: string } }

/** The fictional data's plain strings, as the branded ids Heron's own decoders would produce. */
const brand = <B extends string>(value: string): B => value as B

const succeed = <A>(result: Result<A>, what: string): A => {
  if (result._tag === "Failure") throw new Error(`${what}: ${result.failure.message}`)
  return result.success
}

const check = (isTrue: boolean, what: string): void => {
  if (!isTrue) throw new Error(`mr42-data.ts disagrees with Heron: ${what}`)
}

const runCli = (repoRoot: string, args: ReadonlyArray<string>): Promise<string> => {
  const withConfig = args[0] === "config" && args[1] === "check" ? [...args, "--config", exampleConfig] : args
  return new Promise((done, fail) =>
    execFile(process.execPath, ["src/cli.ts", ...withConfig], { cwd: repoRoot, env: { PATH: process.env["PATH"] ?? "", ...machineEnv } }, (error, stdout, stderr) =>
      // `heron review` without --mr exits 1 after printing its help and the error; that output is what we want.
      error !== null && typeof error.code !== "number" ? fail(error) : done(`${stdout}${stderr}`.replace(/\n+$/, "")),
    ),
  )
}

const render = async (repoRoot: string) => {
  // Typed as Heron's own modules, so a change to their shapes fails the site's typecheck before it fails this build.
  const load = <M>(path: string): Promise<M> => import(pathToFileURL(join(repoRoot, path)).href)
  const [config, policy, report] = await Promise.all([
    load<typeof HeronConfig>("src/config.ts"),
    load<typeof HeronPolicy>("src/policy.ts"),
    load<typeof HeronReport>("src/report.ts"),
  ])

  const file = succeed(config.decodeConfigFile(JSON.parse(readFileSync(join(repoRoot, exampleConfig), "utf8")), machineEnv), "config")
  const texts = new Map<string, string>(config.instructionPaths(file).map((path: string) => [path, readFileSync(join(repoRoot, path), "utf8")]))
  const resolved = succeed(config.resolveConfig(file, texts), "config")

  const { mergeRequest } = mr42
  const changes = mr42.files.map((f) => ({ path: f.path, oldPath: f.status === "added" ? null : f.path, status: f.status, diff: f.diff }))
  const classification = policy.classify(resolved, changes)
  check(classification.lane.name === mr42.lane.name, `lane ${classification.lane.name}`)
  const plan = policy.planFor(classification.lane)
  const slots = policy.slotsOf(plan)
  check(slots.map((s) => s.id).join() === mr42.sessions.map((s) => s.id).join(), `sessions ${slots.map((s) => s.id).join()}`)

  const modelFinding = (f: mr42.RawFinding): ModelFinding => ({
    gate: brand<GateName>(f.gate),
    severity: f.severity,
    location: { path: f.path, line: f.line },
    title: f.title,
    body: f.body,
  })
  const gates = mr42.sessions.filter((s) => s.role === "gate")
  const supervisor = mr42.sessions.find((s) => s.role === "supervisor")
  if (supervisor === undefined) throw new Error("mr42-data.ts has no supervisor session")
  const supervisorId = brand<SessionId>(supervisor.id)
  const inputs = gates.flatMap((s) => policy.assignIds(brand<SessionId>(s.id), s.findings.map(modelFinding)))
  const decisions = supervisor.decisions.map((d) => ({ ...d, id: brand<FindingId>(d.id) }))
  const findings = succeed(
    policy.applySynthesis(inputs, { summary: mr42.summary, decisions, added: supervisor.findings.map(modelFinding), limitations: [] }, supervisorId),
    "supervisor decisions",
  )
  const rulings = decisions.map((d) => ({ by: supervisorId, finding: inputs.find((f) => f.id === d.id)!, keep: d.keep, reason: d.reason }))
  const outcome: Outcome = { kind: "complete", summary: mr42.summary, findings, rulings, limitations: mr42.sessions.flatMap((s) => s.limitations) }
  const verdict = policy.verdictOf(outcome)
  check(verdict === mr42.verdict, `verdict ${verdict}`)

  const records = slots.map((slot): SessionRecord => {
    const session = mr42.sessions.find((s) => s.id === slot.id)!
    return {
      slot,
      reportedModel: null,
      vendorSessionId: null,
      usage: { inputTokens: session.inputTokens, cachedInputTokens: null, outputTokens: session.outputTokens, reasoningTokens: null, costUsd: null },
      toolCalls: session.toolCalls,
      durationMs: session.durationMs,
      failure: null,
    }
  })
  const review: Review = {
    snapshot: {
      ref: { project: mergeRequest.project, iid: mergeRequest.iid },
      title: mergeRequest.title,
      description: mergeRequest.description,
      author: mergeRequest.author,
      sourceBranch: mergeRequest.sourceBranch,
      targetBranch: mergeRequest.targetBranch,
      webUrl: mergeRequest.webUrl,
      projectWebUrl: mergeRequest.projectWebUrl,
      labels: mergeRequest.labels,
      revision: { base: brand<Sha>(mergeRequest.base), start: brand<Sha>(mergeRequest.base), head: brand<Sha>(mergeRequest.head) },
      changes,
    },
    classification,
    plan,
    sessions: records,
    outcome,
    verdict,
    configDigest: resolved.digest,
    liveHead: null,
  }
  return {
    note: report.renderReport(review),
    findingIds: findings.map((f) => f.id),
    configDigest: resolved.digest,
    labels: resolved.labels,
    profiles: Object.fromEntries(slots.map((s) => [s.profile.name, s.profile])),
  }
}

export const heronBuild = (): Plugin => {
  const id = "virtual:heron-build"
  const repoRoot = resolve(import.meta.dirname, "..", "..")
  return {
    name: "heron-build",
    resolveId: (source) => (source === id ? `\0${id}` : undefined),
    async load(loadId) {
      if (loadId !== `\0${id}`) return undefined
      for (const path of ["src/report.ts", "src/policy.ts", "src/config.ts", "src/cli.ts", exampleConfig, "site/src/data/mr42-data.ts"]) {
        this.addWatchFile(join(repoRoot, path))
      }
      const [rendered, outputs] = await Promise.all([render(repoRoot), Promise.all(captured.map((args) => runCli(repoRoot, args)))])
      const cli = Object.fromEntries(captured.map((args, index) => [args.join(" "), outputs[index]]))
      const digestLine = `digest: ${rendered.configDigest}`
      if (!(cli["config check"] ?? "").endsWith(digestLine)) throw new Error("heron config check printed another digest than the rendered report")
      return [
        `export const reportNote = ${JSON.stringify(rendered.note)}`,
        `export const findingIds = ${JSON.stringify(rendered.findingIds)}`,
        `export const configDigest = ${JSON.stringify(rendered.configDigest)}`,
        `export const labelNames = ${JSON.stringify(rendered.labels)}`,
        `export const profiles = ${JSON.stringify(rendered.profiles)}`,
        `export const cliOutput = ${JSON.stringify(cli)}`,
      ].join("\n")
    },
  }
}
