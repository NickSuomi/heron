<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/brand/assets/heron-lockup-on-dark.svg">
    <img alt="Heron" src="docs/brand/assets/heron-lockup.svg" width="344">
  </picture>
</p>

# Heron

<!-- github-readme-standard: full -->

Heron is a self-hosted code-review bot for GitLab merge requests that runs on your own runner with your own model credentials. It posts one report note, a diff discussion for each blocker and a verdict label, and it never pushes, approves or merges.

Status: alpha. Version 0.0.0, not published to npm. Install from source.

## What is Heron?

Heron reviews one merge request at its current head. Language models that you choose read the diff, the whole repository, the linked issues, the comments and the failed CI jobs, and return findings. Heron turns the findings into a verdict and posts one report note on the merge request. It also opens a discussion on the diff line of each blocker and sets a label for the verdict.

The verdict is one of four fixed words that scripts can match: PASS, CHANGES REQUESTED, BLOCKED or SUPERSEDED.

## Why Heron?

- **No hosted service.** Heron runs in your CI job with your GitLab token. The only outside service it calls is the model vendor you configure.
- **Code decides the verdict.** Any kept blocker means CHANGES REQUESTED. A session that fails, times out or returns malformed output means BLOCKED, never PASS. If the branch moves during the review, the verdict is SUPERSEDED.
- **A second session rules on every finding.** In gated and dual lanes a supervisor or judge keeps each finding, lowers it to an advisory or drops it, and gives a reason. The report shows every ruling.
- **Models read everything and change nothing.** Each session reads the merge request head, the target branch and their merge base. Its tools are ripgrep, structural search, git history, TypeScript and Vue language-server lookups, and scanners for secrets, vulnerable dependencies and unsafe code patterns. No session has a turn, time or result cap unless you set one. No session can run commands or write files.
- **One note, one thread per blocker.** A new push updates the same note, and Heron resolves a blocker thread once the blocker is gone.

## What a review looks like

