// FICTIONAL. acme/storefront and its merge request !42 do not exist. This is an illustrative change and an
// illustrative Heron review of it, written for Heron OS. The session plan, finding ids, verdict and report follow
// Heron's real rules: the build (`vite.config.ts`) runs Heron's own `classify`, `planFor`, `applySynthesis`,
// `verdictOf` and `renderReport` over this data and fails if they disagree with it.
//
// `vite.config.ts` bundles this file into the build itself, so it imports only plain modules, never a virtual one.

import { type DiffFile, fileDiff, unifiedDiff } from "./unifiedDiff"

export type GateName = "design" | "correctness" | "security"
export type Severity = "blocker" | "advisory"

/** A finding as a session returns it. `excerpt` is the text on `line` the editor underlines; Heron has no such field. */
export type RawFinding = Readonly<{ gate: GateName; severity: Severity; path: string; line: number; excerpt: string; title: string; body: string }>

export type Decision = Readonly<{ id: string; keep: boolean; reason: string }>

/**
 * One model session of the plan. `startMs` counts from the first gate session. The example config gives the
 * `claude` harness a concurrency of 2, so the third gate waits for the first one to finish, and the supervisor
 * starts when every gate is done.
 */
export type RawSession = Readonly<{
  id: string
  role: "gate" | "supervisor"
  gates: ReadonlyArray<GateName>
  profile: "quick" | "deep"
  startMs: number
  durationMs: number
  inputTokens: number
  outputTokens: number
  toolCalls: number
  /** For a gate, what it returned; for the supervisor, the findings it added. */
  findings: ReadonlyArray<RawFinding>
  /** The supervisor's ruling on every gate finding; empty for a gate. */
  decisions: ReadonlyArray<Decision>
  limitations: ReadonlyArray<string>
}>

const projectListBefore = `<script setup lang="ts">
import { computed } from "vue"
import { useI18n } from "vue-i18n"
import ProjectRow from "./ProjectRow.vue"
import type { Project } from "./types"

const props = defineProps<{ projects: ReadonlyArray<Project>; filter: string }>()
const { t } = useI18n()

const rows = computed(() =>
  props.projects.filter((p) => p.name.toLowerCase().includes(props.filter.toLowerCase())),
)
</script>

<template>
  <ul class="projects">
    <li v-for="p in rows" :key="p.id">
      <ProjectRow :project="p" />
    </li>
  </ul>
  <p v-if="rows.length === 0" class="empty">{{ t("projects.empty") }}</p>
</template>
`

const projectListAfter = `<script setup lang="ts">
import { computed, ref } from "vue"
import { useI18n } from "vue-i18n"
import ProjectRow from "./ProjectRow.vue"
import { archiveSelected } from "./archive"
import type { Project } from "./types"

const props = defineProps<{ projects: ReadonlyArray<Project>; filter: string }>()
const { t } = useI18n()

const rows = computed(() =>
  props.projects.filter((p) => p.name.toLowerCase().includes(props.filter.toLowerCase())),
)

const selected = ref<any[]>([])

const archive = async () => {
  await archiveSelected(selected.value)
}
</script>

<template>
  <ul class="projects">
    <li v-for="p in rows" :key="p.id">
      <input v-model="selected" type="checkbox" :value="p.id" />
      <ProjectRow :project="p" />
    </li>
  </ul>
  <p v-if="rows.length === 0" class="empty">{{ t("projects.empty") }}</p>
  <button class="danger" :disabled="selected.length === 0" @click="archive">
    {{ t("projects.archiveSelected", { count: selected.length }) }}
  </button>
</template>
`

const archiveAfter = `import { api } from "../api/client"
import type { ProjectId } from "./types"

const MAX_BATCH = 20

/** Archives the selected projects. Archived projects stay restorable from Settings. */
export const archiveSelected = async (ids: ReadonlyArray<ProjectId>): Promise<void> => {
  if (ids.length > MAX_BATCH) {
    throw new RangeError(\`at most \${MAX_BATCH} projects per batch\`)
  }
  for (const id of ids) {
    await api.delete(\`/projects/\${id}\`)
  }
}
`

const localeBefore = `{
  "projects": {
    "empty": "No projects match this filter.",
    "title": "Projects"
  }
}
`

const localeAfter = `{
  "projects": {
    "archiveSelected": "Archive {count} projects",
    "empty": "No projects match this filter.",
    "title": "Projects"
  }
}
`

const changed: ReadonlyArray<DiffFile> = [
  { path: "src/locales/en.json", status: "modified", before: localeBefore, after: localeAfter },
  { path: "src/projects/ProjectList.vue", status: "modified", before: projectListBefore, after: projectListAfter },
  { path: "src/projects/archive.ts", status: "added", before: "", after: archiveAfter },
]

export const files = changed.map((file) => ({ ...file, diff: fileDiff(file.before, file.after) }))
export const diff = unifiedDiff(changed)

export const mergeRequest = {
  isFictional: true,
  project: "acme/storefront",
  iid: 42,
  title: "Archive several projects at once",
  description: "Adds a checkbox to each row of the project list and a button that archives the selected projects.",
  author: "frontend-dev",
  sourceBranch: "feature/bulk-archive",
  targetBranch: "main",
  webUrl: "https://gitlab.heron.local/acme/storefront/-/merge_requests/42",
  projectWebUrl: "https://gitlab.heron.local/acme/storefront",
  base: "d87f233693ad90db4bc27c2d96a372ba41f2d231",
  head: "9abe74a0d67dfd7a0c5e599d51a1edfd91c0e3e7",
  labels: ["frontend"],
  /** The id GitLab gives the report note when a run posts it. */
  noteId: 1742,
} as const

