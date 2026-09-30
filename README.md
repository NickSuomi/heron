<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/brand/assets/heron-lockup-on-dark.svg">
    <img alt="Heron" src="docs/brand/assets/heron-lockup.svg" width="344">
  </picture>
</p>

# Heron

<!-- github-readme-standard: full -->

Heron is a self-hosted code-review bot for GitLab merge requests. It runs on your own runner with your own model credentials, posts one report note per merge request with a diff discussion for each blocker, and never pushes, approves, or merges.

Status: alpha. Version 0.0.0, not published to npm. Install from source.

## What is Heron?

Heron reviews one merge request at its current head. Language models that you choose read the diff, the whole repository at the merge request head and at the target branch, the linked issues, the comments on the merge request and its linked issues, and the failed CI jobs, then return findings. Heron turns the findings into a verdict, writes one report note on the merge request, opens a discussion on the diff line of each blocker, and sets a label for the verdict. When the merge request changes and you run Heron again, it updates the same note, and when it safely can, it reviews only the commits pushed since its last review.

The verdict is one of four fixed words: PASS, CHANGES REQUESTED, BLOCKED, or SUPERSEDED. The words are fixed so that scripts can match them.

## Why Heron?

- There is no hosted service. Heron runs in your CI job with your GitLab token, and the only outside service it calls is the model vendor you configure.
- Code decides the verdict, not the model. Any blocker finding means CHANGES REQUESTED. A session that fails, times out, or returns malformed output means BLOCKED, never PASS.
- Review depth follows the change. Path rules in the config pick a lane, for example one reviewer for a docs change, gates with a supervisor for most changes, or two independent branches and a judge for sensitive paths.
- Models only read, but they can read everything. Every session searches the whole repository at the source branch, the target branch and their merge base with ripgrep, structural search, a gitleaks secret scan, an offline osv-scanner check of the lockfiles, and a scan with Heron's own ast-grep rules for unsafe sinks and Vue pitfalls, whose results the model must confirm by reading the code, TypeScript language-server lookups that also read Vue files and Effect code, and git history. No session has a turn, time or result cap unless you set one. No session can run commands or change files.
- Heron does not approve or merge. It writes one note, keeps one diff discussion per blocker, and sets labels.

## How it works

