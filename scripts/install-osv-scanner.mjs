#!/usr/bin/env node
// Installs the pinned osv-scanner release and its npm vulnerability database into vendor/osv-scanner/. It runs at install time
// (the package's postinstall), never during a review: dependency_scan runs with --offline.
// Trust chain for the binary: the release's SHA256SUMS file must match SUMS_SHA256 below, and the binary must match its line in it.
// The database is a snapshot fetched by osv-scanner itself (--download-offline-databases); `pnpm refresh-osv-db` replaces it.
import { createHash } from "node:crypto"
import { execFileSync } from "node:child_process"
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const VERSION = "2.6.0"
/** sha256 of the v2.6.0 release's osv-scanner_SHA256SUMS, computed when this version was pinned (the release was published 2026-09-14). Bump it together with VERSION. */
const SUMS_SHA256 = "29f6fbc8bdd02d977df4b0987705d046233c36b70469a7021c623e8c155c9ddc"
const BASE = `https://github.com/google/osv-scanner/releases/download/v${VERSION}`
const ASSETS = {
  "linux-x64": "osv-scanner_linux_amd64",
  "linux-arm64": "osv-scanner_linux_arm64",
  "darwin-x64": "osv-scanner_darwin_amd64",
  "darwin-arm64": "osv-scanner_darwin_arm64"
}
/** The one database installed: npm, the ecosystem of the Vue projects Heron is built for. */
const DB_URL = "https://osv-vulnerabilities.storage.googleapis.com/npm/all.zip"

const root = new URL("..", import.meta.url).pathname
const dir = join(root, "vendor", "osv-scanner")
const binary = join(dir, "osv-scanner")
const stamp = join(dir, "VERSION")
const dbDir = join(dir, "db")
const dbStamp = join(dir, "db.json")

const refresh = process.argv.includes("--refresh-db")
const sha256 = (buf) => createHash("sha256").update(buf).digest("hex")
const get = async (url) => {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`)
  return Buffer.from(await res.arrayBuffer())
}
class Unverified extends Error {}

const installBinary = async () => {
  const asset = ASSETS[`${process.platform}-${process.arch}`]
  if (asset === undefined) throw new Error(`no osv-scanner build for ${process.platform}-${process.arch}`)
  if (existsSync(binary) && existsSync(stamp) && readFileSync(stamp, "utf8").trim() === VERSION) return console.log(`osv-scanner ${VERSION} already installed`)
  const sums = await get(`${BASE}/osv-scanner_SHA256SUMS`)
  if (sha256(sums) !== SUMS_SHA256) throw new Unverified("the release checksums file does not match the pinned digest")
  const line = sums.toString("utf8").split("\n").find((l) => l.trim().endsWith(`  ${asset}`))
  if (line === undefined) throw new Unverified(`${asset} is not in the checksums file`)
  const bytes = await get(`${BASE}/${asset}`)
  if (sha256(bytes) !== line.split(/\s+/)[0]) throw new Unverified(`${asset} does not match its published checksum`)
  mkdirSync(dir, { recursive: true })
  const part = `${binary}.part`
  writeFileSync(part, bytes)
  chmodSync(part, 0o755)
  renameSync(part, binary)
  writeFileSync(stamp, `${VERSION}\n`)
  console.log(`installed osv-scanner ${VERSION} (${asset}) at vendor/osv-scanner/osv-scanner`)
}

const installDatabase = async () => {
  if (!refresh && existsSync(dbStamp)) return console.log("osv-scanner database already installed; `pnpm refresh-osv-db` replaces it")
  const head = await fetch(DB_URL, { method: "HEAD" })
  if (!head.ok) throw new Error(`${DB_URL}: HTTP ${head.status}`)
  const modified = head.headers.get("last-modified")
  const work = mkdtempSync(join(tmpdir(), "heron-osv-"))
  try {
    // osv-scanner downloads the database itself, for the ecosystems of the lockfiles it finds; one npm lockfile selects npm.
    const fixture = join(work, "fixture")
    mkdirSync(fixture)
    writeFileSync(join(fixture, "package-lock.json"), JSON.stringify({ name: "fixture", lockfileVersion: 3, requires: true, packages: { "": { name: "fixture", version: "1.0.0" }, "node_modules/left-pad": { version: "1.3.0" } } }))
    const fresh = join(work, "db")
    mkdirSync(fresh)
    try {
      execFileSync(binary, ["scan", "source", "--offline", "--download-offline-databases", "--format", "json", "--lockfile", join(fixture, "package-lock.json")], {
        env: { PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: "/nonexistent", OSV_SCANNER_LOCAL_DB_CACHE_DIRECTORY: fresh },
        stdio: ["ignore", "ignore", "pipe"]
      })
    } catch (e) {
      // Exit 1 means the fixture matched an advisory; the database is downloaded either way.
      if (e.status !== 1) throw e
    }
    if (!existsSync(join(fresh, "osv-scalibr", "npm", "all.zip"))) throw new Error("osv-scanner did not download the npm database")
    rmSync(dbDir, { recursive: true, force: true })
    renameSync(fresh, dbDir)
    writeFileSync(dbStamp, `${JSON.stringify({ ecosystems: ["npm"], snapshot: modified === null ? null : new Date(modified).toISOString(), downloadedAt: new Date().toISOString() })}\n`)
  } finally {
    rmSync(work, { recursive: true, force: true })
  }
  console.log(`installed the osv npm database (snapshot ${modified}) at vendor/osv-scanner/db`)
}

try {
  await installBinary()
  await installDatabase()
} catch (e) {
  const message = e instanceof Error ? e.message : String(e)
  // A failed download must not break `pnpm install` for someone who never uses dependency_scan; a failed verification always does.
  if (process.env["npm_lifecycle_event"] === "postinstall" && !(e instanceof Unverified)) {
    console.warn(`osv-scanner not fully installed (${message}); dependency_scan will be unavailable. Run \`pnpm install-osv-scanner\` to retry.`)
  } else {
    console.error(`osv-scanner install failed: ${message}`)
    process.exit(1)
  }
}
