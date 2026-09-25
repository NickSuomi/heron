# Configuration reference

Heron reads one strict JSON file and then applies environment overrides. This page lists every key and every environment variable. [`heron.config.example.json`](../heron.config.example.json) is a complete example.

## Where Heron finds the config

Heron takes the first source that is present:

1. The `--config <path>` flag.
2. `HERON_CONFIG`, a file path.
3. `HERON_CONFIG_JSON`, the whole config as a JSON string.
4. `heron.config.json` in the working directory.

Instruction file paths in the config are relative to the directory of the config file. With `HERON_CONFIG_JSON` they are relative to the working directory.

`heron config check` loads the config, reads every instruction file, and prints the effective config, the lanes, which credential variables are set, and the config digest. It makes no network calls.

## Rules for the file

- Unknown keys are errors. A typo such as `"lables"` fails the load.
- Names of gates, lanes, profiles, and harnesses match `^[a-z][a-z0-9_-]*$`.
- User ids are positive integers.
- Heron reports every decoding error at once, then stops.

## Keys

### `forge`

| Key | Type | Meaning |
| --- | --- | --- |
| `kind` | `"gitlab"` | The only supported forge. |
| `url` | string | GitLab base URL, for example `https://gitlab.example.com`. |
| `project` | string | Project path (`group/app`) or numeric project id. |
| `botUserId` | integer | The user id that `GITLAB_TOKEN` belongs to. Heron checks this before it reads or writes its report note and stops if the token belongs to another user. |

### `admission`

| Key | Type | Meaning |
| --- | --- | --- |
| `allowedTriggerUserIds` | integer array, optional | When set, `heron review` runs only if the triggering user is in the list. The triggering user comes from `--triggered-by`, else from `GITLAB_USER_ID`. If neither is present, the review is refused. When the key is absent, anyone who can start Heron can trigger a review. |

### `labels`

All four keys are optional. A missing key means Heron does not manage that label.

| Key | Set when |
| --- | --- |
| `inProgress` | A review is running. Heron removes it when the review ends, also on failure. |
| `pass` | The verdict is PASS. |
| `changesRequested` | The verdict is CHANGES REQUESTED. |
| `blocked` | The verdict is BLOCKED. |

The four names must be distinct and must not contain a comma. Each label must already exist in the project or one of its parent groups. Heron refuses to add a label GitLab does not know, because GitLab would create it silently. After a review, Heron adds the verdict label and removes the other managed labels. A SUPERSEDED verdict adds no label.

### `backend` and `harnesses`

`harnesses` maps a harness key of your choice to one backend. `backend` names the harness key used by any profile that does not set its own `harness`.

| `kind` | Other keys | Credentials |
| --- | --- | --- |
| `claude-cli` | `concurrency`, optional `command` (default `claude`) | `CLAUDE_CODE_OAUTH_TOKEN` or `ANTHROPIC_API_KEY` |
| `codex-cli` | `concurrency`, optional `command` (default `codex`) | `CODEX_HOME`, optionally `CODEX_API_KEY` |
| `ai-sdk` | `provider: "openrouter"`, `concurrency`, optional `baseUrl` | `OPENROUTER_API_KEY` |

`concurrency` is the number of sessions Heron runs at once on that harness. See [Backends](backends.md) for what each backend runs and the vendor terms that apply.

### `profiles`

A profile is a model choice. Lanes refer to profiles by name.

| Key | Type | Meaning |
| --- | --- | --- |
| `harness` | string, optional | Harness key. Defaults to `backend`. |
| `model` | string | Model id passed to the backend unchanged. |
| `effort` | string | Reasoning effort passed to the backend. For `ai-sdk` it must be one of `xhigh`, `high`, `medium`, `low`, `minimal`, `none`. |

### `gates`

A gate is one review concern with its own instructions. `instructions` is a path to a Markdown file. [`examples/instructions/`](../examples/instructions) has four short examples.

### `lanes`, `defaultLane`, and `rules`

A lane says which gates run and which sessions run them. The order of `lanes` is the severity order: a later lane is stricter.

| `shape` | Keys | Sessions |
| --- | --- | --- |
| `single` | `gates`, `reviewer` | One session reviews all gates. |
| `gated` | `gates`, `gate`, `supervisor` | One session per gate with the `gate` profile, then one supervisor session that keeps or drops each finding and may add findings. |
| `dual` | `gates`, `branches` (two `{ gate, supervisor }` pairs), `judge` | Two independent `gated` branches, then one judge session that keeps or drops each finding. The judge has no repository access. |

`defaultLane` is used when no rule fires. Each rule has:

