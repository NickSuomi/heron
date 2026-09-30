import { afterAll, describe, expect, it } from "@effect/vitest"
import { Effect, Exit, Scope } from "effect"
import { runSourceTool, sourceTools, toolContext, type ToolContext } from "../src/harness/sourceTools.ts"
import { makeRepo } from "./fixtures/harness/repo.ts"
import { noDiscussions } from "./fixtures/harness/request.ts"

const repo = makeRepo(() => ({
  // The tree's own ast-grep project: a rule of its own, and a custom language whose library ast-grep would try to load.
  "sgconfig.yml": "ruleDirs: [tree-rules]\ncustomLanguages:\n  evil:\n    libraryPath: /nonexistent/evil.so\n    extensions: [evil]\n",
  "tree-rules/x.yml": "id: tree-rule\nlanguage: typescript\nrule: { pattern: 'sub($$$)' }\nmessage: from the tree\n",
  "ui/Danger.vue": [
    "<script setup lang=\"ts\">",
    "const props = defineProps<{ count: number }>()",
    "props.count = 4",
    "props.count++",
    "const local = { count: 1 }",
    "local.count = 2",
    "console.log(props.count)",
    "document.body.innerHTML = userText",
    "</script>",
    "<template>",
    "  <div v-html=\"raw\"></div>",
    "  <li v-for=\"row in rows\">{{ row }}</li>",
    "  <li v-for=\"row in rows\" :key=\"row.id\" v-if=\"row.ok\">{{ row }}</li>",
    "  <my-button @click.native=\"go\"></my-button>",
    "</template>",
    ""
  ].join("\n"),
  "ui/Safe.vue": [
    "<script setup>",
    "const props = defineProps({ count: Number })",
    "const copy = props.count",
    "el.innerHTML = 'static'",
    "</script>",
    "<template>",
    "  <li v-for=\"row in rows\" :key=\"row.id\">{{ row }}</li>",
    "  <li v-for=\"row in rows\" v-bind:key=\"row.id\">{{ row }}</li>",
    "  <p v-if=\"ok\">text</p>",
    "  <my-button @click=\"go\"></my-button>",
    "</template>",
    ""
  ].join("\n"),
  "js/sinks.js": [
    "eval(code)",
    "const f = new Function('a', body)",
    "document.write(html)",
    "document.writeln(html)",
    "node.insertAdjacentHTML('beforeend', html)",
    "node.outerHTML = html",
    "node.innerHTML += html",
    "node.innerHTML = ''",
    "evaluate(code)",
    "const Fn = Function"
  ].join("\n") + "\n",
  "js/PlainVue.vue": "<script>\nexport default { mounted() { eval(this.code) } }\n</script>\n<template><p>x</p></template>\n",
  "ts/sinks.ts": "const props = { a: 1 }\nprops.a = 2\nnode.innerHTML = `<b>${name}</b>`\nfetch(url)\n",
  "ts/view.tsx": "export const V = () => { eval(x); return <p /> }\n"
}))
const scope = Effect.runSync(Scope.make())
const ctx: ToolContext = Effect.runSync(Scope.provide(toolContext(repo.source, noDiscussions), scope))
afterAll(() => {
  Effect.runSync(Scope.close(scope, Exit.void))
  repo.cleanup()
})

const tool = sourceTools.find((t) => t.name === "rule_scan")
const call = (args: unknown) => runSourceTool(tool!, ctx, args)
type Result = { total: number; offset: number; next: number | null; matches: Array<{ path: string; line: number; endLine: number; ruleId: string; severity: string; message: string; text: string }> }
const json = (args: unknown) =>
  call(args).pipe(Effect.map((out) => (expect(out.ok ? "ok" : out.text).toBe("ok"), JSON.parse(out.text) as Result)))
const hits = (r: Result) => r.matches.map((m) => `${m.path}:${m.line}:${m.ruleId}`)

describe("rule_scan", { timeout: 30_000 }, () => {
  it("is registered as a Heron tool", () => {
    expect(tool?.name).toBe("rule_scan")
    expect(tool?.description).toContain("candidate")
  })

  it.effect("finds each planted case in a Vue file, and nothing in the safe one", () =>
    Effect.gen(function*() {
      const vue = yield* json({ paths: ["ui"] })
      expect(hits(vue)).toEqual([
        "ui/Danger.vue:3:prop-assign-ts",
        "ui/Danger.vue:4:prop-assign-ts",
        "ui/Danger.vue:8:inner-html-ts",
        "ui/Danger.vue:11:v-html",
        "ui/Danger.vue:12:v-for-no-key",
        "ui/Danger.vue:13:v-if-with-v-for",
        "ui/Danger.vue:14:native-modifier"
      ])
      expect(vue.matches[3]).toMatchObject({ severity: "warning", text: "v-html=\"raw\"", endLine: 11 })
      expect(typeof vue.matches[3]!.message).toBe("string")
    }))

  it.effect("finds every script sink in JavaScript, TypeScript, TSX and a plain Vue script, skipping literals and lookalikes", () =>
    Effect.gen(function*() {
      const out = yield* json({ paths: ["js", "ts"] })
      expect(hits(out)).toEqual([
        "js/PlainVue.vue:2:eval-js",
        "js/sinks.js:1:eval-js",
        "js/sinks.js:2:new-function-js",
        "js/sinks.js:3:document-write-js",
        "js/sinks.js:4:document-write-js",
        "js/sinks.js:5:insert-adjacent-html-js",
        "js/sinks.js:6:inner-html-js",
        "js/sinks.js:7:inner-html-js",
        "ts/sinks.ts:2:prop-assign-ts",
        "ts/sinks.ts:3:inner-html-ts",
        "ts/view.tsx:1:eval-tsx"
      ])
    }))

  it.effect("ignores the tree's own sgconfig.yml, its rules and its custom language", () =>
    Effect.gen(function*() {
      const out = yield* json({})
      expect(out.matches.some((m) => m.ruleId === "tree-rule")).toBe(false)
      expect(out.total).toBeGreaterThan(0)
    }))

  it.effect("filters by rule id, limits to a path, and pages with total and next", () =>
    Effect.gen(function*() {
      expect(hits(yield* json({ rule: "^v-html$" }))).toEqual(["ui/Danger.vue:11:v-html"])
      expect(hits(yield* json({ paths: ["js/sinks.js"], rule: "^eval-" }))).toEqual(["js/sinks.js:1:eval-js"])
      const first = yield* json({ paths: ["js/sinks.js"], limit: 5 })
      expect([first.total, first.offset, first.next, first.matches.length]).toEqual([7, 0, 5, 5])
      const last = yield* json({ paths: ["js/sinks.js"], offset: first.next, limit: 5 })
      expect([last.total, last.offset, last.next, last.matches.length]).toEqual([7, 5, null, 2])
    }))

  it.effect("finds nothing on a tree without planted cases, and rejects bad paths", () =>
    Effect.gen(function*() {
      expect((yield* json({ ref: "base" })).total).toBe(0)
      expect((yield* call({ paths: ["../x"] })).ok).toBe(false)
      expect((yield* call({ paths: ["nope"] })).ok).toBe(false)
    }))
})
