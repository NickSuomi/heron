#!/usr/bin/env node
// Installs the pinned gitleaks release into vendor/gitleaks/. It runs at install time (the package's postinstall), never during a review.
// Trust chain: the checksums file of the release must match CHECKSUMS_SHA256 below, and the archive must match its line in that file.
import { createHash } from "node:crypto"
import { execFileSync } from "node:child_process"
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const VERSION = "8.30.1"
/** sha256 of the v8.30.1 release's gitleaks_8.30.1_checksums.txt, computed when this version was pinned (the release was published 2026-03-21). Bump it together with VERSION. */
const CHECKSUMS_SHA256 = "061476c21adaf5441516f96f185c1a4706a83cd6329b9b38762271b3d4a52fae"
const BASE = `https://github.com/gitleaks/gitleaks/releases/download/v${VERSION}`
const ASSETS = {
  "linux-x64": "linux_x64",
  "linux-arm64": "linux_arm64",
  "darwin-x64": "darwin_x64",
  "darwin-arm64": "darwin_arm64"
}

const root = new URL("..", import.meta.url).pathname
const dir = join(root, "vendor", "gitleaks")
const binary = join(dir, "gitleaks")
const stamp = join(dir, "VERSION")

const sha256 = (buf) => createHash("sha256").update(buf).digest("hex")
const get = async (url) => {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`)
  return Buffer.from(await res.arrayBuffer())
}
class Unverified extends Error {}

const install = async () => {
  const platform = ASSETS[`${process.platform}-${process.arch}`]
  if (platform === undefined) throw new Error(`no gitleaks build for ${process.platform}-${process.arch}; put gitleaks ${VERSION} on PATH instead`)
  if (existsSync(binary) && existsSync(stamp) && readFileSync(stamp, "utf8").trim() === VERSION) return console.log(`gitleaks ${VERSION} already installed`)
  const name = `gitleaks_${VERSION}_${platform}.tar.gz`
  const sums = await get(`${BASE}/gitleaks_${VERSION}_checksums.txt`)
  if (sha256(sums) !== CHECKSUMS_SHA256) throw new Unverified("the release checksums file does not match the pinned digest")
  const line = sums.toString("utf8").split("\n").find((l) => l.trim().endsWith(`  ${name}`))
  if (line === undefined) throw new Unverified(`${name} is not in the checksums file`)
  const archive = await get(`${BASE}/${name}`)
  if (sha256(archive) !== line.split(/\s+/)[0]) throw new Unverified(`${name} does not match its published checksum`)
  const work = mkdtempSync(join(tmpdir(), "heron-gitleaks-"))
  try {
    writeFileSync(join(work, name), archive)
    execFileSync("tar", ["-xzf", name, "gitleaks"], { cwd: work })
    mkdirSync(dir, { recursive: true })
    renameSync(join(work, "gitleaks"), binary)
    chmodSync(binary, 0o755)
    writeFileSync(stamp, `${VERSION}\n`)
  } finally {
    rmSync(work, { recursive: true, force: true })
  }
  console.log(`installed gitleaks ${VERSION} (${platform}) at vendor/gitleaks/gitleaks`)
}

try {
  await install()
} catch (e) {
  const message = e instanceof Error ? e.message : String(e)
  // A failed download must not break `pnpm install` for someone who never uses secret_scan; a failed verification always does.
  if (process.env["npm_lifecycle_event"] === "postinstall" && !(e instanceof Unverified)) {
    console.warn(`gitleaks not installed (${message}); secret_scan will be unavailable. Run \`pnpm install-gitleaks\` to retry.`)
  } else {
    console.error(`gitleaks install failed: ${message}`)
    process.exit(1)
  }
}
