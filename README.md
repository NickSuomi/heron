<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/brand/assets/heron-lockup-on-dark.svg">
    <img alt="Heron" src="docs/brand/assets/heron-lockup.svg" width="344">
  </picture>
</p>

# Heron

<!-- github-readme-standard: full -->

Heron is a self-hosted code-review bot for GitLab merge requests. It runs on your own runner with your own model credentials, posts one report note per merge request, and never pushes, approves, or merges.

Status: alpha. Version 0.0.0, not published to npm. Install from source.

## What is Heron?

Heron reviews one merge request at its current head. Language models that you choose read the diff and the source at that commit and return findings. Heron turns the findings into a verdict, writes one report note on the merge request, and sets a label for the verdict. When the merge request changes and you run Heron again, it updates the same note.

The verdict is one of four fixed words: PASS, CHANGES REQUESTED, BLOCKED, or SUPERSEDED. The words are fixed so that scripts can match them.

## Why Heron?

- There is no hosted service. Heron runs in your CI job with your GitLab token, and the only outside service it calls is the model vendor you configure.
- Code decides the verdict, not the model. Any blocker finding means CHANGES REQUESTED. A session that fails, times out, or returns malformed output means BLOCKED, never PASS.
- Review depth follows the change. Path rules in the config pick a lane, for example one reviewer for a docs change, gates with a supervisor for most changes, or two independent branches and a judge for sensitive paths.
- Models only read. They see the reviewed commit through three read-only tools and cannot run commands or change files.
- Heron does not start inline discussion threads, approve, or merge. It writes one note and sets labels.

## How it works

1. Heron loads the config. If the config lists allowed users, Heron checks that the user who triggered the review is one of them.
2. It reads the merge request and its full diff from the GitLab API at one head commit. If GitLab truncated or collapsed any part of the diff, Heron stops without reviewing.
3. Path rules choose a lane. The lane sets the gates (review concerns such as correctness or security) and the sessions that run them.
4. Heron fetches the head commit into a temporary bare repository. Each session runs on the backend its profile names, reads source through `grep`, `list_files`, and `read_file`, and returns findings as JSON.
5. Heron derives the verdict from the findings. If the branch moved during the review, the verdict is SUPERSEDED.
6. Heron creates or updates its report note and sets the verdict label. The note starts with a hidden marker that records the head commit, the config digest, and the verdict.

The report lists findings with links to `path:line` at the reviewed head, a gate status table, and a provenance table with the backend, model, effort, tokens, tool calls, time, and vendor-reported cost of each session.

## Quick start

### Requirements

- Node 24 or later
- pnpm 11
- git

A real review also needs a GitLab bot token with the `api` scope and a credential for one [backend](docs/backends.md).

### Install

Heron is not on npm yet. Install it from source:

```sh
git clone https://github.com/NickSuomi/heron.git
cd heron
pnpm install --frozen-lockfile
```

The `git clone` line was not run while this README was checked. The other commands were.

### First useful result

Validate the example config. This needs no network and no credentials:

```sh
pnpm heron config check --config heron.config.example.json
```

It prints the effective config, then the lanes, the credential variables and whether each is set, and the config digest:

```text
lanes: light (single, 1 gates), standard (gated, 3 gates), critical (dual, 3 gates); default standard
GITLAB_TOKEN: missing
CLAUDE_CODE_OAUTH_TOKEN: missing
CODEX_HOME: missing
OPENROUTER_API_KEY: missing
digest: d6e7c6abe81707a57c0358dc3f73231a19199edff62f844a90c0d2b02f7cca17
```

To review a real merge request without posting anything, copy the example to `heron.config.json`, set your GitLab URL, project, bot user id, and models, set `GITLAB_TOKEN` and the backend credential, and run:

```sh
pnpm heron review --mr 42 --dry-run
```

This command was not run while this README was checked, because it needs a GitLab project and model credentials. Without `--dry-run`, Heron posts the note and sets labels.

## Integrations

- **GitLab CI.** [Run Heron from GitLab CI](docs/gitlab-ci.md) gives a manual merge request job that takes all configuration from CI/CD variables and admits only listed users.
- **Model backends.** [Backends](docs/backends.md) covers `ai-sdk` (OpenRouter with an API key), `claude-cli` (your Claude Code CLI), and `codex-cli` (your Codex CLI), with the vendor terms for each.

## Architecture

- `src/review.ts` holds `reviewOnce`, the one review pipeline. It talks to GitLab and to the models through two ports defined in `src/ports.ts`: `Forge` and `Harness`.
- `src/policy.ts` holds the decisions as plain functions: admission, lane choice, the session plan, the verdict, label changes, and whether to create, update, or skip the note.
- `src/forge/gitlab.ts` implements `Forge` over the GitLab REST API. `src/harness/` implements `Harness` for the three backends and the read-only source tools they share.
- The hidden marker in the report note is the only state Heron keeps. There is no database.

Reference: [Configuration](docs/configuration.md), [Backends](docs/backends.md), [Security model](docs/security.md), [Design book](docs/brand/README.md).

## Known limitations

- **Not on npm.** Install from source and run `pnpm heron` or `node src/cli.ts`.
- **GitLab only.** `forge.kind` accepts only `gitlab`.
- **No watcher.** Nothing reviews a merge request until someone runs `heron review`, for example from the [manual CI job](docs/gitlab-ci.md). A `heron watch` command is not implemented.
- **Large diffs are not reviewed.** If GitLab caps, collapses, or is still preparing the diff, Heron stops with an error and posts nothing.
- **Findings live in one note.** Heron does not open inline discussion threads.
- **Merge request text can steer the model.** The author controls the diff and description the model reads. A PASS is one automated opinion, not a security approval. See [Security model](docs/security.md#limits-of-the-threat-model).
- **Vendor terms limit the CLI backends.** Anthropic [does not allow](https://code.claude.com/docs/en/agent-sdk/overview) third-party products to offer claude.ai login or rate limits without approval. Heron offers no login: `claude-cli` runs your own authenticated Claude Code, and your plan's terms apply. OpenAI's [CI/CD auth guide](https://developers.openai.com/codex/auth/ci-cd-auth.md) says not to use ChatGPT-managed Codex auth for public or open-source repositories, so use `codex-cli` only for private repositories on trusted runners. For shared or public use, choose `ai-sdk` with an API key. Details are in [Backends](docs/backends.md#vendor-terms).
- **`config check` names one credential per backend.** It reports `CLAUDE_CODE_OAUTH_TOKEN` as missing even when `ANTHROPIC_API_KEY` is set, and it asks for `CODEX_HOME` even when `CODEX_API_KEY` is set. Heron passes either one to the backend.

## Verify

These commands pass on Node 24.21.0 with pnpm 11.1.3:

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm build
node scripts/check-readme-contract.mjs README.md
```

`pnpm check` runs the TypeScript type checker and the Vitest suite, including a test that fails when the environment variable table in [docs/configuration.md](docs/configuration.md) differs from the code. GitHub Actions runs the same install, type check, tests, and build on every push to `main` and every pull request.

## License

This project is licensed under the Apache License 2.0. See [LICENSE](./LICENSE).
