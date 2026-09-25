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

All three backends give the model the same three tools: `grep`, `list_files`, and `read_file`. The tools read a bare git repository that holds exactly the reviewed commit. The judge in a `dual` lane gets no tools. See [Security](security.md) for the limits on these tools.

Every session runs with the profile's `model` and `effort`, a turn limit of `limits.maxTurns`, and a wall-clock limit of `limits.sessionTimeoutSeconds`. The model must answer with JSON that matches a schema Heron supplies. If a session fails, times out, calls a tool it is not allowed to call, or returns JSON that does not match, the review ends with the verdict BLOCKED.

### `claude-cli`

Heron starts the `claude` binary (or the harness `command`) in an empty temporary directory:

```text
claude -p --output-format stream-json --verbose --json-schema <schema>
  --model <model> --effort <effort> --system-prompt-file <file>
  --tools "" --strict-mcp-config --mcp-config <file> --allowedTools mcp__heron
  --permission-mode dontAsk --permission-prompts none --setting-sources ""
  --no-session-persistence --max-turns <n>
```

`--tools ""` turns off the built-in tools. The only tools left are the three Heron tools, served by `heron mcp-source` over MCP (Model Context Protocol, the standard Claude Code uses to talk to tool servers). `--setting-sources ""` stops Claude Code from loading user or project settings. If the model calls any other tool, Heron fails the session. The flags were checked against Claude Code 2.1.281.

The report shows the model name and cost that Claude Code reports.

### `codex-cli`

Heron runs `codex exec` (or the harness `command`) in an empty temporary directory:

```text
codex exec --json --output-schema <file> -m <model>
  -c model_reasoning_effort=<effort> --sandbox read-only --skip-git-repo-check
  --ephemeral -C <dir>
  -c features.shell_tool=false -c features.unified_exec=false
  -c web_search="disabled" -c approval_policy="never" -c tools.view_image=false
  -c project_doc_max_bytes=0
  -c mcp_servers.heron.command=... -c mcp_servers.heron.args=[...]
  -c mcp_servers.heron.required=true
  -c mcp_servers.heron.enabled_tools=["grep","list_files","read_file"]
  -c mcp_servers.<name>.enabled=false ...  -
```

The `mcp_servers.heron.*` settings are left out for the judge session, which gets no tools.

A `-c` setting merges into the operator's Codex `config.toml` instead of replacing it, and Codex has no flag to skip that file. So before each session Heron runs `codex mcp list --json` with the same environment and adds `-c mcp_servers.<name>.enabled=false` for every MCP server the list names. Heron refuses to start the session, and the review is BLOCKED, when:

- a server name contains a character other than a letter, a digit, `-`, or `_`, because Codex splits the `-c` key on every dot and the server could not be addressed;
- a server is named `heron`, because its settings would merge with Heron's own tool server;
- `codex mcp list --json` exits with an error or does not print a JSON array.

The prompt arrives on standard input. If Codex reports a shell command, a file change, a web search, or a call to another MCP server, Heron fails the session. The flags were checked against codex-cli 0.101.0.

Codex does not report the model name or a cost, so the report shows the configured model and `n/a` for cost.

### `ai-sdk`

Heron calls `generateText` from the AI SDK (`ai` 7) with the OpenRouter provider (`@openrouter/ai-sdk-provider` 3). The three tools run inside the Heron process. The step count is capped at `limits.maxTurns`. `effort` becomes OpenRouter's `reasoning.effort` and must be one of `xhigh`, `high`, `medium`, `low`, `minimal`, or `none`. Set the harness `baseUrl` to use another OpenRouter-compatible endpoint.

The report shows the model id and the cost that OpenRouter returns.

## Try one backend

`scripts/probe.ts` runs one short real session per named backend against a throwaway local repository and prints the result, usage, and time taken. It needs the backend's credential and, for the CLI backends, the vendor CLI on `PATH`.

```sh
node scripts/probe.ts ai-sdk
```

Set the model and effort with `PROBE_<KIND>_MODEL` and `PROBE_<KIND>_EFFORT`, where `<KIND>` is `CLAUDE_CLI`, `CODEX_CLI`, or `AI_SDK`. The probe spends real tokens.
