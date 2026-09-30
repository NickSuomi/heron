import { existsSync, readFileSync } from "node:fs"
import { afterAll, describe, expect, it } from "@effect/vitest"
import { Effect, Exit, Scope } from "effect"
import { runSourceTool, sourceTools, toolContext, type ToolContext } from "../src/harness/sourceTools.ts"
import { makeRepo } from "./fixtures/harness/repo.ts"
import { noDiscussions } from "./fixtures/harness/request.ts"
import { markerPath, storefrontFiles } from "./fixtures/harness/storefront.ts"

const repo = makeRepo((root) => storefrontFiles(markerPath(root)))
const scope = Effect.runSync(Scope.make())
const ctx: ToolContext = Effect.runSync(Scope.provide(toolContext(repo.source, noDiscussions), scope))
afterAll(() => {
  Effect.runSync(Scope.close(scope, Exit.void))
  repo.cleanup()
})

const json = (name: string, args: unknown) =>
  runSourceTool(sourceTools.find((t) => t.name === name)!, ctx, args).pipe(
    Effect.map((out) => (expect(out.ok ? "ok" : out.text).toBe("ok"), JSON.parse(out.text) as unknown))
  )

const vue = "storefront/src/CartSummary.vue"

describe("language server on a Vue and Effect project", () => {
  it.effect("answers definition, references, hover, symbols and diagnostics inside a .vue file, script and template", () =>
    Effect.gen(function*() {
      expect(yield* json("definition", { path: vue, line: 6, symbol: "totalOf" })).toEqual({
        locations: [{
          path: "storefront/src/cart.ts",
          line: 6,
          column: 14,
          text: "export const totalOf = (items: ReadonlyArray<Item>) => items.reduce((sum, item) => sum + item.price, 0)"
        }]
      })
      expect(yield* json("definition", { path: vue, line: 11, symbol: "heading" })).toEqual({
        locations: [{ path: vue, line: 7, column: 7, text: "const heading: number = \"Your cart\"" }]
      })
      expect(yield* json("definition", { path: vue, line: 2, symbol: "computed" })).toEqual({
        locations: [{
          path: "(Heron's package types) @vue/runtime-core/dist/runtime-core.d.ts",
          line: 6,
          column: 22,
          text: "export declare const computed: typeof computed$1;"
        }]
      })
      expect(yield* json("references", { path: vue, line: 6, symbol: "total" })).toEqual({
        total: 2,
        offset: 0,
        next: null,
        locations: [
          { path: vue, line: 6, column: 7, text: "const total = computed(() => totalOf(props.items))" },
          { path: vue, line: 12, column: 9, text: "<p>{{ total }} for {{ props.items.length }} items</p>" }
        ]
      })
      expect(yield* json("hover", { path: vue, line: 6, symbol: "total" })).toEqual({
        hover: "```typescript\nconst total: ComputedRef<number>\n```"
      })
      expect(yield* json("document_symbols", { path: vue })).toEqual({
        symbols: [
          { name: "heading", kind: "constant", line: 7, depth: 0 },
          { name: "props", kind: "constant", line: 5, depth: 0 },
          { name: "total", kind: "constant", line: 6, depth: 0 }
        ]
      })
      expect(yield* json("diagnostics", { path: vue })).toEqual({
        diagnostics: [
          { line: 7, column: 7, severity: "error", code: 2322, message: "Type 'string' is not assignable to type 'number'." },
          { line: 13, column: 9, severity: "error", code: 2339, message: expect.stringMatching(/^Property 'discount' does not exist on type /) }
        ]
      })
    }), { timeout: 60_000 })

  it.effect("reports the Effect language service's diagnostics and hovers in a .ts file that imports effect", () =>
    Effect.gen(function*() {
      expect(yield* json("diagnostics", { path: "storefront/src/checkout.ts" })).toEqual({
        diagnostics: [{
          line: 5,
          column: 3,
          severity: "error",
          code: 3,
          message: "This Effect value is neither yielded nor used in an assignment.    effect(floatingEffect)"
        }]
      })
      expect(yield* json("hover", { path: "storefront/src/checkout.ts", line: 4, symbol: "yield" })).toEqual({
        hover: "```ts\n/* Effect Type Parameters */\ntype Success = number\ntype Failure = never\ntype Requirements = never\n```"
      })
    }), { timeout: 60_000 })

  it.effect("loads no plugin from the reviewed tree: not the tsconfig's, not a tree copy of Heron's, not a Vue plugin", () =>
    Effect.gen(function*() {
      // Opening each file makes tsserver load the project and the Vue plugin read vueCompilerOptions.
      yield* json("diagnostics", { path: vue })
      yield* json("diagnostics", { path: "storefront/src/checkout.ts" })
      const marker = markerPath(repo.root)
      expect(existsSync(marker) ? readFileSync(marker, "utf8") : "nothing loaded").toBe("nothing loaded")
    }), { timeout: 60_000 })
})
