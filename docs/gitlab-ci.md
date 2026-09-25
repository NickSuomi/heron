# Run Heron from GitLab CI

This guide adds a manual **heron-review** job to merge request pipelines. A person from an allowed list clicks the job, Heron reviews the merge request at its current head, posts or updates one report note, and sets the verdict label. All configuration lives in CI/CD variables.

The recipe below has not yet been run end to end in GitLab CI. The config it uses was checked with `heron config check`.

## Before you start

You need:

- A GitLab user for the bot and a personal or project access token for it with the `api` scope. Note the bot's numeric user id.
- The four labels from your config, created in the project or a parent group. Heron does not create labels.
- A runner that can run the `node:24` image and reach GitHub, your GitLab instance, and the model vendor.
- A credential for one [backend](backends.md). This guide uses `claude-cli`. For shared or public projects, use `ai-sdk` instead.

If a developer can push a branch to this project, that developer can edit `.gitlab-ci.yml` in their branch and print any variable the job receives. Variables that merge request pipelines receive cannot be protected, because protected variables reach only pipelines on protected branches and tags. Give this job a bot token with the smallest reach you can, or run Heron from a separate project that only maintainers can edit. See [Security](security.md#ci-variables).

## Add the variables

In **Settings > CI/CD > Variables**, add:

| Variable | Value | Flags |
| --- | --- | --- |
| `GITLAB_TOKEN` | The bot token | Masked |
| `CLAUDE_CODE_OAUTH_TOKEN` | Output of `claude setup-token` | Masked |
| `HERON_BOT_USER_ID` | The bot's user id | |
| `HERON_ALLOWED_TRIGGER_USERS` | Comma-separated user ids that may start a review, for example `2001,2002` | |
| `HERON_CONFIG_JSON` | The JSON below | |

`HERON_ALLOWED_TRIGGER_USERS` is the admission filter. GitLab sets `GITLAB_USER_ID` in a manual job to the user who started that job. Heron refuses to run when that id is not in the list, and the job fails. If `HERON_ALLOWED_TRIGGER_USERS` is missing or empty, anyone who can run the job can start a review.

Use this as `HERON_CONFIG_JSON`, with your model ids in place of the placeholders:

```json
{
  "forge": { "kind": "gitlab" },
  "labels": {
    "inProgress": "review::in progress",
    "pass": "review::passed",
    "changesRequested": "review::changes requested",
    "blocked": "review::blocked"
  },
  "backend": "claude",
  "harnesses": { "claude": { "kind": "claude-cli", "concurrency": 2 } },
  "profiles": {
    "quick": { "model": "<fast model id>", "effort": "low" },
    "deep": { "model": "<strong model id>", "effort": "high" }
  },
  "gates": {
    "correctness": { "instructions": "examples/instructions/correctness.md" },
    "security": { "instructions": "examples/instructions/security.md" }
  },
  "lanes": [
    { "name": "standard", "shape": "gated", "gates": ["correctness", "security"], "gate": "quick", "supervisor": "deep" }
  ],
  "defaultLane": "standard"
}
```

The JSON leaves out `forge.url`, `forge.project`, `forge.botUserId`, and `admission`. The job fills them from variables. The instruction paths point at the examples in the Heron checkout, which is the job's working directory. To use your own instructions, commit them to a repository that only maintainers can change and adjust the paths.

## Add the job

Add this job to `.gitlab-ci.yml`. Replace `<commit>` with the full SHA of the Heron commit you reviewed and want to run.

```yaml
heron-review:
  image: node:24
  rules:
    - if: $CI_PIPELINE_SOURCE == "merge_request_event"
      when: manual
  allow_failure: true
  variables:
    GIT_STRATEGY: none
    HERON_REF: "<commit>"
    HERON_GITLAB_URL: $CI_SERVER_URL
    HERON_PROJECT: $CI_PROJECT_ID
  script:
    - npm install --global pnpm@11.1.3 @anthropic-ai/claude-code
    - git clone --quiet https://github.com/NickSuomi/heron.git /tmp/heron
    - git -C /tmp/heron checkout --quiet "$HERON_REF"
    - cd /tmp/heron
    - pnpm install --frozen-lockfile
    - node src/cli.ts review --mr "$CI_MERGE_REQUEST_IID"
```

Notes on the job:

- `GIT_STRATEGY: none` skips the project checkout. Heron fetches the reviewed commit itself with the bot token.
- Heron is not published to npm yet, so the job runs it from a pinned source checkout. Node 24 runs the TypeScript sources directly.
- `allow_failure: true` keeps a refused or failed review from failing the pipeline.
- `heron review` exits with a non-zero code when it cannot run: bad config, refused admission, a GitLab error, or an incomplete diff. A BLOCKED or CHANGES REQUESTED verdict is a normal result and exits with code 0.
- To check the setup without posting anything, add `--dry-run`. Heron prints the report and leaves labels alone.

## Watcher (not yet implemented)

Heron has no watcher yet. There is no `heron watch` command, and nothing reviews a merge request unless someone starts the job above. The design reserves a watcher that would review merge requests as they change. It would call the same review function as `heron review`, so reports, labels, and admission would work the same way.
