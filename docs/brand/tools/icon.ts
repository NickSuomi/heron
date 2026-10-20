// Writes the Vista app icon: mark.svg for large sizes and mark-small.svg for 32 and 48 px.
// Usage: node docs/brand/tools/icon.ts <output directory>
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { markSvg } from "./icon/mark-large.ts";
import { smallSvg } from "./icon/small.ts";

const out = process.argv[2];
if (!out) {
  console.error("usage: node icon.ts <output directory>");
  process.exit(1);
}
mkdirSync(out, { recursive: true });
writeFileSync(join(out, "mark.svg"), markSvg());
writeFileSync(join(out, "mark-small.svg"), smallSvg());
