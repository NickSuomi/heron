# Security model

This page describes what Heron protects, how, and what it does not protect against. To report a vulnerability, see [SECURITY.md](../SECURITY.md).

Heron reads a merge request, lets a model read the source at one commit, and writes one note and some labels. It never pushes, approves, or merges. The GitLab token is the most powerful secret it holds, so most of the design keeps that token away from the model and the vendor tools.

## GitLab token

`GITLAB_TOKEN` is read once from the environment.

- API calls send it as a bearer token to `<forge.url>/api/v4` only.
- To fetch the reviewed commit, Heron runs `git fetch --depth=1` into a new bare repository in a temporary directory. The token travels to git as an `http.<origin>/.extraHeader` setting in the child's environment. It is never on the command line or in a file. Git sends it only to URLs under the GitLab origin from `forge.url`, so a clone URL that points elsewhere never receives it. Credential helpers and terminal prompts are turned off.
- Error messages from the API and from git have the token replaced with `[redacted]` before Heron prints them.
- Before it looks for or edits its report note, Heron checks that the token belongs to `forge.botUserId` and stops if it does not.
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

The model reads code only through three tools: `grep`, `list_files`, and `read_file`. The CLI backends reach them through `heron mcp-source`, a stdio MCP server that Heron starts for each session. The `ai-sdk` backend calls the same code in-process.

- The tools read a bare repository that contains only the reviewed commit. There is no working tree to change.
- Paths must be relative to the repository. Absolute paths, `..`, backslashes, NUL bytes, and git pathspec magic are rejected.
- Git runs with a minimal environment: no system config, a `HOME` that does not exist, and the C locale.
- Output is capped: 500 lines for `grep`, 5000 paths for `list_files`, and 2000 lines or 60,000 characters per `read_file` call. `read_file` refuses files larger than about 8 MiB and binary files.
- Tool errors never include the temporary directory path.

Each CLI backend is started so that these tools are the only tools the model has. `claude-cli` turns off every built-in tool. `codex-cli` runs in Codex's read-only sandbox with shell, web search, and image viewing turned off. Codex also loads the MCP servers from the operator's `config.toml`, so Heron lists them with `codex mcp list --json` and turns each one off with `-c mcp_servers.<name>.enabled=false`. It refuses to run the session if a server name has a character other than a letter, a digit, `-`, or `_`, or if a server is already named `heron`. See [Backends](backends.md#codex-cli). If the event stream shows any other tool call, the session fails and the review is BLOCKED. The judge session in a `dual` lane gets no tools at all.

These flags rely on the vendor CLI doing what its documentation says. Heron checks the event stream after the fact. It cannot stop a vendor CLI that ignores its own flags.

## CI variables

In a merge request pipeline, anyone who can push a branch can change `.gitlab-ci.yml` in that branch. A changed job can print every variable it receives, including `GITLAB_TOKEN` and the backend credential. GitLab passes protected variables only to pipelines on protected branches and tags, so they do not help for merge requests from ordinary branches.

To limit the damage:

- Give the bot token the smallest reach you can: a project access token on the one project, with the lowest role that can comment and set labels.
- Use a backend credential with a spending limit.
- If developers are not trusted with these secrets, run Heron from a separate project that only maintainers can edit, and pass the merge request number to its pipeline.

## Limits of the threat model

- **Untrusted content reaches the model.** The merge request title, description, diff, and source are text the author controls. An author can write text that tries to steer the model toward PASS or to hide a defect. Heron limits what the model can do, not what it concludes. Treat a PASS as one reviewer's opinion, not as a security approval.
- **Model text is posted as plain text.** Summaries, finding titles and bodies, finding paths, limitations, vendor error text and provenance table cells are never read as Markdown. Heron changes them as follows:
  - Every ASCII punctuation character (``!"#$%&'()*+,-./:;<=>?@[\]^_`{|}~``) gets a backslash in front of it. No code span, code block, emphasis, link, image, heading, list, quote, table, HTML tag, HTML comment or entity can open, and no line can start with the `/` that GitLab runs as a quick action.
  - A reference or mention character (`@ # ! ~ % & $`) gets an invisible word joiner (U+2060) after it when it is at the start of the text or follows anything other than an ASCII letter, digit or `_`, and is followed by a letter, digit, `_`, `"` or `[`. GitLab does not see a mention or reference there, and nobody is notified. `a@b.com` and `C#` are unchanged. `$HOME` shows the same but contains a joiner after `$`, which a reader who copies it also copies.
  - An `http` or `https` URL that follows a space, the start of a line or `(`, runs to the next space, and holds only a host name and the characters ``A-Z a-z 0-9 - . : / ? # @ ! $ % & ' ( ) + , =`` (`_` only between letters or digits) stays byte for byte, trailing punctuation included. None of those characters can open Markdown there, GitLab links the URL, and it does not look for references inside a link. Any other URL, such as `foohttps://x.test` or one that contains `*` or `<`, is escaped like the rest of the text, and GitLab may not link it.
  - A single line break becomes a hard line break (two trailing spaces) and a blank line becomes a paragraph break. Leading spaces and tabs are removed, so no line becomes an indented code block.
  - Code that the model quotes shows as literal text with its backticks and without code formatting. This is the cost of the rule: Heron does not try to find where code starts and ends, because two earlier attempts to mirror GitLab's parser disagreed with it and let mentions and HTML through.
  - `test/report-render.test.ts` renders reports built from hostile text with markdown-it and checks that the text adds only paragraphs, line breaks and links made from bare URLs, that no live mention or reference is left, and that no line starts with `/`. markdown-it stands in for GitLab's renderer; GitLab itself is not tested.
- **Source goes to the vendor.** The diff and any file the model reads are sent to the model vendor of the backend you chose, under that vendor's data terms.
- **The admission filter is only as strong as the trigger.** `allowedTriggerUserIds` checks the user id from `--triggered-by` or `GITLAB_USER_ID`. Anyone who can run `heron` with the token directly can pass any id.
- **Codex credentials need one writer.** Two jobs that share one `CODEX_HOME` can overwrite each other's refreshed tokens. See [Backends](backends.md#codex-codex-cli).
