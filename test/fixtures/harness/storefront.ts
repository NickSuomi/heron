import { join } from "node:path"

/**
 * A Vue and Effect project in `storefront/`, as a reviewed repository commits it: no installed dependencies, except
 * three plugins that would each append a line to `marker` if anything loaded them. Heron must load none of them.
 */
export const storefrontFiles = (marker: string): Readonly<Record<string, string>> => {
  const touch = (who: string) => `require("node:fs").appendFileSync(${JSON.stringify(marker)}, ${JSON.stringify(`${who}\n`)})\n`
  return {
    "storefront/package.json": JSON.stringify({ name: "acme-storefront", private: true, dependencies: { effect: "^4.0.0", vue: "^3.5.0" } }),
    "storefront/tsconfig.json": JSON.stringify({
      compilerOptions: {
        strict: true,
        module: "esnext",
        moduleResolution: "bundler",
        target: "es2022",
        noEmit: true,
        allowImportingTsExtensions: true,
        plugins: [{ name: "acme-tsserver-plugin" }, { name: "@effect/language-service" }]
      },
      vueCompilerOptions: { plugins: ["./acme-vue-plugin.cjs"] },
      include: ["src"]
    }),
    "storefront/acme-vue-plugin.cjs": `${touch("vueCompilerOptions plugin")}module.exports = () => ({})\n`,
    "storefront/node_modules/acme-tsserver-plugin/index.js": `${touch("tsconfig plugin")}module.exports = () => ({ create: (info) => info.languageService })\n`,
    "storefront/node_modules/@effect/language-service/index.js": `${touch("tree copy of the Effect plugin")}module.exports = () => ({ create: (info) => info.languageService })\n`,
    "storefront/src/cart.ts": [
      "export interface Item {",
      "  readonly sku: string",
      "  readonly price: number",
      "}",
      "",
      "export const totalOf = (items: ReadonlyArray<Item>) => items.reduce((sum, item) => sum + item.price, 0)",
      ""
    ].join("\n"),
    "storefront/src/CartSummary.vue": [
      "<script setup lang=\"ts\">",
      "import { computed } from \"vue\"",
      "import { totalOf, type Item } from \"./cart.ts\"",
      "",
      "const props = defineProps<{ items: ReadonlyArray<Item> }>()",
      "const total = computed(() => totalOf(props.items))",
      "const heading: number = \"Your cart\"",
      "</script>",
      "",
      "<template>",
      "  <h2>{{ heading }}</h2>",
      "  <p>{{ total }} for {{ props.items.length }} items</p>",
      "  <p>{{ discount }}</p>",
      "</template>",
      ""
    ].join("\n"),
    "storefront/src/checkout.ts": [
      "import { Effect } from \"effect\"",
      "",
      "export const checkout = Effect.gen(function*() {",
      "  const paid = yield* Effect.succeed(42)",
      "  Effect.log(\"receipt sent\")",
      "  return paid",
      "})",
      ""
    ].join("\n")
  }
}

export const markerPath = (root: string) => join(root, "loaded-plugins.txt")
