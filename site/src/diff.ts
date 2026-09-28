type Line = readonly [kind: " " | "+" | "-", n: number | null, text: string, catchId?: string]

interface Finding {
  readonly id: string
  readonly severity: "Blocker" | "Advisory"
  readonly gate: string
  readonly title: string
  readonly at: string
  readonly by: string
}

interface Band {
  readonly no: string
  readonly gate: string
  readonly text: string
  readonly file: string
  readonly hunk: string
  readonly lines: ReadonlyArray<Line>
  readonly finding?: Finding
}

export const bands: ReadonlyArray<Band> = [
  {
    no: "01",
    gate: "ui",
    text: "A gate is one review concern, with instructions you write. One session per gate reads the diff and the source at the head, and returns its findings.",
    file: "src/projects/ProjectList.vue",
    hunk: "@@ -20,7 +20,14 @@",
    lines: [
      [" ", 20, `<ul class="projects">`],
      ["-", null, `  <li v-for="p in projects" :key="p.id">`],
      ["+", 21, `  <li v-for="p in rows" :key="p.id">`],
      ["+", 22, `    <input type="checkbox"`],
      ["+", 23, `      v-model="selected" :value="p.id" />`],
      [" ", 24, `    <ProjectRow :project="p" />`],
      [" ", 25, `  </li>`],
      [" ", 26, `</ul>`],
      ["+", 27, `<button class="danger" @click="archive">`, "F2"],
      ["+", 28, `  Archive {{ selected.length }}`],
      ["+", 29, `</button>`]
    ],
    finding: {
      id: "F2",
      severity: "Advisory",
      gate: "ui",
      title: "Archive button is enabled with nothing selected",
      at: "src/projects/ProjectList.vue:27",
      by: "b1.gate.ui, b2.gate.ui"
    }
  },
  {
    no: "02",
    gate: "design",
    text: "A line the gate has nothing to say about goes over the edge without a mark.",
    file: "src/projects/archive.ts",
    hunk: "@@ -0,0 +1,16 @@",
    lines: [
      ["+", 1, `import { api } from "../api"`],
      ["+", 2, `import type { ProjectId } from "./types"`],
      ["+", 3, ``],
      ["+", 4, `const MAX = 20`],
      ["+", 5, ``],
      ["+", 6, `export const archiveSelected = async (`],
      ["+", 7, `  ids: ReadonlyArray<ProjectId>`],
      ["+", 8, `) => {`],
      ["+", 9, `  if (ids.length > MAX) {`],
      ["+", 10, `    throw new RangeError("max 20")`],
      ["+", 11, `  }`]
    ]
  },
  {
    no: "03",
    gate: "spec",
    text: "A blocker is a finding that has to be fixed. One blocker from any gate is enough for CHANGES REQUESTED.",
    file: "src/projects/archive.ts",
    hunk: "@@ -0,0 +1,16 @@",
    lines: [
      ["+", 12, `  for (const id of ids) {`],
      ["+", 13, `    // archived projects stay restorable`],
      ["+", 14, "    await api.delete(`/projects/${id}`)", "F1"],
      ["+", 15, `  }`],
      ["+", 16, `}`]
    ],
    finding: {
      id: "F1",
      severity: "Blocker",
      gate: "spec",
      title: "Archive deletes the project instead of archiving it",
      at: "src/projects/archive.ts:14",
      by: "b1.gate.spec, b2.gate.spec"
    }
  },
  {
    no: "04",
    gate: "standards",
    text: "An advisory is pinned to its path and line at the reviewed head. On its own it does not change the verdict.",
    file: "src/projects/ProjectList.vue",
    hunk: "@@ -9,3 +9,6 @@",
    lines: [
      [" ", 9, `import { ref } from "vue"`],
      ["+", 10, `import { archiveSelected } from "./archive"`],
      [" ", 11, ``],
      ["+", 12, `const selected = ref<any[]>([])`, "F3"],
      ["+", 13, `const archive = () =>`],
      ["+", 14, `  archiveSelected(selected.value)`]
    ],
    finding: {
      id: "F3",
      severity: "Advisory",
      gate: "standards",
      title: "selected is typed any[]; use ProjectId[]",
      at: "src/projects/ProjectList.vue:12",
      by: "b1.gate.standards"
    }
  }
]

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")

