# Security model

This page describes what Heron protects, how, and what it does not protect against. To report a vulnerability, see [SECURITY.md](../SECURITY.md).

Heron reads a merge request, lets a model read the repository at the merge request head, the target branch tip and their merge base, and writes one note, one diff discussion per blocker, and some labels. It never pushes, approves, or merges. The GitLab token is the most powerful secret it holds, so most of the design keeps that token away from the model and the vendor tools.

## Threat model

Heron is self-hosted. It runs on the operator's own infrastructure and reviews merge requests from the operator's own developers. The operator and the people who configure Heron are trusted.

The threat Heron defends against is prompt injection from merge request content. The title, description, diff, linked issues, CI logs and source are text an author controls. Such text can tell the model to read the vendor token from `/proc/self/environ` or the environment and write it into the review note. Heron's read confinement exists to make that fail:

- The model has no shell and no tool that runs code.
- Every file tool is confined to the three read-only working trees and the bare repository, which hold only the reviewed commits.
- No tool process receives a credential in its environment.

The confinement does not reduce what the model can read in the repository. Every session sees the whole repository at all three commits, with no cap on turns, time, file size or result count unless the operator sets `limits`. The confinement does not defend against a malicious operator, who controls the config, the runner and the credentials.

## GitLab token

`GITLAB_TOKEN` is read once from the environment.