1. Heron loads the config. If the config lists allowed users, Heron checks that the user who triggered the review is one of them.
2. It reads the merge request and its full diff from the GitLab API at one head commit, with the issues the merge request closes or links and the last 200 lines of each failed job in the head pipeline. If GitLab truncated or collapsed any part of the diff, Heron stops without reviewing.
3. Path rules choose a lane. The lane sets the gates (review concerns such as correctness or security) and the sessions that run them. Heron reads its own earlier report note and decides whether this run can be a [re-review](#re-reviews) of the newer commits only.
4. Heron fetches the head, the target branch tip and their merge base, with history, into a temporary repository and writes a read-only working tree for each. Each session runs on the backend its profile names, reads the repository through the tools listed in [Backends](docs/backends.md#source-tools), and returns findings as JSON.
5. The supervisor, or the judge in a dual lane, rules on each finding: `keep`, `keep as advisory`, or `drop`, with a reason. A gate's blocker that does not block by the policy becomes an advisory, so one gate's severity call does not decide the verdict. No ruling raises a finding to blocker; a supervisor that finds a blocker adds it as its own finding. Heron derives the verdict from the kept findings and their final severity. If the branch moved during the review, the verdict is SUPERSEDED.
6. Heron opens, updates, reopens or resolves its [blocker threads](#blocker-threads), then creates or updates its report note and sets the verdict label. The note starts with a hidden marker that records the head commit, the config digest, and the verdict. A finished review also ends the note with a hidden line that holds the findings it kept with their confirmed suggestions, the merge base, the target branch tip, and the lane.

The report is meant to be read in about 20 seconds. It shows the verdict, one line with the blocker and advisory counts, the head and the lane, a summary of at most two sentences on what the change does, one line Heron writes from the findings ("Before merge, fix the blocker below." or "Nothing blocks merging."), and each blocker with a link to `path:line` at the reviewed head. That line comes from the same kept findings as the verdict, so the two never disagree. Three collapsed sections hold the rest:

- The advisories.
- REVIEW CHECKS: the gate status table, the supervisor's or judge's ruling on each finding (kept, kept as advisory, or dropped) with its reason, the rest of a longer summary, what the sessions could not check in the repository, one fixed line saying Heron does not run tests, the app, a browser or a device, and why the lane was chosen.
- AGENT PROVENANCE: the model, backend, effort, tokens, time and result of each session, and the total tool calls and vendor-reported cost.

### Blocker threads

Each blocker also gets a discussion on the merge request diff, at the finding's file and line, so the author can reply and resolve it next to the code. Advisories never get one. The report note stays the full record: it lists every blocker, and one line says how many blocker threads the review opened, updated, reopened and resolved.

- Heron opens a thread only when the finding's line is part of the merge request diff at the reviewed head: an added line, or an unchanged line inside a hunk. A blocker on any other line, or without a line, stays in the note only. A blocker carried by a [re-review](#re-reviews) follows the same rule at the line Heron moved it to; one whose line the newer commits rewrote has no line and opens no new thread.
- One thread per blocker across runs. The thread's first note starts with a hidden fingerprint of the gate, the path, and the title in lower case with only letters and digits. A later review that keeps the blocker finds the thread by that fingerprint and rewrites its first note in place. If a person resolved the thread and the blocker is back, Heron reopens it.
- When a later review no longer keeps a blocker whose thread is open, Heron replies in the thread with the reviewed head's short SHA, for example ``No longer a blocker at `5e6f7a8b`.``, whether the commits fixed it or the review lowered it to an advisory or dropped it, and resolves it.
- Heron touches only discussions whose first note `forge.botUserId` wrote with a fingerprint. Replies and discussions by people are never edited or resolved.
- A thread can offer a GitLab [suggestion](https://docs.gitlab.com/user/project/merge_requests/reviews/suggestions/) that the author applies with one click. A gate proposes it: the new text for the finding's line and at most four lines right below it. The thread shows it only when all of these hold: every ruling session that ruled on the finding confirmed it at the reviewed head, every line it replaces is part of the merge request diff, and the thread sits on the finding's line at that head. A new thread does. An older thread does once GitLab has moved it to the newest diff, which GitLab does when a push leaves its line unchanged. The thread says to review the suggestion before applying it, because Heron runs no tests. A single lane has no ruling session, so its threads offer none. A [re-review](#re-reviews) keeps an earlier suggestion only when the lines it replaces moved unchanged and together, and the ruling session must confirm it again.
- A BLOCKED or SUPERSEDED review leaves every thread alone. A dry run lists the thread actions it would take and writes none.

Heron writes the threads before the note, so the note can say what happened to them. A thread write that GitLab refuses does not stop the review: the note and the labels are still published, the note counts the failed writes, the command prints each one and exits with a non-zero code, and the next review repeats the write.

### Re-reviews

When the head has moved since Heron's last report, Heron reviews only the commits after the head in that report's marker, if all of these hold:

- The note was written by `forge.botUserId` and records a finished review. A BLOCKED review and a note from a Heron version before re-reviews record no findings.
- The config digest in the marker is the current one.
- Path rules choose the same lane as for the earlier review.
- The target branch tip and the merge base are the ones the earlier review saw. When the target branch moves or the source branch merges it, the earlier code can interact with the new target code in ways the new commits do not show.
- GitLab reports the earlier head as an ancestor of the new head. A force push or a rebase fails this.
- GitLab compares the two heads completely: no timeout, no collapsed or too-large file, and no error.

Otherwise Heron reviews the whole change, as it does at an unchanged head.

In a re-review, the packet holds the changes since the earlier head and lists every path the merge request changes. Each session can still read the whole repository at all three commits. Before the findings the earlier review kept go on, Heron moves each one to the reviewed head through the diff between the two heads: the path follows a rename, and a line moves by the lines the hunks above it added and removed. A line the newer commits removed or rewrote, or a file they deleted, has no position at the new head, so the finding keeps its path and loses its line. The findings, with ids `earlier#1`, `earlier#2` and so on, go to the session that rules last: the supervisor in a gated lane, the judge in a dual lane, or the reviewer in a single lane. That session rules `keep`, `keep as advisory` or `drop` on each one with a reason, shown in the rulings table. For a finding without a line, a `keep` decision can give the line where the defect is now; until a ruling does, the note links the file with no line and says the line changed. Code derives the verdict from the kept findings and their final severity, as in a full review, and the next note records each carried finding at that final severity. The report adds one line, for example ``Re-review of `1a2b3c4d..5e6f7a8b`: 2 of 3 earlier findings carried.`` A carried blocker keeps its thread. A dry run reads the earlier note and takes the same path without writing anything.

## Quick start

### Requirements

- Node 24 or later
- pnpm 11
- git

A real review also needs a GitLab bot token with the `api` scope, for a bot with at least the Developer role so that it can resolve its threads, and a credential for one [backend](docs/backends.md).

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
claude-cli credential (CLAUDE_CODE_OAUTH_TOKEN or ANTHROPIC_API_KEY): missing
codex-cli credential (CODEX_API_KEY or CODEX_HOME): missing
ai-sdk credential (OPENROUTER_API_KEY): missing
digest: d6e7c6abe81707a57c0358dc3f73231a19199edff62f844a90c0d2b02f7cca17
```

To review a real merge request without posting anything, copy the example to `heron.config.json`, set your GitLab URL, project, bot user id, and models, set `GITLAB_TOKEN` and the backend credential, and run:

```sh
pnpm heron review --mr 42 --dry-run
```

This command was not run while this README was checked, because it needs a GitLab project and model credentials. The dry run prints the report, then one `planned thread` line for each thread it would open, update, reopen or resolve. Without `--dry-run`, Heron writes the threads, posts the note and sets labels.

## Integrations

- **GitLab CI.** [Run Heron from GitLab CI](docs/gitlab-ci.md) gives a manual merge request job that takes all configuration from CI/CD variables and admits only listed users.
- **Model backends.** [Backends](docs/backends.md) covers `ai-sdk` (OpenRouter with an API key), `claude-cli` (your Claude Code CLI), and `codex-cli` (your Codex CLI), with the vendor terms for each.

## Architecture

- `src/review.ts` holds `reviewOnce`, the one review pipeline. It talks to GitLab and to the models through two ports defined in `src/ports.ts`: `Forge` and `Harness`.
- `src/policy.ts` holds the decisions as plain functions: admission, lane choice, the session plan, the verdict, label changes, whether to create, update, or skip the note, and what to do with each blocker thread. `src/diff.ts` reads the unified diff to find the lines a thread can sit on and to move an earlier finding's line to a newer head.
- `src/forge/gitlab.ts` implements `Forge` over the GitLab REST API. `src/harness/` implements `Harness` for the three backends and the read-only source tools they share.
- The hidden marker and the hidden findings line in the report note, and the hidden fingerprint in each blocker thread, are the only state Heron keeps. There is no database.

Reference: [Configuration](docs/configuration.md), [Backends](docs/backends.md), [Security model](docs/security.md), [Design book](docs/brand/README.md).

## Known limitations

- **Not on npm.** Install from source and run `pnpm heron` or `node src/cli.ts`.
- **GitLab only.** `forge.kind` accepts only `gitlab`.
- **No watcher.** Nothing reviews a merge request until someone runs `heron review`, for example from the [manual CI job](docs/gitlab-ci.md). A `heron watch` command is not implemented.
- **Large diffs are not reviewed.** If GitLab caps, collapses, or is still preparing the diff, Heron stops with an error and posts nothing.
- **Only blockers on the diff get a thread.** A blocker on a line outside the merge request diff stays in the note only. A thread stays where it was opened. When a later push changes that line, GitLab may show the thread as outdated, and Heron keeps updating it where it is.
- **A changed title or a renamed file is a new thread.** When a later review words a blocker differently, beyond case, spacing and punctuation, or a re-review moves it to a renamed file, Heron resolves the old thread as fixed and opens a new one where the diff can hold it.
- **A re-review trusts the earlier review's coverage.** The gates look at the new commits only, so a defect in older commits that the earlier review missed stays missed. No option forces a full review of a moved head; changing the config digest or deleting the report note does.
- **Merge request text can steer the model.** The author controls the diff and description the model reads. A PASS is one automated opinion, not a security approval. See [Security model](docs/security.md#limits-of-the-threat-model).
- **Vendor terms limit the CLI backends.** Anthropic [does not allow](https://code.claude.com/docs/en/agent-sdk/overview) third-party products to offer claude.ai login or rate limits without approval. Heron offers no login: `claude-cli` runs your own authenticated Claude Code, and your plan's terms apply. OpenAI's [CI/CD auth guide](https://developers.openai.com/codex/auth/ci-cd-auth.md) says not to use ChatGPT-managed Codex auth for public or open-source repositories, so use `codex-cli` only for private repositories on trusted runners. For shared or public use, choose `ai-sdk` with an API key. Details are in [Backends](docs/backends.md#vendor-terms).

## Verify

These commands pass on Node 24.21.0 with pnpm 11.1.3:

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm build
node scripts/check-readme-contract.mjs README.md
```

`pnpm check` runs the TypeScript type checker and the Vitest suite, including a test that fails when the environment variable table in [docs/configuration.md](docs/configuration.md) differs from the code. GitHub Actions runs the same install, type check, tests, and build on every push to `main` and every pull request.

## Acknowledgements

The public site in [`site/`](site/) draws its window glass with Canvas UI's [Glass](https://canvasui.dev) component ([source](https://github.com/DavidHDev/canvas-ui)). Canvas UI is licensed under MIT with a Commons Clause: you may use the components, including commercially, but you may not sell, sublicense, or redistribute them on their own, bundled, or ported. The vendored copy under `site/src/vendor/canvas-ui/` keeps the upstream license text. The site's interface font falls back to Selawik, self-hosted with its SIL Open Font License 1.1 text in `site/public/fonts/`. See [`site/README.md`](site/README.md).

## License

This project is licensed under the Apache License 2.0. See [LICENSE](./LICENSE).
