import { execFile } from "node:child_process"
import { readFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { pathToFileURL } from "node:url"
import type { Plugin } from "vite"

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
  const load = (path: string) => import(pathToFileURL(join(repoRoot, path)).href)
  const [config, policy, report] = await Promise.all([load("src/config.ts"), load("src/policy.ts"), load("src/report.ts")])

  const file = succeed(config.decodeConfigFile(JSON.parse(readFileSync(join(repoRoot, exampleConfig), "utf8")), machineEnv), "config")
  const texts = new Map<string, string>(config.instructionPaths(file).map((path: string) => [path, readFileSync(join(repoRoot, path), "utf8")]))
  const resolved = succeed(config.resolveConfig(file, texts), "config")

  const { mergeRequest } = mr42
  const changes = mr42.files.map((f) => ({ path: f.path, oldPath: f.status === "added" ? null : f.path, status: f.status, diff: f.diff }))
  const classification = policy.classify(resolved, changes)
  check(classification.lane.name === mr42.lane.name, `lane ${classification.lane.name}`)
  const plan = policy.planFor(classification.lane)
  const slots: ReadonlyArray<{ id: string; role: string; gates: ReadonlyArray<{ name: string }> }> = policy.slotsOf(plan)
  check(slots.map((s) => s.id).join() === mr42.sessions.map((s) => s.id).join(), `sessions ${slots.map((s) => s.id).join()}`)

  const modelFinding = (f: mr42.RawFinding) => ({ gate: f.gate, severity: f.severity, location: { path: f.path, line: f.line }, title: f.title, body: f.body })
  const gates = mr42.sessions.filter((s) => s.role === "gate")
  const supervisor = mr42.sessions.find((s) => s.role === "supervisor")
  if (supervisor === undefined) throw new Error("mr42-data.ts has no supervisor session")
  const inputs = gates.flatMap((s) => policy.assignIds(s.id, s.findings.map(modelFinding)))
  const findings = succeed(
    policy.applySynthesis(inputs, { summary: mr42.summary, decisions: supervisor.decisions, added: supervisor.findings.map(modelFinding), limitations: [] }, supervisor.id),
    "supervisor decisions",
  )
  const outcome = { kind: "complete", summary: mr42.summary, findings, limitations: mr42.sessions.flatMap((s) => s.limitations) }
  const verdict = policy.verdictOf(outcome)
  check(verdict === mr42.verdict, `verdict ${verdict}`)

  const records = slots.map((slot) => {
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
  const review = {
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
      revision: { base: mergeRequest.base, start: mergeRequest.base, head: mergeRequest.head },
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
    note: report.renderReport(review) as string,
    findingIds: findings.map((f: { id: string }) => f.id) as ReadonlyArray<string>,
    configDigest: resolved.digest as string,
    labels: resolved.labels as Readonly<Record<"inProgress" | "pass" | "changesRequested" | "blocked", string | null>>,
    profiles: Object.fromEntries(
      [...new Set(slots.map((s: { profile?: unknown }) => s.profile))].map((p) => [(p as { name: string }).name, p]),
    ) as Readonly<Record<string, { name: string; harness: string; model: string; effort: string }>>,
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