| Key | Meaning |
| --- | --- |
| `id` | Name shown in the report. |
| `lane` | Lane to select. |
| `when` | `any`: fires when at least one changed path matches. `all`: fires only when every changed path matches. |
| `paths` | Globs, matched with Node's `path.posix.matchesGlob`. A renamed file counts under its old and its new path. |

If several rules fire, the strictest lane wins.

### `policy`

`policy.instructions` is a list of Markdown files. Heron appends their text to the instructions of every session.

### `limits`

| Key | Default | Meaning |
| --- | --- | --- |
| `maxTurns` | 40 | Tool-use turns per session. |
| `sessionTimeoutSeconds` | 900 | Wall-clock limit per session. |

## Config digest

The digest is a SHA-256 over the effective config and the content of every instruction file. Heron writes it into the hidden marker of the report note and shows the first 12 characters in the report. A change to an instruction file changes the digest.

## Environment variables

Overrides apply to the parsed JSON before Heron validates it, so an override is checked like a value from the file. An empty variable is ignored.

In a name with `*`, the `*` is a record key from the file, upper-cased, with `-` replaced by `_`. For example, the profile `second-opinion` is overridden by `HERON_PROFILE_SECOND_OPINION_MODEL`. These variables change existing profiles and harnesses only. They cannot add one.

Variables with the config key `none` are read directly and are not part of the config. Kind `secret` means the value is a credential or points to one.

<!-- env-table:start (generated by scripts/gen-env-table.ts) -->

| Variable | Config key | Kind | Meaning |
| --- | --- | --- | --- |
| `HERON_CONFIG` | none | path | Config file path when --config is absent. |
| `HERON_CONFIG_JSON` | none | json | Whole config as JSON, used when no file path is given. |
| `HERON_GITLAB_URL` | `forge.url` | string | GitLab base URL. |
| `HERON_PROJECT` | `forge.project` | string | Project path or numeric id. |
| `HERON_BOT_USER_ID` | `forge.botUserId` | int | User id that owns the report note. |
| `HERON_ALLOWED_TRIGGER_USERS` | `admission.allowedTriggerUserIds` | int-list | Comma-separated user ids allowed to trigger a review. |
| `HERON_BACKEND` | `backend` | string | Harness key for profiles that name none. |
| `HERON_DEFAULT_LANE` | `defaultLane` | string | Lane used when no rule matches. |
| `HERON_LABEL_IN_PROGRESS` | `labels.inProgress` | string | Label set while a review runs. |
| `HERON_LABEL_PASS` | `labels.pass` | string | Label for a PASS verdict. |
| `HERON_LABEL_CHANGES_REQUESTED` | `labels.changesRequested` | string | Label for a CHANGES REQUESTED verdict. |
| `HERON_LABEL_BLOCKED` | `labels.blocked` | string | Label for a BLOCKED verdict. |
| `HERON_MAX_TURNS` | `limits.maxTurns` | int | Tool-use turns per session. |
| `HERON_SESSION_TIMEOUT_SECONDS` | `limits.sessionTimeoutSeconds` | int | Wall-clock limit per session. |
| `HERON_PROFILE_*_HARNESS` | `profiles.*.harness` | string | Harness key of one profile. |
| `HERON_PROFILE_*_MODEL` | `profiles.*.model` | string | Model of one profile. |
| `HERON_PROFILE_*_EFFORT` | `profiles.*.effort` | string | Reasoning effort of one profile. |
| `HERON_HARNESS_*_CONCURRENCY` | `harnesses.*.concurrency` | int | Parallel sessions on one harness. |
| `HERON_HARNESS_*_COMMAND` | `harnesses.*.command` | string | Vendor CLI path for a claude-cli or codex-cli harness. |
| `HERON_HARNESS_*_BASE_URL` | `harnesses.*.baseUrl` | string | API base URL for an ai-sdk harness. |
| `GITLAB_TOKEN` | none | secret | Bot token for the GitLab API. Never passed to a harness. |
| `GITLAB_USER_ID` | none | int | Triggering user when --triggered-by is absent; GitLab CI sets it. |
| `CLAUDE_CODE_OAUTH_TOKEN` | none | secret | Token for the claude-cli harness. |
| `CODEX_HOME` | none | secret | Persistent Codex home for the codex-cli harness. |
| `OPENROUTER_API_KEY` | none | secret | API key for the ai-sdk harness. |

<!-- env-table:end -->

To change this table, edit `envVars` in [`src/config.ts`](../src/config.ts) and run `pnpm gen-env-table`. `pnpm test` fails when the table and `envVars` differ.

The table covers the variables Heron itself reads. Two more credentials pass through to a vendor CLI when set: `ANTHROPIC_API_KEY` for `claude-cli` and `CODEX_API_KEY` for `codex-cli`. [Security](security.md) lists everything a backend process receives.
