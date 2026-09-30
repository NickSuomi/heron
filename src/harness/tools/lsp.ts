import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process"
import { readdirSync, readFileSync, realpathSync } from "node:fs"
import { createRequire } from "node:module"
import { basename, dirname, relative, sep } from "node:path"
import { pathToFileURL, fileURLToPath } from "node:url"
import type { TreeRef } from "../../ports.ts"
import { fail, toolEnv } from "./process.ts"

const require = createRequire(import.meta.url)
/**
 * typescript-language-server 6.0.0, TypeScript 5.9.3, the Effect language service and the Vue TypeScript plugin, all
 * pinned Heron dependencies; nothing from the reviewed repo. The server runs Heron's own tsserver entry,
 * `tsserver/lib/tsserver.js`, three levels above both `src/harness/tools` and `dist/harness/tools`.
 */
const SERVER = require.resolve("typescript-language-server/lib/cli.mjs")
const TSSERVER = fileURLToPath(new URL("../../../tsserver/lib/tsserver.js", import.meta.url))
const TS_LIB = require.resolve("typescript-5/lib/tsserver.js").slice(0, -"tsserver.js".length)
/** Heron's tsserver loads these by its own fixed paths, so `location` names no directory it searches. */
const PLUGINS = [
  { name: "@effect/language-service", location: dirname(TSSERVER), languages: [] },
  { name: "@vue/typescript-plugin", location: dirname(TSSERVER), languages: ["vue"] }
]
/** Where Heron's own packages live, including the vue and effect declarations its tsserver supplies. */
const OWN_MODULES = fileURLToPath(new URL("../../../node_modules/", import.meta.url))

type Json = { readonly [key: string]: unknown }
const isRecord = (u: unknown): u is Json => typeof u === "object" && u !== null && !Array.isArray(u)

const LANGUAGES: Readonly<Record<string, string>> = {
  ".ts": "typescript", ".mts": "typescript", ".cts": "typescript", ".tsx": "typescriptreact",
  ".js": "javascript", ".mjs": "javascript", ".cjs": "javascript", ".jsx": "javascriptreact", ".vue": "vue"
}
export const languageOf = (path: string): string | null => {
  const dot = path.lastIndexOf(".")
  return dot < 0 ? null : LANGUAGES[path.slice(dot)] ?? null
}

/** How long a diagnostics call waits for the server to publish, and how long it then waits for a later, fuller publish. */
const DIAGNOSTICS_FIRST_MS = 120_000
const DIAGNOSTICS_SETTLE_MS = 750

/** Every process whose parent chain leads to `root`, read from /proc; empty where /proc does not exist. */
const descendants = (root: number): Array<number> => {
  let entries: Array<string>
  try {
    entries = readdirSync("/proc").filter((e) => /^\d+$/.test(e))
  } catch {
    return []
  }
  const children = new Map<number, Array<number>>()
  for (const entry of entries) {
    try {
      const stat = readFileSync(`/proc/${entry}/stat`, "utf8")
      const ppid = Number(stat.slice(stat.lastIndexOf(")") + 2).split(" ")[1])
      children.set(ppid, [...(children.get(ppid) ?? []), Number(entry)])
    } catch {
      // The process exited while we listed it.
    }
  }
  const out: Array<number> = []
  const walk = (pid: number) => {
    for (const child of children.get(pid) ?? []) {
      out.push(child)
      walk(child)
    }
  }
  walk(root)
  return out
}

/**
 * One typescript-language-server over stdio, rooted at one read-only tree. It reads the tree and Heron's own TypeScript,
 * never code from the reviewed repository: `tsserver.path` wins over a workspace TypeScript, automatic type acquisition
 * (which runs npm) is off, and Heron's tsserver loads only its two pinned plugins, never one the tsconfig names or one
 * from a `node_modules` directory, and drops `vueCompilerOptions.plugins`. Imports of vue and effect that the tree cannot
 * resolve read Heron's own declarations of those packages.
 */
export class LspClient {
  private readonly child: ChildProcessWithoutNullStreams
  private buffer = Buffer.alloc(0)
  private seq = 0
  private readonly pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>()
  private readonly diagnostics = new Map<string, ReadonlyArray<unknown>>()
  private readonly published = new Map<string, Array<() => void>>()
  private readonly opened = new Set<string>()
  private exited = false
  readonly ready: Promise<void>
  readonly root: string