/** The lane the example config's rules pick for these paths: no rule matches, so the default lane applies. */
export const lane = { name: "standard", shape: "gated", gates: ["design", "correctness", "security"] } as const

export const sessions: ReadonlyArray<RawSession> = [
  {
    id: "gate.design",
    role: "gate",
    gates: ["design"],
    profile: "quick",
    startMs: 0,
    durationMs: 61_300,
    inputTokens: 18_420,
    outputTokens: 1_212,
    toolCalls: 9,
    findings: [
      {
        gate: "design",
        severity: "advisory",
        path: "src/projects/ProjectList.vue",
        line: 15,
        excerpt: "any[]",
        title: "The selection is typed as any[]",
        body: "archiveSelected takes ReadonlyArray<ProjectId>, but with ref<any[]> the compiler cannot catch a row object or a plain string slipping into selected. Type it as ref<Array<ProjectId>>([]).",
      },
      {
        gate: "design",
        severity: "advisory",
        path: "src/locales/en.json",
        line: 3,
        excerpt: "\"Archive {count} projects\"",
        title: "The button label has no singular form",
        body: "With one project selected the button reads \"Archive 1 projects\". Give the message a singular and a plural form, separated by a pipe, and pass the count to t() as the plural argument.",
      },
    ],
    decisions: [],
    limitations: [],
  },
  {
    id: "gate.correctness",
    role: "gate",
    gates: ["correctness"],
    profile: "quick",
    startMs: 0,
    durationMs: 88_700,
    inputTokens: 26_905,
    outputTokens: 1_804,
    toolCalls: 17,
    findings: [
      {
        gate: "correctness",
        severity: "blocker",
        path: "src/projects/archive.ts",
        line: 12,
        excerpt: "api.delete",
        title: "Archiving deletes the projects",
        body: "archiveSelected sends DELETE /projects/:id for every id, which removes the projects that the doc comment on line 6 and the button promise to archive. Call the archive endpoint instead, for example POST /projects/:id/archive, and pin the request in a test.",
      },
      {
        gate: "correctness",
        severity: "advisory",
        path: "src/projects/ProjectList.vue",
        line: 18,
        excerpt: "selected.value",
        title: "Archive acts on rows the filter hides",
        body: "selected keeps its ids when the filter changes, so a project that was checked and then filtered out is still archived, and the button count includes it. Archive only the ids that are in rows, or clear the selection when the filter changes.",
      },
    ],
    decisions: [],
    limitations: ["The server side of DELETE /projects/:id was not read. src/api/client.ts only forwards the path."],
  },
  {
    id: "gate.security",
    role: "gate",
    gates: ["security"],
    profile: "quick",
    startMs: 61_300,
    durationMs: 52_400,
    inputTokens: 15_733,
    outputTokens: 690,
    toolCalls: 7,
    findings: [
      {
        gate: "security",
        severity: "advisory",
        path: "src/projects/ProjectList.vue",
        line: 30,
        excerpt: "@click=\"archive\"",
        title: "A bulk destructive action runs without confirmation",
        body: "One click archives up to 20 projects. Ask for confirmation before the request is sent.",
      },
    ],
    decisions: [],
    limitations: [],
  },
  {
    id: "supervisor",
    role: "supervisor",
    gates: ["design", "correctness", "security"],
    profile: "deep",
    startMs: 113_700,
    durationMs: 71_900,
    inputTokens: 31_118,
    outputTokens: 2_356,
    toolCalls: 11,
    findings: [
      {
        gate: "correctness",
        severity: "advisory",
        path: "src/projects/archive.ts",
        line: 11,
        excerpt: "for (const id of ids)",
        title: "A failed request stops the batch halfway",
        body: "The first failed request throws out of the loop after earlier projects were already changed, and ProjectList.vue does not catch it, so the user sees nothing. Collect every result, for example with Promise.allSettled, and report which projects failed.",
      },
    ],
    decisions: [
      { id: "gate.design#1", keep: true, reason: "The type loses the ProjectId contract that archiveSelected states." },
      { id: "gate.design#2", keep: true, reason: "The label is visibly wrong for a single project." },
      { id: "gate.correctness#1", keep: true, reason: "Confirmed in archive.ts line 12: the request is a DELETE." },
      { id: "gate.correctness#2", keep: true, reason: "rows is filtered, selected is not." },
      {
        id: "gate.security#1",
        keep: false,
        reason: "A confirmation step is a product decision, not a security boundary; the server checks permissions per project.",
      },
    ],
    limitations: ["The change adds no test, so the request archiveSelected sends was checked by reading only."],
  },
]

export const summary =
  "Adds bulk archiving to the project list: a checkbox on each row, an Archive button and an archiveSelected helper. The helper deletes each project instead of archiving it, so the change cannot merge as it is."

/** What Heron's verdict rule gives for these findings: one blocker means CHANGES REQUESTED. The build checks it. */
export const verdict = "CHANGES REQUESTED" as const
