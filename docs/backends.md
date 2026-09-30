# Backends

A backend runs one review session: it gives a model the instructions, the merge request diff, and read-only access to the source at the reviewed head, and returns the model's structured answer. Heron has three backends. Each one is a `kind` under `harnesses` in the [config](configuration.md#backend-and-harnesses).

| `kind` | What runs | Credential | Use it for |
| --- | --- | --- | --- |
| `ai-sdk` | The [Vercel AI SDK](https://ai-sdk.dev) inside the Heron process, calling [OpenRouter](https://openrouter.ai) | `OPENROUTER_API_KEY` | Shared runners, public projects, and any setup where several people rely on the bot. |
| `claude-cli` | Your own installed [Claude Code](https://code.claude.com/docs) CLI | `CLAUDE_CODE_OAUTH_TOKEN` or `ANTHROPIC_API_KEY` | A setup where you, the operator, run Claude Code under your own account and its terms. |
| `codex-cli` | Your own installed [Codex](https://developers.openai.com/codex) CLI | A persistent `CODEX_HOME`, optionally `CODEX_API_KEY` | Private repositories on trusted runners only. |

For shared or public use, choose `ai-sdk` with an API key. The two CLI backends run a vendor tool under an account that belongs to you, and the vendors restrict how that account may be used by others. The next section quotes those restrictions.

## Vendor terms

Heron does not log in to any vendor, and it does not offer a login to anyone. Each CLI backend starts a vendor CLI that you installed and authenticated. You are responsible for following the terms of your own plan or API agreement.

### Claude Code (`claude-cli`)

Anthropic's [Agent SDK overview](https://code.claude.com/docs/en/agent-sdk/overview) says:

> Unless previously approved, Anthropic does not allow third party developers to offer claude.ai login or rate limits for their products, including agents built on the Claude Agent SDK.

Heron does not use the Agent SDK and does not offer claude.ai login. It runs the `claude` binary with the credential you provide. To create a long-lived token for a headless runner, run `claude setup-token` and store the result as `CLAUDE_CODE_OAUTH_TOKEN`. To bill an API account instead, set `ANTHROPIC_API_KEY`. Whether your plan allows automated use on a CI runner, and whether other people may trigger reviews that spend your plan's limits, is set by your agreement with Anthropic, not by Heron.

With `CLAUDE_CODE_OAUTH_TOKEN`, Heron also reads your subscription's five-hour and weekly usage windows just before and just after a review, and the report shows the difference next to the dollar cost. It reads them from `https://api.anthropic.com/api/oauth/usage` with the same token. That is the endpoint Claude Code's own `/usage` uses, and Anthropic does not document it. The figure is an estimate: Claude reports whole percent, and every other session on the account counts toward the same windows. A failed reading shows as "unknown" with the reason, for example the HTTP status and Anthropic's error message, and never fails the review. In CI the endpoint has answered `HTTP 429: Rate limited` to a `claude setup-token` token, so expect "unknown" there; a machine with an interactive `claude` login reads it. When Claude Code warns during a session that a limit is close or reached, the report repeats the warning. With `ANTHROPIC_API_KEY`, Heron reads nothing, because an API account has no usage windows.

### Codex (`codex-cli`)

OpenAI's guide [Maintain Codex account auth in CI/CD](https://developers.openai.com/codex/auth/ci-cd-auth.md) covers ChatGPT-managed Codex auth on a runner. It says API keys are the recommended option for most CI/CD jobs, and it says:

> Do not use this workflow for public or open-source repositories.

The same guide requires a trusted private runner, an `auth.json` that persists between runs, and only one machine or serialized job stream per copy of `auth.json`. Codex refreshes the tokens in that file and writes them back.

For Heron this means:

- Use `codex-cli` for private repositories on trusted runners only.
- Point `CODEX_HOME` at a directory that survives between jobs and that only one job writes at a time.
- Set the harness `concurrency` to 1 unless you have checked that Codex tolerates parallel sessions sharing one `CODEX_HOME`. Heron does not check this.

The harness also passes `CODEX_API_KEY` to Codex when it is set.

## What each backend runs

Every session reads the whole repository at three commits:

- `source`: the merge request head.
- `target`: the target branch tip that GitLab computed the diff against.
- `base`: the merge base of the two.

Heron fetches the three commits with their full history into a temporary bare repository and writes one read-only working tree per commit. The judge in a `dual` lane reads them too.

Every session runs with the profile's `model` and `effort`. It has no turn limit and no time limit unless you set `limits.maxTurns` or `limits.sessionTimeoutSeconds`. The model must answer with JSON that matches a schema Heron supplies. If a session fails, hits a limit you set, calls a tool it is not allowed to call, or returns JSON that does not match, the review ends with the verdict BLOCKED.

### Source tools

All three backends get the same Heron tools. The CLI backends reach them through `heron mcp-source`, a stdio MCP server (Model Context Protocol, the standard the vendor CLIs use to talk to tool servers). The `ai-sdk` backend calls the same code in-process. Every tool takes `ref` (`source`, `target` or `base`; the default is `source`).

| Tool | What it does | Runs |
| --- | --- | --- |
| `grep` | Text or regular-expression search of one commit | `git grep` |
| `list_files` | Files of one commit, by directory prefix and glob | `git ls-tree` |
| `read_file` | A whole file, or a line range | `git cat-file` |
| `rg` | Search of one working tree with regex or literal, case modes, word and multiline matching, include and exclude globs, file types, and context | ripgrep |
| `ast_grep` | Structural search by syntax pattern, with an optional language | ast-grep |
| `secret_scan` | Candidate leaked credentials in one working tree: path, lines, rule id, description and the redacted match, never the secret. The model must read and cite the line before it reports one | gitleaks |
| `git_log`, `git_show`, `git_blame`, `git_diff` | History, one commit, line authorship, and the diff between any two of `base`, `source` and `target` | git |
| `definition`, `references`, `hover`, `document_symbols`, `workspace_symbols`, `diagnostics` | TypeScript, JavaScript and Vue lookups on one working tree, with Effect language service diagnostics and hovers | typescript-language-server |

Results are never cut short without notice. `read_file` returns the whole file by default. A tool that can return many results pages them: each answer gives `total` and `next`, the offset of the next page.

`secret_scan` runs `gitleaks dir` with Heron's own config, which holds only gitleaks' built-in rules, so a `.gitleaks.toml` in the reviewed tree changes nothing. It points `-i` at an empty directory, passes `--ignore-gitleaks-allow` so a `gitleaks:allow` comment hides nothing, and copies the files of a directory that holds a `.gitleaksignore` aside without it, because gitleaks reads that file from the root of the scanned path whatever `-i` says. It passes `--redact`, `--max-decode-depth 0` and `--max-archive-depth 0` (gitleaks decodes to depth 5 by default) and sets no file-size limit. A result is a candidate: gitleaks flags placeholders and test values too. Each gitleaks start takes about 0.6 seconds, plus the scan.

gitleaks has no official npm package, so `pnpm install` runs `scripts/install-gitleaks.mjs` (also `pnpm install-gitleaks`). It downloads the release asset for your platform (Linux or macOS, x64 or arm64) from the gitleaks v8.30.1 release, checks the release's checksums file against a digest pinned in the script, checks the archive against that file, and unpacks it to `vendor/gitleaks/`. A failed check fails the install; an unreachable download only prints a warning, and `secret_scan` then falls back to a `gitleaks` on `PATH` or reports that it is not available. Nothing is downloaded during a review. To upgrade, change `VERSION` and `CHECKSUMS_SHA256` together.

The language server runs Heron's own TypeScript through Heron's tsserver entry, [`tsserver/lib/tsserver.js`](../tsserver/lib/tsserver.js), which loads two tsserver plugins:

- The Vue TypeScript plugin makes the same six tools work in `.vue` files, in `<script setup lang="ts">` and in template expressions: a template variable resolves to its declaration in the script, and its references include the template. `document_symbols` lists the script's declarations with their `.vue` lines. `diagnostics` includes template type errors.
- The Effect language service adds its diagnostics, for example an Effect that is created and never yielded, and its hovers, for example the success, failure and requirement types at a `yield*`.

Heron never installs the reviewed repository's dependencies, so a type that comes from a package in `node_modules` shows as `any` or is missing. Without `vue` and `effect` types the two plugins have nothing to check, so Heron supplies those two packages: an import of `vue` or `effect` that the tree cannot resolve reads Heron's own declarations, when the nearest `package.json` declares Vue 3 (Heron's `vue` 3.5.43), Effect 3 (`effect` 3.22.2) or Effect 4 (Heron's own `effect` 4.0.0-rc.115). A location in them shows as `(Heron's package types)` and the package path. A version range with no major number, such as `workspace:*` or `catalog:`, gets no supplied types. Types declared in the repository are exact. A file outside the tree that the tsconfig names, by an absolute path, `extends`, `typeRoots`, `paths`, `references` or a symbolic link, is treated as missing; see [Security](security.md#read-only-source-tools). Heron starts one server per tree on first use and kills it, and every tsserver it started, when the session ends.

These tools are pinned dependencies of Heron:

| Package | Version | Licence | Provides |
| --- | --- | --- | --- |
| `@vscode/ripgrep` | 1.18.0 (ripgrep 15.0.0) | MIT; ripgrep is MIT or Unlicense | `rg`, from a per-platform optional package with no install script |
| `@ast-grep/cli` | 0.45.3 | MIT | `ast-grep`, called as the native binary; its install script stays off |
| gitleaks (not an npm package) | 8.30.1 | MIT | `gitleaks`, downloaded by `pnpm install` (see below) |
| `typescript-language-server` | 6.0.0 | Apache-2.0 | the language server |
| `typescript-5` (npm alias of `typescript`) | 5.9.3 | Apache-2.0 | the tsserver it runs; TypeScript 7 ships no `tsserver.js` |
| `@vue/typescript-plugin` | 3.3.11 | MIT | the tsserver plugin for `.vue` files, from Vue language tools |
| `@effect/language-service` | 0.87.2 | MIT | the Effect tsserver plugin |
| `vue` | 3.5.43 | MIT | declarations for projects that declare Vue 3; tsserver only reads them |
| `effect-3` (npm alias of `effect`) | 3.22.2 | MIT | declarations for projects that declare Effect 3; tsserver only reads them |

All of them were published more than seven days before they were pinned, as `minimumReleaseAge` in `pnpm-workspace.yaml` requires. typescript-language-server 6.0.1 was five days old, so Heron pins 6.0.0. @effect/language-service 0.87.3 was one day old, so Heron pins 0.87.2.

### `claude-cli`

Heron starts the `claude` binary (or the harness `command`) in an empty temporary directory:

```text
claude -p --output-format stream-json --verbose --json-schema <schema>
  --model <model> --effort <effort> --system-prompt-file <file>
  --tools Read,Grep,Glob --restricted
  --add-dir <source tree> <target tree> <base tree>
  --strict-mcp-config --mcp-config <file>
  --allowedTools mcp__heron "Read(//<source tree>/**)" "Read(//<target tree>/**)" "Read(//<base tree>/**)"
  --disallowedTools Bash Edit Write NotebookEdit WebFetch WebSearch Task Agent
    "Read(//proc/**)" "Read(//sys/**)" "Read(//<session home>/**)"
  --permission-mode dontAsk --permission-prompts none --setting-sources ""
  --no-session-persistence [--max-turns <n>]
```

The model has Claude Code's own read-only file tools, `Read`, `Grep` and `Glob`, next to the Heron tools. `Glob` is the file-listing tool: Claude Code 2.1.281 has no separate `LS` tool. The system prompt names the absolute path of each tree.

- The three trees are working directories (`--add-dir`), and the `Read(//...)` allow rules name them again. `//` starts an absolute path in Claude Code's [permission rules](https://code.claude.com/docs/en/permissions), and `Read` rules also apply to `Grep` and `Glob`.
- `dontAsk` denies every call that no rule allows. `--restricted` confines the file tools to the working directories and ignores user, project and local settings. The working directory is empty, so no `CLAUDE.md`, `.claude/` or `.mcp.json` from the reviewed repository is loaded as configuration.
- `--strict-mcp-config` loads only Heron's server.
- Heron raises Claude Code's own caps on one MCP call, `MAX_MCP_OUTPUT_TOKENS` and `MCP_TOOL_TIMEOUT`, so they never cut a Heron tool short.

If the model calls any other tool, or Claude Code denies a call, Heron fails the session. The flags were checked against Claude Code 2.1.281.

The report shows the model name and cost that Claude Code reports.

### `codex-cli`

Heron runs `codex exec` (or the harness `command`) in an empty temporary directory:

```text
codex exec --json --output-schema <file> -m <model>
  -c model_reasoning_effort=<effort> --sandbox read-only --skip-git-repo-check
  --ephemeral -C <dir>
  -c features.shell_tool=false -c features.unified_exec=false
  -c web_search="disabled" -c approval_policy="never" -c tools.view_image=false
  -c project_doc_max_bytes=0 -c tool_output_token_limit=1000000
  -c mcp_servers.heron.command=... -c mcp_servers.heron.args=[...]
  -c mcp_servers.heron.required=true -c mcp_servers.heron.tool_timeout_sec=86400
  -c mcp_servers.heron.enabled_tools=[<every Heron tool>]
  -c mcp_servers.<name>.enabled=false ...  -
```

Codex keeps no shell and no native file tools: a shell could read Codex's own `auth.json`. The model reads only through the Heron tools. `tool_output_token_limit` and `tool_timeout_sec` raise Codex's own caps on a tool result and on the wait for one. The 0.101.0 binary contains both keys; Heron did not measure their effect.

A `-c` setting merges into the operator's Codex `config.toml` instead of replacing it, and Codex has no flag to skip that file. So before each session Heron runs `codex mcp list --json` with the same environment and adds `-c mcp_servers.<name>.enabled=false` for every MCP server the list names. Heron refuses to start the session, and the review is BLOCKED, when:

- a server name contains a character other than a letter, a digit, `-`, or `_`, because Codex splits the `-c` key on every dot and the server could not be addressed;
- a server is named `heron`, because its settings would merge with Heron's own tool server;
- `codex mcp list --json` exits with an error or does not print a JSON array.

The prompt arrives on standard input. If Codex reports a shell command, a file change, a web search, or a call to another MCP server, Heron fails the session. The flags were checked against codex-cli 0.101.0.

Codex does not report the model name or a cost, so the report shows the configured model and `n/a` for cost.

### `ai-sdk`

Heron calls `generateText` from the AI SDK (`ai` 7) with the OpenRouter provider (`@openrouter/ai-sdk-provider` 3). The Heron tools run inside the Heron process. The loop runs until the model answers without calling a tool, or for `limits.maxTurns` steps when you set it. `effort` becomes OpenRouter's `reasoning.effort` and must be one of `xhigh`, `high`, `medium`, `low`, `minimal`, or `none`. Set the harness `baseUrl` to use another OpenRouter-compatible endpoint.

The report shows the model id and the cost that OpenRouter returns.

## Try one backend

`scripts/probe.ts` runs one short real session per named backend against a throwaway local repository with source, target and base commits, and prints the result, usage, and time taken. With `PROBE_TRANSCRIPT=<file>`, the `claude-cli` probe also prints each tool the model called. It needs the backend's credential and, for the CLI backends, the vendor CLI on `PATH`.

```sh
node scripts/probe.ts ai-sdk
```

Set the model and effort with `PROBE_<KIND>_MODEL` and `PROBE_<KIND>_EFFORT`, where `<KIND>` is `CLAUDE_CLI`, `CODEX_CLI`, or `AI_SDK`. The probe spends real tokens.