- API calls send it as a bearer token to `<forge.url>/api/v4` only.
- To fetch the reviewed commits, Heron runs `git fetch` for the head, the target branch tip and the merge base, with their history, into a new bare repository in a temporary directory. The token travels to git as an `http.<origin>/.extraHeader` setting in the child's environment. It is never on the command line or in a file. Git sends it only to URLs under the GitLab origin from `forge.url`, so a clone URL that points elsewhere never receives it. Credential helpers and terminal prompts are turned off.
- Error messages from the API and from git have the token replaced with `[redacted]` before Heron prints them.
- Before it looks for or edits its report note, Heron checks that the token belongs to `forge.botUserId` and stops if it does not. It reads the marker and the earlier findings only from notes that user wrote, so a note another user posts cannot start a [re-review](../README.md#re-reviews) or plant findings. It edits, replies to, resolves or reopens only discussions whose first note that user wrote with a thread fingerprint, so a person's discussion, even one that copies a fingerprint, is never touched.
- No backend process receives the token, because the backend environment is built from an allowlist that does not include it.

## Backend environment allowlist

A CLI backend runs as a child process with only these variables, and only when they are set and not empty:

| Backend | Variables passed |
| --- | --- |
| `claude-cli` | `PATH`, `LANG`, `CLAUDE_CODE_OAUTH_TOKEN`, `ANTHROPIC_API_KEY`. `HOME` and `CLAUDE_CONFIG_DIR` point at a fresh, empty directory per session, so the operator's Claude Code settings, memory, hooks and login are never loaded. |
| `codex-cli` | `PATH`, `HOME`, `LANG`, `CODEX_HOME`, `CODEX_API_KEY` |
| both | `HTTP_PROXY`, `HTTPS_PROXY`, `NO_PROXY` and their lower-case forms, `NODE_EXTRA_CA_CERTS`, `SSL_CERT_FILE`, `SSL_CERT_DIR` |

Heron replaces the backend's own secret values with `[redacted]` in any vendor error text it reports. The `ai-sdk` backend runs inside the Heron process and reads only `OPENROUTER_API_KEY`.

The child process leads its own process group. When a session ends or times out, Heron kills the whole group, including the tool server it started. Temporary directories are removed when the session or the review ends.

## Read-only source tools

The model reads code only through read-only tools. The Heron tools are `grep`, `list_files`, `read_file`, `rg`, `ast_grep`, `secret_scan`, `git_log`, `git_show`, `git_blame`, `git_diff`, and six TypeScript language-server lookups that also cover Vue files and Effect code; [Backends](backends.md#source-tools) lists them. The CLI backends reach them through `heron mcp-source`, a stdio MCP server that Heron starts for each session. The `ai-sdk` backend calls the same code in-process. `claude-cli` also gets Claude Code's own `Read`, `Grep` and `Glob`.

- Heron writes one working tree per commit and removes write permission from every file and directory in it. A symbolic link in the repository becomes a plain file that holds the link target, so no path in a tree leads outside it. No hook, filter or fsmonitor runs while Heron writes the trees. Heron removes the trees and the bare repository when the review ends.
- Paths must be relative to the repository. Absolute paths, `..`, backslashes, NUL bytes, and git pathspec magic are rejected. Commit arguments must be hex ids or `source`, `target` or `base`; no tool passes a free-form flag to git.
- Every tool process runs with a fixed environment: `PATH`, a `HOME` that does not exist, the C locale, no system or global git config, and no credential. Git runs with `core.fsmonitor=false` and `core.hooksPath=/dev/null`, and `git show` and `git diff` with `--no-ext-diff --no-textconv`.
- ripgrep runs with `--no-config`. ast-grep runs with `--config=/dev/null`, because a `sgconfig.yml` in the reviewed repository can name a native library for ast-grep to load.
- The language server uses Heron's own TypeScript through `tsserver.path`, so a `node_modules/typescript` committed to the reviewed repository never runs. Automatic type acquisition, which runs npm, is off.
- Heron's tsserver entry, [`tsserver/lib/tsserver.js`](../tsserver/lib/tsserver.js), loads exactly two plugins, the Vue TypeScript plugin and the Effect language service, from fixed paths in Heron's install. It refuses every other plugin a tsconfig names, and it loads a plugin that a tsconfig names `@effect/language-service` from Heron's copy, never from a `node_modules` directory. Without this, tsserver looks a tsconfig plugin up in every `node_modules` directory above Heron's install. The Vue plugin would `require` each module a tsconfig lists in `vueCompilerOptions.plugins`, resolved from the tsconfig's directory, so Heron drops that key. `test/harness-vueEffect.test.ts` commits all three kinds of plugin to a fixture repository and checks that none of them runs.
- For an import of `vue` or `effect` that the tree cannot resolve, tsserver reads Heron's own declarations of the major version the nearest `package.json` declares. These are `.d.ts` files and TypeScript sources that tsserver parses; nothing in them runs.
- Tool errors never include a temporary directory path.

Each CLI backend is started so that these are the only tools the model has:

- `claude-cli` allows `Read`, `Grep` and `Glob` only inside the three trees: they are its working directories, allow rules name them, and `dontAsk` denies everything else. Deny rules also cover `/proc`, `/sys` and the session's home. `--restricted` confines the file tools to the working directories. Shell, edit, web and agent tools are listed in `--disallowedTools`.
- `codex-cli` runs in Codex's read-only sandbox with shell, web search, and image viewing turned off. It gets no native file tool, because a shell or file tool could read Codex's own `auth.json`. Codex also loads the MCP servers from the operator's `config.toml`, so Heron lists them with `codex mcp list --json` and turns each one off with `-c mcp_servers.<name>.enabled=false`. It refuses to run the session if a server name has a character other than a letter, a digit, `-`, or `_`, or if a server is already named `heron`. See [Backends](backends.md#codex-cli).

If the event stream shows any other tool call, or Claude Code reports a denied call, the session fails and the review is BLOCKED.

These flags rely on the vendor CLI doing what its documentation says. Heron checks the event stream after the fact. It cannot stop a vendor CLI that ignores its own flags.

## CI logs in the packet

The packet carries the last 200 lines of each failed job in the head pipeline. Before a log reaches the model, Heron removes ANSI codes, replaces the GitLab token with `[redacted]`, and replaces strings shaped like GitLab, Anthropic, OpenAI or OpenRouter keys. GitLab's own masking of masked CI/CD variables applies first. A secret with another shape that a job prints unmasked reaches the model and the vendor.

## CI variables

In a merge request pipeline, anyone who can push a branch can change `.gitlab-ci.yml` in that branch. A changed job can print every variable it receives, including `GITLAB_TOKEN` and the backend credential. GitLab passes protected variables only to pipelines on protected branches and tags, so they do not help for merge requests from ordinary branches.

To limit the damage:

- Give the bot token the smallest reach you can: a project access token on the one project, with the Developer role. That is the lowest role that can comment, set labels, and [resolve or reopen a thread](https://docs.gitlab.com/api/discussions/#resolve-a-merge-request-thread) on a merge request the bot did not author.
- Use a backend credential with a spending limit.
- If developers are not trusted with these secrets, run Heron from a separate project that only maintainers can edit, and pass the merge request number to its pipeline.

## Limits of the threat model

- **Untrusted content reaches the model.** The merge request title, description, diff, linked issues, CI logs and source are text the author controls. An author can write text that tries to steer the model toward PASS or to hide a defect. Heron limits what the model can do, not what it concludes. Treat a PASS as one reviewer's opinion, not as a security approval.
- **Heron writes all Markdown in the note itself.** Summaries, finding titles and bodies, finding paths, limitations, ruling reasons, vendor error text and provenance table cells are never passed through as Markdown. Heron reads model text into three constructs of its own and writes them back out:
  - Paragraphs. A single line break becomes a hard line break (two trailing spaces) and a blank line becomes a paragraph break. Leading spaces and tabs are removed, so no line becomes an indented code block.
  - Bullet lists, from lines that start with `- ` or `* `. Heron writes each item as `- ` followed by the item's text.
  - Code spans, from a backtick run and the next run of the same length on the same line, as CommonMark pairs them. Heron writes the content with a fence one backtick longer than any backtick run inside it, adds a space inside the fence when the content starts or ends with a backtick, and replaces line breaks with spaces. CommonMark shows code-span content literally, and GitLab's reference filters skip every text node inside a `pre`, `code`, `a` or `style` element (`ignore_ancestor_query` in [`lib/banzai/filter/references/reference_filter.rb`](https://gitlab.com/gitlab-org/gitlab/-/blob/master/lib/banzai/filter/references/reference_filter.rb)), so the content needs no escaping and shows mentions, references and HTML as written text. A paragraph line that would start with a fence starts with a word joiner instead. CommonMark already refuses a fence whose info string holds a backtick; the joiner keeps Heron from depending on that rule.
  - Heron drops `**` markers. In all other text, every ASCII punctuation character (``!"#$%&'()*+,-./:;<=>?@[\]^_`{|}~``), an unpaired backtick included, gets a backslash in front of it and an invisible word joiner (U+2060) after it. The backslash stops Markdown: no code span, code block, emphasis, link, image, heading, list, quote, table, HTML tag, HTML comment or entity can open, and no line can start with the `/` that GitLab runs as a quick action. The joiner stops GitLab's text filters: no mention, issue, merge request, label, milestone, epic, snippet or cross-project reference forms, and no URL is linked. A bare commit hash has no punctuation and stays as written, so GitLab may still link it to that commit in the same project; that notifies nobody. Because escaped text ends in a joiner, no model backslash can escape the opening backtick of Heron's fence.
  - Table cells and link labels get only the escaped form, because a code span there could not hold a `|` or `]`.
  - The cost: URLs the model quotes show as unlinked text, and text copied from outside code spans carries the invisible joiners. Heron does not trust the model's Markdown, because three earlier attempts to mirror GitLab's parsing of it disagreed with GitLab and let mentions, references or HTML through. Heron only decides where a code span starts and ends by its own rule and then writes a fence that the content cannot close.
  - A finished review ends the note with the findings it kept, as base64url JSON inside an HTML comment. The base64url alphabet has no `>` or other Markdown character, so model text inside the payload cannot close the comment or render. Heron reads the payload only from the note's last line. Model text reaches the note source unescaped only inside a code span, which never holds a line break and is always followed by Heron's own text, so model text cannot write that line. Heron decodes the payload against a strict schema and treats anything else as no earlier findings, which means a full review.
  - A blocker thread's first note starts with a hidden fingerprint: the gate, the path and the normalised title, as base64url JSON in an HTML comment. Heron reads it only from the first line of the first note, which always starts with Heron's own text, and only from notes `forge.botUserId` wrote, so model text cannot plant or move a fingerprint. The rest of the thread goes through the same renderer as the note.
  - `test/report-render.test.ts` renders reports built from hostile text with markdown-it, including hostile text inside backticks and backtick runs that try to close Heron's fence. It checks that the text adds only paragraphs, line breaks, bullet lists and code spans, that no reference sigil outside code is left without a joiner, and that no line starts with `/`. It also checks that the same text comes back unchanged from the earlier findings payload, and that a payload quoted in a code span is not read as one. It runs the same checks on blocker thread notes and their fingerprints. markdown-it stands in for GitLab's renderer; GitLab itself is not tested.
- **Earlier findings return to the model.** A re-review sends the findings the earlier review kept to the session that rules on them again. They are model text from that earlier review, and the new session can drop them or keep them as advisories as well as keep them.
- **Source goes to the vendor.** The diff, the linked issues, the failed job logs, and any file the model reads are sent to the model vendor of the backend you chose, under that vendor's data terms.
- **The admission filter is only as strong as the trigger.** `allowedTriggerUserIds` checks the user id from `--triggered-by` or `GITLAB_USER_ID`. Anyone who can run `heron` with the token directly can pass any id.
- **Codex credentials need one writer.** Two jobs that share one `CODEX_HOME` can overwrite each other's refreshed tokens. See [Backends](backends.md#codex-codex-cli).