This is the start of the report Heron renders for a fictional merge request, `acme/storefront!42`, from [the site's sample data](site/src/data/mr42-data.ts):

> **Heron review: CHANGES REQUESTED**
>
> 1 blocker · 4 advisories · head `9abe74a0` · lane `standard`
>
> Adds bulk archiving to the project list: a checkbox on each row, an Archive button and an archiveSelected helper that sends one request for each selected project.
>
> Before merge, fix the blocker below.
>
> **Blockers**
>
> - `correctness` Archiving deletes the projects ([src/projects/archive.ts:12](https://gitlab.example.com/acme/storefront/-/blob/9abe74a0d67dfd7a0c5e599d51a1edfd91c0e3e7/src/projects/archive.ts#L12))
>   archiveSelected sends DELETE /projects/:id for every id, which removes the projects that the doc comment on line 6 and the button promise to archive. Call the archive endpoint instead, for example POST /projects/:id/archive, and pin the request in a test.

Three collapsed sections follow. "4 advisories" lists the advisories. REVIEW CHECKS has the status of each gate, the supervisor's ruling on each finding with its reason, what the sessions could not check, and why this lane was chosen. AGENT PROVENANCE has the model, effort, tokens and time of each session.

## Quick start

You need Node 24 or later, pnpm 11 and git. A real review also needs a GitLab bot token with the `api` scope, a bot with at least the Developer role so that it can resolve its threads, and a credential for one [backend](docs/backends.md).

```sh
git clone https://github.com/NickSuomi/heron.git
cd heron
pnpm install --frozen-lockfile
```

Create `heron.config.json` in the checkout. This is the smallest config with a supervisor: two gates, each reviewed by a fast model, then one supervisor on a strong model.

```json
{
  "forge": { "kind": "gitlab", "url": "https://gitlab.example.com", "project": "acme/storefront", "botUserId": 1001 },
  "admission": { "allowedTriggerUserIds": [2001, 2002] },
  "backend": "claude",
  "harnesses": { "claude": { "kind": "claude-cli", "concurrency": 2 } },
  "profiles": {
    "quick": { "model": "fast-model-id", "effort": "low" },
    "deep": { "model": "strong-model-id", "effort": "high" }
  },
  "gates": {
    "correctness": { "instructions": "examples/instructions/correctness.md" },
    "security": { "instructions": "examples/instructions/security.md" }
  },
  "lanes": [{ "name": "standard", "shape": "gated", "gates": ["correctness", "security"], "gate": "quick", "supervisor": "deep" }],
  "defaultLane": "standard"
}
```

Replace the two model ids with real ones from your vendor. `botUserId` is the user id that owns the token, and `allowedTriggerUserIds` lists the people who may start a review. [`heron.config.example.json`](heron.config.example.json) adds labels, path rules and stricter lanes. [Configuration](docs/configuration.md) lists every key and environment variable.

Check the config. This needs no network and no credentials:

```sh
pnpm heron config check
```

It prints the effective config, the lanes, which credentials are set and the config digest.

Set `GITLAB_TOKEN` and the backend credential, then review merge request 42 without posting anything:

```sh
pnpm heron review --mr 42 --dry-run
```

The dry run prints the report and one `planned thread` line for each thread it would open, update, reopen or resolve. Without `--dry-run`, Heron writes the threads, posts the note and sets labels.

To run Heron from CI, follow [Run Heron from GitLab CI](docs/gitlab-ci.md). It adds a manual merge request job that only listed users can run, and a scheduled job that answers comment commands.

## Comment commands

Day to day, users in `admission.allowedTriggerUserIds` can run Heron from a merge request comment whose first line starts with `@heron`. The command word is case-insensitive.

| Comment | What Heron does |
| --- | --- |
| `@heron review` | Reviews the merge request, or only the new commits when a [re-review](#re-reviews) is safe, and replies with the verdict. |
| `@heron full review` | Reviews the whole merge request. |
| `@heron resolve` | Resolves every open thread Heron started. |
| `@heron dismiss` and a reason | In a blocker thread only. Resolves the thread, and later reviews leave the finding out of the verdict. |
| `@heron learn` and a rule | Stores the rule in the [team memory](#team-memory). The rule can continue on the next lines. |
| `@heron configuration` | Replies with the lanes, rules, profiles, limits and config digest. |
| `@heron help`, or `@heron` alone | Replies with this list. |
| `@heron` and any other text | One model session reads the merge request as a review does and answers in the thread. |

GitLab starts no pipeline for a comment, so a scheduled pipeline runs `heron poll`. It reads the `@heron` comments from the last 60 minutes (`--since-minutes`), adds the `eyes` emoji to each one before it acts, and replies in the comment's thread. Heron skips a comment that already has its emoji, so overlapping polls never run a command twice. `heron poll` refuses to start without `admission.allowedTriggerUserIds`. Anyone not on the list gets one reply per merge request saying that only maintainers can run Heron.

## How it works

**Lanes and gates.** A gate is one review concern, such as correctness or security, with its own instruction file. A lane says which gates run and in what shape. Path rules in the config pick the lane, so a docs change can get one reviewer and an auth change can get the strictest lane. The `single` shape runs one session for all gates. `gated` runs one session per gate and then a supervisor. `dual` runs two independent gated branches and then a judge.

**Supervisor and judge.** The supervisor, or the judge in a dual lane, rules `keep`, `keep as advisory` or `drop` on each finding and gives a reason. No ruling raises a finding to blocker; a supervisor that finds a blocker adds it as its own finding. Heron then computes the verdict from the kept findings in plain functions in [`src/policy.ts`](src/policy.ts).

### Blocker threads

Each blocker gets a discussion at its file and line, if that line is part of the merge request diff. A blocker on any other line stays in the note only. Advisories never get a thread. A later review that keeps the blocker updates the same thread, and reopens it if a person resolved it. When the blocker is gone, Heron replies with the head it reviewed and resolves the thread. Heron touches only threads its bot user started, never a person's reply.

When a gate proposes a fix and every ruling session confirms it, the thread offers it as a GitLab [suggestion](https://docs.gitlab.com/user/project/merge_requests/reviews/suggestions/) that the author can apply in one click. A single lane has no ruling session, so its threads offer none. A BLOCKED or SUPERSEDED review leaves every thread alone.

### Re-reviews

When the head has moved since the last report, Heron reviews only the newer commits if all of these hold:

- the last report is a finished review by the bot user, with the current config digest and the same lane;
- the target branch tip and the merge base have not changed;
- the old head is an ancestor of the new one, so no force push or rebase happened;
- GitLab compares the two heads completely.

Otherwise it reviews the whole change. Sessions still read the whole repository. Heron moves the earlier findings to their lines at the new head, and the last session rules on each one again.

### Team memory

With `memory` configured, Heron keeps a team memory in a self-hosted [Hindsight](https://hindsight.vectorize.io/) server, with one bank per project. Only `@heron learn` and `@heron dismiss` from users on the allow list write to it. Before each review, Heron recalls memories that match the title, the gates and the changed paths, and gives them to every session as untrusted guidance. Hindsight needs no LLM of its own. If it fails or takes more than 10 seconds, the review goes on without memory and says so. See [Configuration](docs/configuration.md#memory).

## Backends

| `kind` | What runs | Credential |
| --- | --- | --- |
| `ai-sdk` | The Vercel AI SDK inside Heron, calling OpenRouter | `OPENROUTER_API_KEY` |
| `claude-cli` | Your installed Claude Code CLI | `CLAUDE_CODE_OAUTH_TOKEN` or `ANTHROPIC_API_KEY` |
| `codex-cli` | Your installed Codex CLI | a persistent `CODEX_HOME`, optionally `CODEX_API_KEY` |

For shared or public projects, use `ai-sdk` with an API key. See [Backends](docs/backends.md) for the vendor terms and the source tools.

## Security model

Heron defends against prompt injection from merge request content. The model has no shell and no tool that runs code. Its file tools only see read-only copies of the reviewed commits, and no tool process receives a credential. The GitLab token never reaches a backend. A developer who can push a branch can edit the CI file and read the job's variables, so give the bot token the smallest reach you can. See [Security model](docs/security.md).

## Known limitations

- Not on npm. Run it from source with `pnpm heron` or `node src/cli.ts`.
- GitLab only.
- Nothing reviews a merge request until someone runs the CI job or comments `@heron review`.
- A comment command waits for the next scheduled poll. A comment older than `--since-minutes` when a poll first sees it never runs.
- Heron does not review a diff that GitLab caps or collapses.
- Heron does not run tests, the app or a browser. It only reads.
- A re-review checks only the new commits, so a defect the earlier review missed stays missed.
- A dismissal and a thread match the blocker's wording and path. A reworded blocker, or one in a renamed file, counts as new.
- Merge request text can steer the model. A PASS is one automated opinion, not a security approval.
- The CLI backends run under your own vendor account and its terms. OpenAI advises against ChatGPT-managed Codex auth for public repositories. See [vendor terms](docs/backends.md#vendor-terms).
- The CI recipe in [docs/gitlab-ci.md](docs/gitlab-ci.md) runs in one self-hosted deployment, adapted to its runners and hosts. Treat it as a starting point, not a drop-in.

## Verify

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm build
node scripts/check-readme-contract.mjs README.md
```

`pnpm check` runs the type checker and the Vitest suite. GitHub Actions runs the install, type check, tests and build on Node 24 for every push to `main` and every pull request.

## Acknowledgements

The public site in [`site/`](site/) draws its window glass with Canvas UI's [Glass](https://canvasui.dev) component ([source](https://github.com/DavidHDev/canvas-ui)). Canvas UI is licensed under MIT with a Commons Clause: you may use the components, including commercially, but you may not sell, sublicense or redistribute them on their own, bundled or ported. The vendored copy under `site/src/vendor/canvas-ui/` keeps the upstream license text. The site's interface font falls back to Heron Sans, a subset of Selawik renamed as the SIL Open Font License 1.1 requires for a modified version, self-hosted with that licence text in `site/public/fonts/`. See [`site/README.md`](site/README.md).

## License

This project is licensed under the Apache License 2.0. See [LICENSE](./LICENSE).