  constructor(root: string) {
    this.root = root
    // Not detached: when a vendor CLI's process group is killed, this server and its tsserver die with it.
    this.child = spawn(process.execPath, [SERVER, "--stdio"], {
      cwd: root,
      // typescript-language-server passes its environment on to tsserver, which reads nothing outside this tree.
      env: { ...toolEnv(), HERON_TSSERVER_ROOT: root },
      stdio: ["pipe", "pipe", "pipe"]
    })
    this.child.stderr.resume()
    this.child.stdin.on("error", () => {})
    this.child.stdout.on("data", (chunk: Buffer) => this.receive(chunk))
    this.child.on("exit", () => {
      this.exited = true
      for (const { reject } of this.pending.values()) reject(fail("the TypeScript language server exited"))
      this.pending.clear()
    })
    this.child.on("error", () => {
      this.exited = true
    })
    const rootUri = pathToFileURL(root).href
    this.ready = this.request("initialize", {
      // The server exits on its own if this process dies without closing it.
      processId: process.pid,
      rootUri,
      workspaceFolders: [{ uri: rootUri, name: basename(root) }],
      capabilities: {
        textDocument: {
          hover: { contentFormat: ["plaintext", "markdown"] },
          documentSymbol: { hierarchicalDocumentSymbolSupport: true },
          publishDiagnostics: {},
          definition: {},
          references: {}
        },
        workspace: { symbol: {}, workspaceFolders: true }
      },
      initializationOptions: {
        // One semantic tsserver: a syntax-only server would answer early requests before the project loads, and a
        // definition would stop at the import instead of the declaration.
        tsserver: { path: TSSERVER, useSyntaxServer: "never" },
        disableAutomaticTypingAcquisition: true,
        plugins: PLUGINS,
        preferences: {}
      }
    }).then(() => this.notify("initialized", {}))
  }

  get pids(): ReadonlyArray<number> {
    const pid = this.child.pid
    return pid === undefined ? [] : [pid, ...descendants(pid)]
  }

  private receive(chunk: Buffer) {
    this.buffer = Buffer.concat([this.buffer, chunk])
    for (;;) {
      const headerEnd = this.buffer.indexOf("\r\n\r\n")
      if (headerEnd < 0) return
      const length = Number(/Content-Length: (\d+)/i.exec(this.buffer.subarray(0, headerEnd).toString("ascii"))?.[1] ?? "0")
      if (this.buffer.length < headerEnd + 4 + length) return
      const body = this.buffer.subarray(headerEnd + 4, headerEnd + 4 + length).toString("utf8")
      this.buffer = this.buffer.subarray(headerEnd + 4 + length)
      let message: unknown
      try {
        message = JSON.parse(body)
      } catch {
        continue
      }
      if (isRecord(message)) this.handle(message)
    }
  }

  private handle(message: Json) {
    const id = message["id"]
    const method = message["method"]
    if (typeof method === "string" && id !== undefined) {
      // A request from the server (configuration, progress, capability registration): answer with nothing.
      this.send({ jsonrpc: "2.0", id, result: method === "workspace/configuration" ? [] : null })
      return
    }
    if (typeof id === "number") {
      const waiter = this.pending.get(id)
      if (waiter === undefined) return
      this.pending.delete(id)
      if (isRecord(message["error"])) waiter.reject(fail(`language server: ${String(message["error"]["message"])}`))
      else waiter.resolve(message["result"])
      return
    }
    if (method === "textDocument/publishDiagnostics" && isRecord(message["params"])) {
      const uri = String(message["params"]["uri"])
      this.diagnostics.set(uri, Array.isArray(message["params"]["diagnostics"]) ? message["params"]["diagnostics"] : [])
      for (const wake of this.published.get(uri) ?? []) wake()
      this.published.delete(uri)
    }
  }

  private send(message: Json) {
    const body = Buffer.from(JSON.stringify(message), "utf8")
    this.child.stdin.write(`Content-Length: ${body.length}\r\n\r\n`)
    this.child.stdin.write(body)
  }

