# Heron ast-grep rules

Used only by the `rule_scan` tool. Every result is a candidate the model must confirm by reading the code. Script rules exist once per
language (`javascript`, `typescript`, `tsx`, suffix `-js`, `-ts`, `-tsx`) because ast-grep applies a rule to one language only; inside a
`.vue` file the language of the `<script>` block picks which one runs.

| Rule | Reports |
|---|---|
| `v-html` | a `v-html` attribute in a template |
| `eval-*` | a call `eval(...)` |
| `new-function-*` | `new Function(...)`, code built from a string |
| `inner-html-*` | assigning a non-literal string to `.innerHTML` or `.outerHTML` (`=` and `+=`) |
| `document-write-*` | `document.write(...)` and `document.writeln(...)` |
| `insert-adjacent-html-*` | `x.insertAdjacentHTML(...)` |
| `prop-assign-*` | `props.x = ...`, `props.x += ...`, `props.x++`, `props.x--`: writing to a prop through a variable named `props` |
| `v-for-no-key` | a `v-for` element with no `:key` (or `v-bind:key`) |
| `v-if-with-v-for` | `v-if` and `v-for` on one element (Vue 3 evaluates `v-if` first, so it cannot see the loop variable) |
| `native-modifier` | the `.native` event modifier, removed in Vue 3 |