const tokens = /(\/\/.*$)|("[^"]*"|`[^`]*`)|\b(import|from|type|const|export|async|await|for|of|if|throw|new)\b/g

const highlight = (raw: string): string => {
  let out = ""
  let last = 0
  for (const m of raw.matchAll(tokens)) {
    out += esc(raw.slice(last, m.index))
    const cls = m[1] ? "tc" : m[2] ? "ts" : "tk"
    out += `<span class="${cls}">${esc(m[0])}</span>`
    last = m.index + m[0].length
  }
  return out + esc(raw.slice(last))
}

const line = ([kind, n, text, catchId]: Line): string => {
  const cls = kind === "+" ? "add" : kind === "-" ? "del" : "ctx"
  const code = text === "" ? "&nbsp;" : highlight(text)
  const caught = catchId ? ` data-catch="${catchId}"` : ""
  const inner = catchId ? `<span class="hit">${code}<span class="strike" aria-hidden="true"></span></span>` : code
  return `<div class="l ${cls} s"${caught}><i>${n ?? ""}</i><b>${kind === " " ? "" : kind === "-" ? "&minus;" : "+"}</b><code>${inner}</code>${catchId ? `<em class="tag">${catchId}</em>` : ""}</div>`
}

const plate = (f: Finding): string => `
  <aside class="pin s" data-pin="${f.id}" id="${f.id}" aria-label="Finding ${f.id}">
    <span class="pin-dot" aria-hidden="true"></span>
    <span class="pin-id">${f.id}</span>
    <b class="sev${f.severity === "Blocker" ? " blk" : ""}">${f.severity}</b>
    <code class="pin-gate">${f.gate}</code>
    <span class="pin-title">${esc(f.title)}</span>
    <span class="pin-at">${f.at}</span>
    <span class="pin-by">raised by ${f.by}</span>
  </aside>`

export const renderBands = (): string =>
  bands.map((b) => `
  <section class="band" data-gate="${b.gate}" aria-label="Gate ${b.gate}">
    <div class="band-label s">
      <span class="band-no">${b.no}</span>
      <h2 class="band-name"><span class="band-kind">gate</span> ${b.gate}</h2>
    </div>
    <div class="band-body">
      <p class="band-text s">${b.text}</p>
      <div class="diff">
        <div class="file s"><span>${b.file}</span><span class="hunk">${b.hunk}</span></div>
        ${b.lines.map(line).join("")}
      </div>
      ${b.finding ? plate(b.finding) : ""}
    </div>
  </section>`).join("")

const sessions: ReadonlyArray<readonly [string, string, string, string]> = [
  ["b1.gate.ui", "gate", "claude-cli", "low"],
  ["b1.gate.design", "gate", "claude-cli", "low"],
  ["b1.gate.spec", "gate", "claude-cli", "low"],
  ["b1.gate.standards", "gate", "claude-cli", "low"],
  ["b1.supervisor", "supervisor", "claude-cli", "high"],
  ["b2.gate.ui", "gate", "ai-sdk", "medium"],
  ["b2.gate.design", "gate", "ai-sdk", "medium"],
  ["b2.gate.spec", "gate", "ai-sdk", "medium"],
  ["b2.gate.standards", "gate", "ai-sdk", "medium"],
  ["b2.supervisor", "supervisor", "ai-sdk", "medium"],
  ["judge", "judge", "claude-cli", "high"]
]

export const renderProvenance = (): string =>
  sessions.map(([id, role, backend, effort]) => `<tr><td>${id}</td><td>${role}</td><td>${backend}</td><td>${effort}</td><td>ok</td></tr>`).join("")
