#!/usr/bin/env node
// Stands in for git in harness-aiSdk.test.ts: it writes its pid to `pid` beside it and then hangs.
import { writeFileSync } from "node:fs"
import { join } from "node:path"

writeFileSync(join(import.meta.dirname, "pid"), String(process.pid))
setTimeout(() => {}, 60_000)