  request(method: string, params: unknown): Promise<unknown> {
    if (this.exited) return Promise.reject(fail("the TypeScript language server exited"))
    const id = ++this.seq
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.send({ jsonrpc: "2.0", id, method, params })
    })
  }

  notify(method: string, params: unknown) {
    if (!this.exited) this.send({ jsonrpc: "2.0", method, params })
  }

  uriOf(path: string): string {
    return pathToFileURL(`${this.root}/${path}`).href
  }

  /** Opens a repository file once, so the server knows its text and project. */
  async open(path: string): Promise<string> {
    await this.ready
    const uri = this.uriOf(path)
    if (this.opened.has(uri)) return uri
    const languageId = languageOf(path)
    if (languageId === null) throw fail(`not a TypeScript, JavaScript or Vue file: ${path}`)
    let text: string
    try {
      text = readFileSync(`${this.root}/${path}`, "utf8")
    } catch {
      throw fail(`no such file in this tree: ${path}`)
    }
    this.opened.add(uri)
    this.notify("textDocument/didOpen", { textDocument: { uri, languageId, version: 1, text } })
    return uri
  }

  get openCount(): number {
    return this.opened.size
  }

  /** The diagnostics the server publishes for an opened file; waits for the first publish, then for it to settle. */
  async diagnosticsOf(uri: string): Promise<ReadonlyArray<unknown>> {
    const wait = (ms: number) =>
      new Promise<boolean>((resolve) => {
        const timer = setTimeout(() => resolve(false), ms)
        this.published.set(uri, [...(this.published.get(uri) ?? []), () => (clearTimeout(timer), resolve(true))])
      })
    if (!this.diagnostics.has(uri) && !(await wait(DIAGNOSTICS_FIRST_MS))) {
      throw fail(`the language server published no diagnostics within ${DIAGNOSTICS_FIRST_MS / 1000}s`)
    }
    while (await wait(DIAGNOSTICS_SETTLE_MS));
    return this.diagnostics.get(uri) ?? []
  }

  /** Kills the server and every process it started (tsserver instances). */
  close() {
    const pids = this.pids
    for (const pid of pids.toReversed()) {
      try {
        process.kill(pid, "SIGKILL")
      } catch {
        // Already gone.
      }
    }
    this.exited = true
  }
}

/** Where a location points, as the model should read it: a repository path, a TypeScript library file, a package declaration Heron supplied, or none. */
export const displayPath = (root: string, uri: string): string => {
  let file: string
  try {
    file = fileURLToPath(uri)
  } catch {
    return uri
  }
  const inside = relative(root, file)
  if (!inside.startsWith("..") && !inside.startsWith(sep)) return inside.split(sep).join("/")
  if (file.startsWith(TS_LIB)) return `(TypeScript library) ${file.slice(TS_LIB.length)}`
  if (file.startsWith(OWN_MODULES)) return `(Heron's package types) ${file.slice(file.lastIndexOf("/node_modules/") + "/node_modules/".length)}`
  return `(outside the tree) ${basename(file)}`
}

/**
 * Whether the tools may read the file a location points at: its real path, symbolic links resolved, lies in the tree
 * or in Heron's own packages. Heron's tsserver already refuses everything else; this keeps the tools from reading a
 * location's text even if a server ever returned one outside.
 */
export const isReadable = (root: string, uri: string): boolean => {
  try {
    const real = realpathSync(fileURLToPath(uri))
    return [root, OWN_MODULES].map((dir) => realpathSync(dir)).some((dir) => real === dir || real.startsWith(dir + sep))
  } catch {
    return false
  }
}

/** One language server per tree, started on first use and killed when the pool closes. */
export class LspPool {
  private readonly clients = new Map<TreeRef, LspClient>()
  private closed = false
  private readonly trees: Readonly<Record<TreeRef, string>>

  constructor(trees: Readonly<Record<TreeRef, string>>) {
    this.trees = trees
  }

  get(ref: TreeRef): LspClient {
    if (this.closed) throw fail("the review session has ended")
    const existing = this.clients.get(ref)
    if (existing !== undefined) return existing
    const client = new LspClient(this.trees[ref])
    this.clients.set(ref, client)
    return client
  }

  /** Every server process and its descendants, for tests that prove none outlives the pool. */
  get pids(): ReadonlyArray<number> {
    return [...this.clients.values()].flatMap((c) => c.pids)
  }

  close() {
    this.closed = true
    for (const client of this.clients.values()) client.close()
    this.clients.clear()
  }
}
