import { readFileSync, writeFileSync } from "node:fs"

import { names, parse, withNames } from "./woff2.ts"

// Renames the shipped Selawik subsets to "Heron Sans" in their name tables. SIL OFL 1.1 condition 3 forbids
// a Modified Version (a subset is one) from using the Reserved Font Name "Selawik". The copyright record
// (id 0) keeps its wording, as condition 1 requires; the trademark record (id 7) is dropped.
// Usage, from site/: node build/rename-font.ts public/fonts/heron-sans-regular.woff2 ...
const family = "Heron Sans"

for (const path of process.argv.slice(2)) {
  const font = parse(readFileSync(path))
  const renamed = names(font)
    .filter((record) => record.id !== 7)
    .map((record) => ({
      ...record,
      value: record.id === 0 ? record.value : record.value.replace(/Selawik-/g, "HeronSans-").replace(/Selawik/g, family),
    }))
  writeFileSync(path, withNames(font, renamed))
}
